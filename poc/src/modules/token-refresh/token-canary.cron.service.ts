// Selective liveness canary + self-heal.
//
// The refresh cron keeps tokens authenticating; the health cron watches the
// data-access window. Neither tells us whether we can ACTUALLY read data for
// an account that isn't syncing — and needs_reauth accounts are excluded from
// every other sweep, so a false-positive flag is terminal. This cron closes
// both gaps with a single cheap real read (each adapter's fetchProfile):
//   - status='ready' but NOT exercised by a real sync in EXERCISED_WINDOW_MS
//     (quiet/paused) -> probe; a token-dead verdict flags needs_reauth.
//   - status='needs_reauth' -> probe; a healthy verdict self-heals to 'ready'.
// Active accounts are never probed here — their real syncs already classify
// token-dead errors in sync.worker.ts. Default-to-transient (probeAccount)
// guarantees a blip never bounces a healthy account.
import { Injectable, Logger, OnApplicationBootstrap, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ulid } from 'ulid';
import { PrismaService } from '@shared/database/prisma.service';
import { RedisService } from '@shared/redis/redis.service';
import { AesLocalService } from '@shared/crypto/aes-local.service';
import { runWithLock } from '@shared/redis/cron-lock';
import { MetricsService } from '@shared/metrics/metrics.service';
import { TokenLifecycleEmitter } from '@modules/outbound-webhooks/token-lifecycle-emitter.service';
import {
  ADAPTER_REGISTRY,
  AdapterRegistry,
} from '@modules/platforms/shared/platform-adapter.port';
import { probeAccount } from './token-canary.util';

const EXERCISED_WINDOW_MS = 36 * 60 * 60_000; // 36h: "recently exercised" by a real sync
const BATCH_SIZE = 500;
const LOCK_TTL_MS = 10 * 60_000;

interface CanaryResult {
  scanned: number;
  recovered: number;
  flagged: number;
  skipped: number;
}
const EMPTY: CanaryResult = { scanned: 0, recovered: 0, flagged: 0, skipped: 0 };

@Injectable()
export class TokenCanaryCronService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TokenCanaryCronService.name);
  private readonly instanceToken = ulid();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly aes: AesLocalService,
    private readonly metrics: MetricsService,
    private readonly lifecycle: TokenLifecycleEmitter,
    @Inject(ADAPTER_REGISTRY) private readonly adapters: AdapterRegistry,
  ) {}

  onApplicationBootstrap(): void {
    if (process.argv[2] !== 'api') return;
    this.logger.log('Token-canary cron scheduled: daily at 06:10 UTC');
  }

  @Cron('10 6 * * *', { name: 'token-canary', timeZone: 'UTC' })
  async sweep(): Promise<CanaryResult> {
    if (process.argv[2] !== 'api') return EMPTY;
    const res = await runWithLock(
      this.redis.client,
      this.redis.key('cron', 'token-canary'),
      this.instanceToken,
      LOCK_TTL_MS,
      () => this.run(),
    );
    return res.ran ? res.result ?? EMPTY : EMPTY;
  }

  private async run(): Promise<CanaryResult> {
    const quietCutoff = new Date(Date.now() - EXERCISED_WINDOW_MS);
    const rows = await this.prisma.account.findMany({
      where: {
        OR: [
          // Quiet/paused: connected but no real sync attempt recently.
          { status: 'ready', syncJobs: { none: { lastAttemptAt: { gte: quietCutoff } } } },
          // Self-heal candidates: excluded from every other sweep.
          { status: 'needs_reauth' },
        ],
      },
      select: {
        id: true, platform: true, canonicalUserId: true, status: true, metadata: true,
        tokens: { select: { accessTokenCiphertext: true, userAccessTokenCiphertext: true } },
      },
      take: BATCH_SIZE,
    });

    const result: CanaryResult = { ...EMPTY, scanned: rows.length };
    for (const row of rows) {
      const adapter = this.adapters[row.platform];
      const token = row.tokens[0];
      if (!adapter || !token) { result.skipped += 1; continue; }

      const accessToken = token.userAccessTokenCiphertext
        ? this.aes.decrypt(Buffer.from(token.userAccessTokenCiphertext))
        : this.aes.decrypt(Buffer.from(token.accessTokenCiphertext));

      const verdict = await probeAccount(
        adapter, accessToken, row.canonicalUserId,
        row.metadata as Record<string, unknown> | null,
      );

      if (verdict === 'healthy') {
        if (row.status === 'needs_reauth') {
          await this.prisma.account.update({
            where: { id: row.id },
            data: { status: 'ready', lastProbedAt: new Date() },
          });
          await this.lifecycle.tokenRecovered(row.id, {
            reason: 'canary liveness probe succeeded',
          });
          result.recovered += 1;
          this.metrics.incr('token_canary_recovered', { platform: row.platform });
        } else {
          await this.prisma.account.update({
            where: { id: row.id }, data: { lastProbedAt: new Date() },
          });
          result.skipped += 1;
        }
      } else if (verdict === 'reauth') {
        if (row.status === 'ready') {
          await this.prisma.account.update({
            where: { id: row.id },
            data: { status: 'needs_reauth', lastProbedAt: new Date() },
          });
          await this.lifecycle.tokenExpired(row.id, {
            reason: 'canary liveness probe: token revoked/expired',
          });
          result.flagged += 1;
          this.metrics.incr('token_canary_flagged', { platform: row.platform });
        } else {
          result.skipped += 1;
        }
      } else {
        result.skipped += 1; // transient — retry next run, never flip
      }
    }

    if (result.scanned > 0) {
      this.logger.log(
        `Token-canary sweep: scanned=${result.scanned} recovered=${result.recovered} ` +
          `flagged=${result.flagged} skipped=${result.skipped}`,
      );
    }
    return result;
  }
}
