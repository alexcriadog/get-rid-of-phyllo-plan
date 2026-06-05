// C-Token lifecycle hygiene: daily data-access window monitor.
//
// The hourly refresh cron (token-refresh.cron.service.ts) keeps ACCESS
// tokens alive, but Meta-family tokens carry a second, independent clock:
// the app-level `data_access_expires_at` (~90 days, visible only via
// /debug_token). When it passes, the token still "works" but data reads
// start failing and the end-user must re-authenticate — refresh cannot
// extend it. This cron sweeps connected Meta + Threads accounts once a day,
// asks /debug_token for the window, and:
//   - logs a WARN per account within DATA_ACCESS_WARN_DAYS of the cliff
//   - bumps `token_health_alert` metrics (platform + status labels)
//   - persists a snapshot to Redis for GET /admin/token-health
//
// Per-flow behaviour:
//   - facebook / instagram (FB-login): graph.facebook.com/debug_token with
//     the META_APP_ID|META_APP_SECRET app token.
//   - threads: graph.threads.net/debug_token with THREADS_APP_ID|SECRET.
//     Best-effort — if Threads rejects the edge we record 'error' and the
//     operator sees it in the snapshot instead of a silent gap.
//   - instagram via IG-direct: graph.instagram.com has no debug_token edge;
//     recorded as 'unsupported' so the gap is visible, not invented.
//
// Copies the proven cron shape from TokenRefreshCronService: api-process
// gate + runWithLock distributed lock + UTC @Cron.

import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { ulid } from 'ulid';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@shared/database/prisma.service';
import { RedisService } from '@shared/redis/redis.service';
import { AesLocalService } from '@shared/crypto/aes-local.service';
import { runWithLock } from '@shared/redis/cron-lock';
import { MetricsService } from '@shared/metrics/metrics.service';
import { isIgDirect } from '@modules/platforms/shared/meta-graph/ig-direct';
import {
  classifyDataAccess,
  parseDebugTokenDataAccessExpiry,
  DATA_ACCESS_WARN_DAYS,
  DataAccessStatus,
} from './token-health.util';

const META_DEBUG_TOKEN_URL = 'https://graph.facebook.com/debug_token';
const THREADS_DEBUG_TOKEN_URL = 'https://graph.threads.net/debug_token';
/** Platforms whose tokens carry a data-access window worth sweeping. */
const SCAN_PLATFORMS = ['facebook', 'instagram', 'threads'];
const DEBUG_TIMEOUT_MS = 15_000;
/** Generous: the sweep is sequential and each call is one cheap GET. */
const LOCK_TTL_MS = 5 * 60_000;
const BATCH_SIZE = 500;
/** Snapshot survives 3 missed runs before the admin endpoint goes stale. */
const SNAPSHOT_TTL_S = 3 * 24 * 3600;

export interface TokenHealthEntry {
  accountId: string;
  platform: string;
  flow: 'meta' | 'ig_direct' | 'threads';
  handle: string | null;
  /** ISO timestamp of the data-access cliff; null when unknown. */
  dataAccessExpiresAt: string | null;
  daysLeft: number | null;
  status: DataAccessStatus | 'unsupported' | 'error';
  detail?: string;
}

export interface TokenHealthSnapshot {
  generatedAt: string;
  warnDays: number;
  entries: TokenHealthEntry[];
}

@Injectable()
export class TokenHealthCronService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TokenHealthCronService.name);
  private readonly instanceToken = ulid();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly aes: AesLocalService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.argv[2] !== 'api') {
      this.logger.debug('Token-health cron lives on the api process — no-op bootstrap');
      return;
    }
    this.logger.log('Token-health cron scheduled: daily at 05:40 UTC');
  }

  @Cron('40 5 * * *', { name: 'token-health', timeZone: 'UTC' })
  async sweepDataAccessWindows(): Promise<TokenHealthSnapshot | null> {
    if (process.argv[2] !== 'api') return null;
    const res = await runWithLock(
      this.redis.client,
      this.redis.key('cron', 'token-health'),
      this.instanceToken,
      LOCK_TTL_MS,
      () => this.run(),
    );
    if (!res.ran) {
      this.logger.debug('Token-health sweep skipped — lock held by another instance');
      return null;
    }
    return res.result ?? null;
  }

  /** Manual trigger for GET /admin/token-health?refresh=1. No lock — the
   *  admin endpoint is operator-driven and idempotent. */
  async runNow(): Promise<TokenHealthSnapshot> {
    return this.run();
  }

  /** Last persisted snapshot, or null when the cron has never run. */
  async snapshot(): Promise<TokenHealthSnapshot | null> {
    const raw = await this.redis.client.get(this.snapshotKey());
    if (!raw) return null;
    try {
      return JSON.parse(raw) as TokenHealthSnapshot;
    } catch {
      return null;
    }
  }

  private snapshotKey(): string {
    return this.redis.key('token-health', 'snapshot');
  }

  private async run(): Promise<TokenHealthSnapshot> {
    const now = Date.now();
    const rows = await this.prisma.oAuthToken.findMany({
      where: {
        account: {
          is: { status: 'ready', platform: { in: SCAN_PLATFORMS } },
        },
      },
      select: {
        accountId: true,
        accessTokenCiphertext: true,
        account: { select: { platform: true, handle: true, metadata: true } },
      },
      orderBy: { accountId: 'asc' },
      take: BATCH_SIZE,
    });

    const entries: TokenHealthEntry[] = [];
    for (const row of rows) {
      entries.push(await this.checkRow(row, now));
    }

    const snapshot: TokenHealthSnapshot = {
      generatedAt: new Date(now).toISOString(),
      warnDays: DATA_ACCESS_WARN_DAYS,
      entries,
    };
    await this.redis.client.set(
      this.snapshotKey(),
      JSON.stringify(snapshot),
      'EX',
      SNAPSHOT_TTL_S,
    );

    const alerts = entries.filter(
      (e) => e.status === 'expiring' || e.status === 'expired',
    );
    this.logger.log(
      `Token-health sweep: checked=${entries.length} expiring/expired=${alerts.length}`,
    );
    return snapshot;
  }

  private async checkRow(
    row: {
      accountId: bigint;
      accessTokenCiphertext: Uint8Array;
      account: {
        platform: string;
        handle: string | null;
        metadata: unknown;
      };
    },
    nowMs: number,
  ): Promise<TokenHealthEntry> {
    const platform = row.account.platform;
    const base: Omit<TokenHealthEntry, 'flow' | 'status'> = {
      accountId: row.accountId.toString(),
      platform,
      handle: row.account.handle,
      dataAccessExpiresAt: null,
      daysLeft: null,
    };

    // IG-direct tokens only work against graph.instagram.com, which exposes
    // no debug_token edge — surface the blind spot instead of guessing.
    if (
      platform === 'instagram' &&
      isIgDirect(row.account.metadata as Record<string, unknown> | null)
    ) {
      return {
        ...base,
        flow: 'ig_direct',
        status: 'unsupported',
        detail: 'graph.instagram.com has no debug_token edge',
      };
    }

    const flow: TokenHealthEntry['flow'] =
      platform === 'threads' ? 'threads' : 'meta';
    const appToken = this.appToken(flow);
    if (!appToken) {
      return {
        ...base,
        flow,
        status: 'error',
        detail:
          flow === 'threads'
            ? 'THREADS_APP_ID / THREADS_APP_SECRET not configured'
            : 'META_APP_ID / META_APP_SECRET not configured',
      };
    }

    try {
      const inputToken = this.aes.decrypt(
        Buffer.from(row.accessTokenCiphertext),
      );
      const url =
        flow === 'threads' ? THREADS_DEBUG_TOKEN_URL : META_DEBUG_TOKEN_URL;
      const res = await axios.get<unknown>(url, {
        params: { input_token: inputToken, access_token: appToken },
        timeout: DEBUG_TIMEOUT_MS,
      });
      const expiresAtMs = parseDebugTokenDataAccessExpiry(res.data);
      const cls = classifyDataAccess(expiresAtMs, nowMs);
      if (cls.status === 'expiring' || cls.status === 'expired') {
        this.metrics.incr('token_health_alert', {
          platform,
          status: cls.status,
        });
        this.logger.warn(
          `data_access_expires_at ${cls.status} for account ${base.accountId} ` +
            `(${platform}${base.handle ? ` @${base.handle}` : ''}): ` +
            `${cls.daysLeft} day(s) left — end-user re-auth required before the cliff`,
        );
      }
      return {
        ...base,
        flow,
        status: cls.status,
        daysLeft: cls.daysLeft,
        dataAccessExpiresAt:
          expiresAtMs === null ? null : new Date(expiresAtMs).toISOString(),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.metrics.incr('token_health_check_failed', { platform });
      this.logger.warn(
        `debug_token check failed for account ${base.accountId} (${platform}): ${msg}`,
      );
      return { ...base, flow, status: 'error', detail: msg };
    }
  }

  private appToken(flow: 'meta' | 'threads'): string | null {
    const id =
      flow === 'threads'
        ? this.config.get<string>('THREADS_APP_ID')
        : this.config.get<string>('META_APP_ID');
    const secret =
      flow === 'threads'
        ? this.config.get<string>('THREADS_APP_SECRET')
        : this.config.get<string>('META_APP_SECRET');
    if (!id || !secret) return null;
    return `${id}|${secret}`;
  }
}
