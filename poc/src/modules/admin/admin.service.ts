import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import axios, { AxiosError } from 'axios';
import { PrismaService } from '@shared/database/prisma.service';
import { MongoService } from '@shared/database/mongo.service';
import { RedisService } from '@shared/redis/redis.service';
import { RateBucketService } from '@shared/redis/rate-bucket.service';
import { AesLocalService } from '@shared/crypto/aes-local.service';
import {
  BullmqService,
  JobPriority,
  QueueName,
  SyncJobPayload,
} from '@shared/redis/bullmq.service';
import { MetricsService } from '@shared/metrics/metrics.service';
import { CadenceService } from '@modules/sync/cadence.service';
import { ThrottleLockService } from '@modules/sync/throttle-lock.service';
import {
  ADAPTER_REGISTRY,
  AdapterRegistry,
} from '@modules/platforms/platforms.module';
import { AccountsService, Platform } from '@modules/accounts/accounts.service';
import { WorkspacesService } from '@modules/workspaces/workspaces.service';
import { ThreadsTokenRefreshService } from '@modules/platforms/shared/threads-api/threads-token-refresh.service';
import { BucTelemetryService } from '@modules/platforms/shared/meta-graph/buc-telemetry.service';
import { ConfigService } from '@nestjs/config';

const GRAPH_VERSION = 'v22.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const THREADS_GRAPH_BASE = 'https://graph.threads.net/v1.0';
const YOUTUBE_DATA_BASE = 'https://www.googleapis.com/youtube/v3';
const DISCOVER_TIMEOUT_MS = 15_000;

const SYNC_QUEUE_NAME: QueueName = 'sync';
const EVENTS_QUEUE_NAME: QueueName = 'events';
const DELIVERY_QUEUE_NAME: QueueName = 'delivery';

const QUEUE_NAMES: ReadonlyArray<QueueName> = [
  SYNC_QUEUE_NAME,
  EVENTS_QUEUE_NAME,
  DELIVERY_QUEUE_NAME,
];

const WEBHOOK_DRIVEN_PRODUCTS: ReadonlyArray<string> = ['engagement_new'];

/**
 * A runtime-resolved numeric knob: the value in effect plus where it came
 * from (an explicit env override vs the built-in default). Lets the admin UI
 * show, e.g., "concurrency 8 (env)" vs "concurrency 4 (default)".
 */
export interface ResolvedNumber {
  value: number;
  source: 'env' | 'default';
  env: string;
}

/**
 * Resolve an integer env knob the same way the services do: a valid positive
 * integer in the env wins, otherwise the default. Mirrors the parsing in
 * sync.worker / scheduler / retention so the reported value matches reality.
 */
function resolveEnvInt(envName: string, fallback: number): ResolvedNumber {
  const raw = process.env[envName];
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      return { value: Math.floor(n), source: 'env', env: envName };
    }
  }
  return { value: fallback, source: 'default', env: envName };
}

export type Freshness = 'green' | 'yellow' | 'red';

export interface SyncJobFilter {
  accountId?: bigint;
  status?: string;
  platform?: string;
  limit?: number;
}

export interface ApiCallFilter {
  platform?: string;
  statusClass?: string;
  accountId?: bigint;
  limit?: number;
}

export interface EventFilter {
  eventType?: string;
  accountId?: string;
  limit?: number;
}

export interface CadenceOverrideInput {
  product: string;
  intervalSeconds: number;
  reason?: string;
  expiresAt?: Date;
}

interface AccountSummary {
  id: string;
  platform: string;
  handle: string | null;
  display_name: string | null;
}

interface AccountIndex {
  byTokenHash: Map<string, AccountSummary>;
  byPageId: Map<string, AccountSummary>;
  byBusinessId: Map<string, AccountSummary>;
  byChannelId: Map<string, AccountSummary>;
}

/**
 * Admin stats aggregation + mutation service. Keeps AdminController thin and
 * provides a single seam for serialising BigInt/Date values into JSON-safe
 * shapes. All read methods here are intentionally best-effort — admin
 * dashboards render partial data rather than fail outright.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mongo: MongoService,
    private readonly redis: RedisService,
    private readonly rateBucket: RateBucketService,
    private readonly bullmq: BullmqService,
    private readonly metrics: MetricsService,
    private readonly cadence: CadenceService,
    private readonly throttle: ThrottleLockService,
    private readonly accountsService: AccountsService,
    private readonly aes: AesLocalService,
    private readonly threadsTokenRefresh: ThreadsTokenRefreshService,
    private readonly bucTelemetry: BucTelemetryService,
    private readonly config: ConfigService,
    private readonly workspaces: WorkspacesService,
    @Inject(ADAPTER_REGISTRY) private readonly adapters: AdapterRegistry,
  ) {}

  /**
   * Resolve a workspace slug (from the admin panel topbar selector) to its
   * id, or return undefined when no slug was provided. Used by every list
   * method to compose a Prisma `where` clause: spread the result into the
   * existing where so legacy callers (no slug) keep their global behaviour.
   *
   * Returns the sentinel `'__NO_MATCH__'` for unknown slugs so downstream
   * queries yield zero rows instead of throwing a 5xx through the UI.
   */
  private async resolveWorkspaceId(
    slug: string | undefined | null,
  ): Promise<string | undefined> {
    if (typeof slug !== 'string' || slug.trim() === '') return undefined;
    try {
      const ws = await this.workspaces.findBySlug(slug.trim());
      return ws.id;
    } catch {
      return '__NO_MATCH__';
    }
  }

  /**
   * Resolve a slug to the set of accountIds in that workspace. Used by
   * tables that don't carry workspaceId directly (api_call_log,
   * event_log Mongo collection, raw_platform_responses) — we pre-fetch
   * the workspace's accounts and filter the downstream query with
   * `accountId IN (...)`.
   *
   * Returns undefined when no slug was given (no filter to apply); an
   * array (possibly empty) when a slug was given.
   */
  private async accountIdsForWorkspace(
    slug: string | undefined | null,
  ): Promise<bigint[] | undefined> {
    const wsId = await this.resolveWorkspaceId(slug);
    if (wsId === undefined) return undefined;
    if (wsId === '__NO_MATCH__') return [];
    const rows = await this.prisma.account.findMany({
      where: { workspaceId: wsId },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * Phase 1 of the rate-limit mirror. Returns the current Meta bucket
   * picture (one entry per asset/business/app id we've seen). Read-only —
   * no gating, no admission decisions. The data is written passively by
   * BucTelemetryService.observe() from every Graph response.
   */
  async rateLimitsSnapshot(): Promise<{
    generated_at: string;
    buckets: unknown[];
  }> {
    const buckets = await this.bucTelemetry.snapshot(50);
    return {
      generated_at: new Date().toISOString(),
      buckets,
    };
  }

  /**
   * Replays historical x-app-usage / x-business-use-case-usage from
   * api_call_log into the BucTelemetryService so the snapshot reflects
   * recent reality without waiting for the next sync cycle. Idempotent —
   * the latest call_count per bucket wins, which is what we'd see anyway
   * after the next live response.
   */
  async replayUsageHeaders(sinceHours = 24): Promise<{
    scanned: number;
    observed: number;
  }> {
    const since = new Date(Date.now() - sinceHours * 60 * 60_000);
    const rows = await this.prisma.apiCallLog.findMany({
      where: {
        calledAt: { gte: since },
        platform: { in: ['instagram', 'facebook', 'threads'] },
        usageHeader: { not: Prisma.JsonNull },
      },
      select: { usageHeader: true },
      orderBy: { calledAt: 'asc' },
    });
    let observed = 0;
    for (const r of rows) {
      const headers = r.usageHeader as Record<string, unknown> | null;
      if (!headers) continue;
      await this.bucTelemetry.observe(headers);
      observed += 1;
    }
    return { scanned: rows.length, observed };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Overview
  // ──────────────────────────────────────────────────────────────────────────

  async overview(
    workspaceSlug?: string | null,
  ): Promise<Record<string, unknown>> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const wsId = await this.resolveWorkspaceId(workspaceSlug);
    const accountFilter = wsId ? { workspaceId: wsId } : {};
    // API call log doesn't carry workspaceId; pre-resolve accountIds when
    // a workspace filter is active so the count is meaningful.
    const accountIdsForCallScope =
      wsId !== undefined
        ? await this.accountIdsForWorkspace(workspaceSlug)
        : undefined;
    const callIdFilter =
      accountIdsForCallScope === undefined
        ? {}
        : { accountId: { in: accountIdsForCallScope } };

    const [total, byPlatform, byStatus, syncsLastHour, webhooksLastHour] =
      await Promise.all([
        this.prisma.account.count({ where: accountFilter }),
        this.prisma.account.groupBy({
          by: ['platform'],
          where: accountFilter,
          _count: { _all: true },
        }),
        this.prisma.account.groupBy({
          by: ['status'],
          where: accountFilter,
          _count: { _all: true },
        }),
        this.prisma.apiCallLog.count({
          where: { calledAt: { gte: oneHourAgo }, ...callIdFilter },
        }),
        // Inbound webhook log has no account/workspace link — stays global.
        this.prisma.inboundWebhookLog.count({
          where: { receivedAt: { gte: oneHourAgo } },
        }),
      ]);

    const platformCounts: Record<string, number> = {};
    for (const row of byPlatform) platformCounts[row.platform] = row._count._all;

    const statusCounts: Record<string, number> = {};
    for (const row of byStatus) statusCounts[row.status] = row._count._all;

    const dlqDepth = await this.computeDlqDepth();

    const lastCalls = await this.prisma.apiCallLog.findMany({
      where: callIdFilter,
      orderBy: { calledAt: 'desc' },
      take: 500,
      select: { platform: true, calledAt: true },
    });

    const lastCallByPlatform = new Map<string, Date>();
    for (const c of lastCalls) {
      if (!lastCallByPlatform.has(c.platform)) {
        lastCallByPlatform.set(c.platform, c.calledAt);
      }
    }

    const buckets = await this.rateBucket.listAllBuckets();
    const bucketsActiveByPlatform = new Map<string, number>();
    for (const b of buckets) {
      const platform = this.platformFromBucketKey(b.bucketKey);
      bucketsActiveByPlatform.set(
        platform,
        (bucketsActiveByPlatform.get(platform) ?? 0) + 1,
      );
    }

    const platformsList = Array.from(
      new Set<string>([
        ...Object.keys(platformCounts),
        ...bucketsActiveByPlatform.keys(),
      ]),
    );

    return {
      accounts_total: total,
      accounts_by_platform: platformCounts,
      accounts_by_status: statusCounts,
      syncs_last_hour: syncsLastHour,
      webhooks_last_hour: webhooksLastHour,
      dlq_depth: dlqDepth,
      platforms: platformsList.map((platform) => ({
        platform,
        buckets_active: bucketsActiveByPlatform.get(platform) ?? 0,
        last_api_call_at: lastCallByPlatform.get(platform)?.toISOString() ?? null,
      })),
    };
  }

  private async computeDlqDepth(): Promise<number> {
    let total = 0;
    for (const name of QUEUE_NAMES) {
      try {
        const queue = this.bullmq.getQueue(name);
        total += await queue.getFailedCount();
      } catch (err: unknown) {
        this.logger.warn(
          `DLQ depth for queue ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return total;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Rate buckets
  // ──────────────────────────────────────────────────────────────────────────

  async listRateBuckets(): Promise<Record<string, unknown>> {
    const [states, accountIndex] = await Promise.all([
      this.rateBucket.listAllBuckets(),
      this.buildAccountIndex(),
    ]);
    const buckets = states.map((s) => {
      const decomposed = this.decomposeBucketKey(s.bucketKey);
      const usageRatio = s.capacity > 0 ? 1 - s.tokens / s.capacity : 0;
      const account = this.lookupBucketAccount(decomposed, accountIndex);
      return {
        key: s.bucketKey,
        platform: decomposed.platform,
        scope: s.scope,
        id_hash: decomposed.idHash,
        tokens: Math.round(s.tokens * 100) / 100,
        capacity: s.capacity,
        refill_per_ms: s.refillPerMs,
        last_acquire_at: s.lastAcquireAt,
        hits: s.hits,
        denies: s.denies,
        usage_ratio: Math.round(usageRatio * 10000) / 10000,
        account,
      };
    });
    return { buckets };
  }

  /**
   * Resolve which account a bucket belongs to. Returns null for app-wide
   * buckets (`rate:fb:app`, `rate:tt:qps_app`) and for buckets whose id
   * suffix doesn't match any current account (e.g. a stale page id from a
   * disconnected account that still has a live bucket).
   */
  private lookupBucketAccount(
    decomposed: { platform: string; idHash: string | null },
    index: AccountIndex,
  ): AccountSummary | null {
    if (!decomposed.idHash) return null;
    const id = decomposed.idHash;
    // Some keys append `:date` (TikTok daily buckets). Try both forms.
    const idNoDate = id.includes(':') ? id.split(':')[0] : id;
    return (
      index.byTokenHash.get(id) ??
      index.byTokenHash.get(idNoDate) ??
      index.byPageId.get(id) ??
      index.byPageId.get(idNoDate) ??
      index.byBusinessId.get(id) ??
      index.byBusinessId.get(idNoDate) ??
      index.byChannelId.get(id) ??
      index.byChannelId.get(idNoDate) ??
      null
    );
  }

  /**
   * Build a one-shot index from each Account's identifying secrets to a
   * compact AccountSummary. Costs O(N) AES decrypts (one per account) per
   * call — acceptable for the admin endpoint cadence (~every 2.5s) at PoC
   * scale. Caching could be added if it ever shows up on profiling.
   */
  private async buildAccountIndex(): Promise<AccountIndex> {
    const accounts = await this.prisma.account.findMany({
      include: { tokens: true },
    });
    const byTokenHash = new Map<string, AccountSummary>();
    const byPageId = new Map<string, AccountSummary>();
    const byBusinessId = new Map<string, AccountSummary>();
    const byChannelId = new Map<string, AccountSummary>();

    for (const a of accounts) {
      const summary: AccountSummary = {
        id: a.id.toString(),
        platform: a.platform,
        handle: a.handle ?? null,
        display_name: a.displayName ?? null,
      };
      const token = a.tokens[0];
      if (token) {
        try {
          const plain = this.aes.decrypt(Buffer.from(token.accessTokenCiphertext));
          const hash = createHash('sha256').update(plain, 'utf8').digest('hex').slice(0, 16);
          byTokenHash.set(hash, summary);
        } catch (err) {
          this.logger.warn(
            `Failed to derive token hash for account ${a.id.toString()}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      const md = (a.metadata ?? {}) as Record<string, unknown>;
      if (typeof md.page_id === 'string') byPageId.set(md.page_id, summary);
      if (typeof md.business_id === 'string') byBusinessId.set(md.business_id, summary);
      if (typeof md.open_id === 'string') byBusinessId.set(md.open_id, summary);
      if (typeof md.channel_id === 'string') byChannelId.set(md.channel_id, summary);
    }
    return { byTokenHash, byPageId, byBusinessId, byChannelId };
  }

  async bucketHistory(key: string, mins: number): Promise<Record<string, unknown>> {
    const points = this.metrics.getBucketHistory(key, mins).map((p) => ({
      ts: p.timestamp,
      tokens: p.tokens,
    }));
    return { key, points };
  }

  async resetBucket(key: string): Promise<Record<string, unknown>> {
    await this.rateBucket.reset(key);
    return { ok: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Queues
  // ──────────────────────────────────────────────────────────────────────────

  async listQueues(): Promise<Record<string, unknown>> {
    const queues = await Promise.all(
      QUEUE_NAMES.map(async (name) => {
        try {
          const queue = this.bullmq.getQueue(name);
          const [waiting, active, completed, failed, delayed] = await Promise.all([
            queue.getWaitingCount(),
            queue.getActiveCount(),
            queue.getCompletedCount(),
            queue.getFailedCount(),
            queue.getDelayedCount(),
          ]);

          const priorityBreakdown = await this.priorityBreakdown(name);

          return {
            name,
            waiting,
            active,
            completed,
            failed,
            delayed,
            priority_breakdown: priorityBreakdown,
          };
        } catch (err: unknown) {
          this.logger.warn(
            `Queue ${name} snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return {
            name,
            waiting: 0,
            active: 0,
            completed: 0,
            failed: 0,
            delayed: 0,
            priority_breakdown: { HIGH: 0, NORMAL: 0, BACKFILL: 0 },
          };
        }
      }),
    );
    return { queues };
  }

  private async priorityBreakdown(
    name: QueueName,
  ): Promise<Record<JobPriority, number>> {
    const breakdown: Record<JobPriority, number> = {
      HIGH: 0,
      NORMAL: 0,
      BACKFILL: 0,
    };

    try {
      const queue = this.bullmq.getQueue(name);
      const waiting = await queue.getWaiting(0, 500);
      for (const job of waiting) {
        const priorityNum = job.opts?.priority;
        if (priorityNum === 1) breakdown.HIGH += 1;
        else if (priorityNum === 3) breakdown.BACKFILL += 1;
        else breakdown.NORMAL += 1;
      }
    } catch {
      // swallow — breakdown is opportunistic
    }

    return breakdown;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Sync jobs
  // ──────────────────────────────────────────────────────────────────────────

  async listSyncJobs(filter: SyncJobFilter): Promise<Record<string, unknown>> {
    const where: Prisma.SyncJobWhereInput = {};
    if (filter.accountId !== undefined) where.accountId = filter.accountId;
    if (filter.status) where.status = filter.status;
    if (filter.platform) where.account = { platform: filter.platform };

    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);

    const [rows, total] = await Promise.all([
      this.prisma.syncJob.findMany({
        where,
        include: {
          account: { select: { handle: true, platform: true } },
        },
        orderBy: { nextRunAt: 'asc' },
        take: limit,
      }),
      this.prisma.syncJob.count({ where }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id.toString(),
        accountId: r.accountId.toString(),
        accountHandle: r.account?.handle ?? null,
        accountPlatform: r.account?.platform ?? null,
        product: r.product,
        status: r.status,
        priority: r.priority,
        next_run_at: r.nextRunAt?.toISOString() ?? null,
        last_success_at: r.lastSuccessAt?.toISOString() ?? null,
        last_attempt_at: r.lastAttemptAt?.toISOString() ?? null,
        last_error: r.lastError,
        failure_count: r.failureCount,
      })),
      total,
    };
  }

  /**
   * Single sync_job + computed effective settings.
   *
   * `settings` on the row are sparse — only what the admin has overridden.
   * `effective_settings` is what the worker would actually use this run,
   * after merging defaults / env vars on top.
   */
  async getSyncJob(id: bigint): Promise<Record<string, unknown>> {
    const job = await this.prisma.syncJob.findUniqueOrThrow({
      where: { id },
      include: {
        account: { select: { platform: true, handle: true } },
      },
    });
    return {
      id: job.id.toString(),
      account_id: job.accountId.toString(),
      account_handle: job.account.handle ?? null,
      platform: job.account.platform,
      product: job.product,
      status: job.status,
      priority: job.priority,
      next_run_at: job.nextRunAt?.toISOString() ?? null,
      last_success_at: job.lastSuccessAt?.toISOString() ?? null,
      last_attempt_at: job.lastAttemptAt?.toISOString() ?? null,
      last_error: job.lastError,
      failure_count: job.failureCount,
      settings: job.settings ?? null,
      effective_settings: this.computeEffectiveSettings(
        job.product,
        job.settings as Record<string, unknown> | null,
      ),
    };
  }

  async updateSyncJobSettings(
    id: bigint,
    settings: Record<string, unknown> | null,
  ): Promise<Record<string, unknown>> {
    // null clears the override (DB value -> SQL NULL). Empty object also
    // means "no overrides", but we keep the value as-is so the operator
    // can tell the difference between "never touched" and "intentionally
    // empty" if they look at the raw row.
    const data: Prisma.SyncJobUpdateInput =
      settings === null
        ? { settings: Prisma.JsonNull }
        : { settings: settings as Prisma.InputJsonValue };
    const updated = await this.prisma.syncJob.update({
      where: { id },
      data,
    });
    return {
      ok: true,
      id: updated.id.toString(),
      settings: updated.settings ?? null,
    };
  }

  /**
   * Compute the settings the worker would actually use, given the row's
   * sparse override + env vars + built-in defaults. UI uses this so the
   * operator sees the resolved values without having to know the
   * precedence rules.
   */
  private computeEffectiveSettings(
    product: string,
    settings: Record<string, unknown> | null,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (product === 'engagement_new') {
      const fromSettings = Number(settings?.lookbackDays);
      const fromEnv = Number(process.env.ENGAGEMENT_LOOKBACK_DAYS);
      // Default kept in sync with sync.worker.ts:ENGAGEMENT_LOOKBACK_DAYS_DEFAULT.
      out.lookbackDays =
        Number.isFinite(fromSettings) && fromSettings > 0
          ? Math.floor(fromSettings)
          : Number.isFinite(fromEnv) && fromEnv > 0
            ? Math.floor(fromEnv)
            : 90;
      const fromMax = Number(settings?.maxPostsPerSync);
      out.maxPostsPerSync =
        Number.isFinite(fromMax) && fromMax > 0 ? Math.floor(fromMax) : 500;
    }
    return out;
  }

  async reenqueueSyncJob(id: bigint): Promise<Record<string, unknown>> {
    const now = new Date();
    const updated = await this.prisma.syncJob.update({
      where: { id },
      data: { nextRunAt: now, status: 'idle' },
    });
    return { ok: true, id: updated.id.toString() };
  }

  /**
   * Pre-flight risk analysis for a manual "Run now" enqueue. Returns a
   * structured report the UI can render — each signal carries a severity
   * (`ok` / `warn` / `block`). The overall severity is the worst of all
   * signals.
   *
   *   block → button disabled in the UI; we refuse to enqueue.
   *   warn  → user must explicitly confirm before we enqueue.
   *   ok    → safe to enqueue without further confirmation.
   */
  async riskCheckSyncJob(id: bigint): Promise<{
    sync_job: {
      id: string;
      account_id: string;
      account_handle: string | null;
      platform: string;
      product: string;
      status: string;
      next_run_at: string | null;
      last_success_at: string | null;
      failure_count: number;
    };
    severity: 'ok' | 'warn' | 'block';
    signals: Array<{
      key: string;
      severity: 'ok' | 'warn' | 'block';
      message: string;
      value?: string | number;
    }>;
  }> {
    const job = await this.prisma.syncJob.findUniqueOrThrow({
      where: { id },
      include: {
        account: {
          select: {
            id: true,
            platform: true,
            handle: true,
            syncTier: true,
            status: true,
          },
        },
      },
    });

    const signals: Array<{
      key: string;
      severity: 'ok' | 'warn' | 'block';
      message: string;
      value?: string | number;
    }> = [];

    // — Account state —
    if (job.account.syncTier === 'paused') {
      signals.push({
        key: 'account_paused',
        severity: 'block',
        message:
          'Account is paused — the worker will skip this job immediately. Unpause first.',
      });
    }
    if (job.account.status === 'needs_reauth') {
      signals.push({
        key: 'needs_reauth',
        severity: 'block',
        message:
          'Account is in needs_reauth — the OAuth token is dead. Reconnect from /admin/connect first.',
      });
    }

    // — In-flight protection —
    if (job.status === 'queued') {
      signals.push({
        key: 'already_queued',
        severity: 'block',
        message: `This sync_job is already 'queued' — wait for the worker to pick it up.`,
      });
    }

    // — Rate buckets —
    // Meta family (FB + IG) → consult the BUC mirror (`app:{appId}`)
    // populated from X-App-Usage. TikTok still uses the legacy QPS bucket
    // (it is not modelled by the BUC mirror). Threads has its own pacing
    // and surfaces no admin signal here.
    if (job.account.platform === 'facebook' || job.account.platform === 'instagram') {
      try {
        const appKey = this.bucTelemetry.appKey();
        if (appKey) {
          const state = await this.bucTelemetry.getBucketPct(appKey.replace(/^app:/, ''));
          if (state) {
            if (state.callCountPct >= 75 || state.retryAfterMs > 0) {
              signals.push({
                key: 'bucket_critical',
                severity: 'block',
                message: `Meta app-level usage is at ${state.callCountPct}% (or in retry-after). The call will be denied by the BUC mirror gate.`,
                value: state.callCountPct,
              });
            } else if (state.callCountPct >= 50) {
              signals.push({
                key: 'bucket_low',
                severity: 'warn',
                message: `Meta app-level usage is at ${state.callCountPct}%. Heavy bursts may rate-limit and retry.`,
                value: state.callCountPct,
              });
            }
          }
        }
      } catch {
        // soft-fail; the worker has its own gate check.
      }
    } else if (job.account.platform === 'tiktok') {
      try {
        const state = await this.rateBucket.getState(this.redis.key('rate:tt:qps_app'));
        if (state && state.capacity > 0) {
          const ratio = state.tokens / state.capacity;
          if (ratio < 0.05) {
            signals.push({
              key: 'bucket_critical',
              severity: 'block',
              message: `TikTok QPS bucket is critically low (${state.tokens.toFixed(0)}/${state.capacity}). The call will be denied.`,
              value: state.tokens,
            });
          } else if (ratio < 0.3) {
            signals.push({
              key: 'bucket_low',
              severity: 'warn',
              message: `TikTok QPS bucket is below 30% (${state.tokens.toFixed(0)}/${state.capacity}). The job may rate-limit and retry.`,
              value: state.tokens,
            });
          }
        }
      } catch {
        // soft-fail; the worker has its own bucket check.
      }
    }

    // — BullMQ pressure —
    try {
      const queue = this.bullmq.getQueue(SYNC_QUEUE_NAME);
      const waiting = await queue.getWaitingCount();
      if (waiting >= 1900) {
        signals.push({
          key: 'queue_full',
          severity: 'block',
          message: `Sync queue is at the backpressure ceiling (${waiting} waiting). Try again once it drains.`,
          value: waiting,
        });
      } else if (waiting >= 1000) {
        signals.push({
          key: 'queue_pressure',
          severity: 'warn',
          message: `Sync queue is busy (${waiting} waiting). Your manual run may take a few minutes to start.`,
          value: waiting,
        });
      }
    } catch {
      // soft-fail
    }

    // — Throttle lock —
    try {
      const held = await this.throttle.isHeld(job.accountId, job.product);
      if (held) {
        signals.push({
          key: 'throttle_active',
          severity: 'warn',
          message:
            'Post-success throttle lock is held (10 min cooldown). The job will run but immediately no-op.',
        });
      }
    } catch {
      // soft-fail
    }

    // — Recent failures —
    if (job.failureCount >= 5) {
      signals.push({
        key: 'failures_critical',
        severity: 'block',
        message: `${job.failureCount} consecutive failures — the circuit breaker is about to pause this account. Investigate before manual retry.`,
        value: job.failureCount,
      });
    } else if (job.failureCount >= 2) {
      signals.push({
        key: 'recent_failures',
        severity: 'warn',
        message: `${job.failureCount} consecutive failures. Last error: ${job.lastError ?? '(none)'}`,
        value: job.failureCount,
      });
    }

    // — Imminent auto-run —
    const now = Date.now();
    if (job.nextRunAt && job.nextRunAt.getTime() <= now + 5 * 60_000 && job.nextRunAt.getTime() > now) {
      const minutes = Math.max(
        1,
        Math.round((job.nextRunAt.getTime() - now) / 60_000),
      );
      signals.push({
        key: 'imminent_auto_run',
        severity: 'warn',
        message: `An automatic run is already scheduled in ~${minutes} min. Manual enqueue duplicates the work.`,
        value: minutes,
      });
    }

    if (signals.length === 0) {
      signals.push({
        key: 'all_clear',
        severity: 'ok',
        message: 'All checks passed — safe to run now.',
      });
    }

    const overall: 'ok' | 'warn' | 'block' = signals.some((s) => s.severity === 'block')
      ? 'block'
      : signals.some((s) => s.severity === 'warn')
        ? 'warn'
        : 'ok';

    return {
      sync_job: {
        id: job.id.toString(),
        account_id: job.accountId.toString(),
        account_handle: job.account.handle ?? null,
        platform: job.account.platform,
        product: job.product,
        status: job.status,
        next_run_at: job.nextRunAt?.toISOString() ?? null,
        last_success_at: job.lastSuccessAt?.toISOString() ?? null,
        failure_count: job.failureCount,
      },
      severity: overall,
      signals,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Next runs timeline
  // ──────────────────────────────────────────────────────────────────────────

  async nextRuns(
    horizonHours: number,
    workspaceSlug?: string | null,
  ): Promise<Record<string, unknown>> {
    const now = new Date();
    const horizonMs = Math.max(1, horizonHours) * 60 * 60 * 1000;
    const until = new Date(now.getTime() + horizonMs);

    const wsId = await this.resolveWorkspaceId(workspaceSlug);
    const rows = await this.prisma.syncJob.findMany({
      where: {
        nextRunAt: { lte: until, not: null },
        ...(wsId ? { account: { workspaceId: wsId } } : {}),
      },
      include: {
        account: {
          select: {
            handle: true,
            platform: true,
            syncTier: true,
            id: true,
            workspace: { select: { slug: true } },
          },
        },
      },
      orderBy: { nextRunAt: 'asc' },
      take: 500,
    });

    const items = await Promise.all(
      rows.map(async (r) => {
        const effectiveNext = await this.cadence
          .resolveNextRunAt(r.accountId, r.product, now)
          .catch(() => null);
        const effectiveCadenceSeconds = effectiveNext
          ? Math.round((effectiveNext.getTime() - now.getTime()) / 1000)
          : null;

        return {
          id: r.id.toString(),
          accountId: r.accountId.toString(),
          accountHandle: r.account?.handle ?? null,
          platform: r.account?.platform ?? null,
          workspace_slug: r.account?.workspace?.slug ?? null,
          product: r.product,
          status: r.status,
          next_run_at: r.nextRunAt?.toISOString() ?? null,
          last_success_at: r.lastSuccessAt?.toISOString() ?? null,
          failure_count: r.failureCount,
          priority: r.priority,
          effective_cadence_seconds: effectiveCadenceSeconds,
        };
      }),
    );

    return { items };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Accounts
  // ──────────────────────────────────────────────────────────────────────────

  async listAccountsDetailed(
    workspaceSlug?: string | null,
  ): Promise<Record<string, unknown>> {
    const now = new Date();
    const wsId = await this.resolveWorkspaceId(workspaceSlug);
    const accounts = await this.prisma.account.findMany({
      where: wsId ? { workspaceId: wsId } : undefined,
      include: {
        tokens: { select: { expiresAt: true } },
        syncJobs: true,
        overrides: {
          where: {
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          select: { product: true },
        },
        workspace: { select: { slug: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const items = await Promise.all(
      accounts.map((a) => this.shapeAccount(a, now)),
    );
    return { items };
  }

  async getAccountDetailed(id: bigint): Promise<Record<string, unknown>> {
    const now = new Date();
    const account = await this.prisma.account.findUnique({
      where: { id },
      include: {
        tokens: true,
        syncJobs: true,
        overrides: {
          where: {
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        },
      },
    });
    if (!account) {
      throw new NotFoundException(`Account ${id.toString()} not found`);
    }
    return this.shapeAccount(account, now);
  }

  async updateSyncTier(
    id: bigint,
    tier: string,
  ): Promise<Record<string, unknown>> {
    const account = await this.prisma.account.update({
      where: { id },
      data: { syncTier: tier },
      include: { syncJobs: true },
    });

    const now = new Date();
    let rescheduled = 0;
    for (const job of account.syncJobs) {
      const next = await this.cadence.resolveNextRunAt(id, job.product, now);
      await this.prisma.syncJob.update({
        where: { id: job.id },
        data: { nextRunAt: next },
      });
      rescheduled += 1;
    }

    return { ok: true, jobs_rescheduled: rescheduled };
  }

  async upsertCadenceOverride(
    id: bigint,
    input: CadenceOverrideInput,
  ): Promise<Record<string, unknown>> {
    await this.prisma.accountCadenceOverride.upsert({
      where: { accountId_product: { accountId: id, product: input.product } },
      create: {
        accountId: id,
        product: input.product,
        overrideIntervalSeconds: input.intervalSeconds,
        reason: input.reason ?? null,
        expiresAt: input.expiresAt ?? null,
      },
      update: {
        overrideIntervalSeconds: input.intervalSeconds,
        reason: input.reason ?? null,
        expiresAt: input.expiresAt ?? null,
      },
    });

    await this.recomputeJobForProduct(id, input.product);
    return { ok: true };
  }

  async deleteCadenceOverride(
    id: bigint,
    product: string,
  ): Promise<Record<string, unknown>> {
    await this.prisma.accountCadenceOverride
      .delete({
        where: { accountId_product: { accountId: id, product } },
      })
      .catch(() => {
        // deleting a non-existent override is fine
      });

    await this.recomputeJobForProduct(id, product);
    return { ok: true };
  }

  async pauseAccount(id: bigint): Promise<Record<string, unknown>> {
    const account = await this.prisma.account.update({
      where: { id },
      data: { syncTier: 'paused' },
    });
    return this.serialiseAccount(account);
  }

  async unpauseAccount(id: bigint): Promise<Record<string, unknown>> {
    const account = await this.prisma.account.update({
      where: { id },
      data: { syncTier: 'standard' },
      include: { syncJobs: true },
    });

    const now = new Date();
    for (const job of account.syncJobs) {
      const next = await this.cadence.resolveNextRunAt(id, job.product, now);
      await this.prisma.syncJob.update({
        where: { id: job.id },
        data: { nextRunAt: next },
      });
    }

    return this.serialiseAccount(account);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Cadences
  // ──────────────────────────────────────────────────────────────────────────

  async listCadences(): Promise<Record<string, unknown>> {
    const rows = await this.prisma.cadence.findMany({
      orderBy: [{ platform: 'asc' }, { product: 'asc' }],
    });
    return {
      items: rows.map((r) => ({
        platform: r.platform,
        product: r.product,
        default_interval_seconds: r.defaultIntervalSeconds,
        updated_at: r.updatedAt.toISOString(),
      })),
    };
  }

  async updateCadence(
    platform: string,
    product: string,
    intervalSeconds: number,
  ): Promise<Record<string, unknown>> {
    await this.prisma.cadence.upsert({
      where: { platform_product: { platform, product } },
      create: {
        platform,
        product,
        defaultIntervalSeconds: intervalSeconds,
      },
      update: { defaultIntervalSeconds: intervalSeconds },
    });

    const affected = await this.prisma.syncJob.count({
      where: { product, account: { platform } },
    });
    const jobId = `cadence-recompute-${platform}-${product}-${Date.now()}`;

    // Recompute in background — return immediately.
    void this.recomputeCadenceBatch(platform, product).catch((err: unknown) => {
      this.logger.warn(
        `cadence recompute failed (${platform}/${product}): ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return { affected, job_id: jobId };
  }

  async cadenceProjection(): Promise<Record<string, unknown>> {
    const byPlatform = await this.cadence.projectHourlyCallsPerPlatform();
    const accounts = await this.prisma.account.groupBy({
      by: ['platform'],
      where: { syncTier: { not: 'paused' }, disconnectedAt: null },
      _count: { _all: true },
    });
    const accountsByPlatform = new Map<string, number>();
    for (const row of accounts) accountsByPlatform.set(row.platform, row._count._all);

    const platforms: Record<string, { calls_per_hour: number; accounts: number }> = {};
    for (const [platform, calls] of Object.entries(byPlatform)) {
      platforms[platform] = {
        calls_per_hour: calls,
        accounts: accountsByPlatform.get(platform) ?? 0,
      };
    }

    const total = Object.values(byPlatform).reduce((a, b) => a + b, 0);
    return {
      platforms,
      total_calls_per_hour: Math.round(total * 100) / 100,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Throttle locks
  // ──────────────────────────────────────────────────────────────────────────

  async listThrottleLocks(): Promise<Record<string, unknown>> {
    const locks = await this.throttle.listActive();
    return { locks };
  }

  async releaseThrottleLock(key: string): Promise<Record<string, unknown>> {
    await this.throttle.release(key);
    return { ok: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // API call log
  // ──────────────────────────────────────────────────────────────────────────

  async listApiCalls(
    filter: ApiCallFilter & { workspaceSlug?: string | null },
  ): Promise<Record<string, unknown>> {
    const where: Prisma.ApiCallLogWhereInput = {};
    if (filter.platform) where.platform = filter.platform;
    if (filter.accountId !== undefined) where.accountId = filter.accountId;
    if (filter.statusClass) {
      const range = this.statusClassRange(filter.statusClass);
      if (range) where.statusCode = range;
    }

    // Workspace filter: api_call_log carries accountId but no workspaceId.
    // Pre-resolve the workspace's account set and add accountId IN (...).
    // Calls without an accountId (platform-wide app calls) are excluded
    // when a workspace filter is active — they're not attributable.
    const scopedAccountIds = await this.accountIdsForWorkspace(
      filter.workspaceSlug,
    );
    if (scopedAccountIds !== undefined) {
      where.accountId = { in: scopedAccountIds };
    }

    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    const rows = await this.prisma.apiCallLog.findMany({
      where,
      orderBy: { calledAt: 'desc' },
      take: limit,
    });

    const accountIds = Array.from(
      new Set(rows.map((r) => r.accountId).filter((v): v is bigint => v !== null)),
    );

    const accountMap = new Map<
      string,
      { handle: string | null; workspaceSlug: string | null }
    >();
    if (accountIds.length > 0) {
      const accounts = await this.prisma.account.findMany({
        where: { id: { in: accountIds } },
        select: {
          id: true,
          handle: true,
          workspace: { select: { slug: true } },
        },
      });
      for (const a of accounts) {
        accountMap.set(a.id.toString(), {
          handle: a.handle,
          workspaceSlug: a.workspace?.slug ?? null,
        });
      }
    }

    return {
      items: rows.map((r) => {
        const acc = r.accountId ? accountMap.get(r.accountId.toString()) : null;
        return {
          platform: r.platform,
          endpoint: r.endpoint,
          method: r.method,
          status_code: r.statusCode,
          duration_ms: r.durationMs,
          tokens_before: r.tokensBefore,
          tokens_after: r.tokensAfter,
          usage_header: r.usageHeader,
          account_id: r.accountId?.toString() ?? null,
          account_handle: acc?.handle ?? null,
          workspace_slug: acc?.workspaceSlug ?? null,
          product: r.product ?? null,
          expected: r.expected ?? false,
          called_at: r.calledAt.toISOString(),
        };
      }),
    };
  }

  private statusClassRange(
    cls: string,
  ): { gte: number; lt: number } | null {
    switch (cls) {
      case '2xx':
        return { gte: 200, lt: 300 };
      case '3xx':
        return { gte: 300, lt: 400 };
      case '4xx':
        return { gte: 400, lt: 500 };
      case '5xx':
        return { gte: 500, lt: 600 };
      default:
        return null;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Webhooks
  // ──────────────────────────────────────────────────────────────────────────

  async listInboundWebhooks(limit: number): Promise<Record<string, unknown>> {
    const rows = await this.prisma.inboundWebhookLog.findMany({
      orderBy: { receivedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
    });
    return {
      items: rows.map((r) => ({
        id: r.id.toString(),
        platform: r.platform,
        event_id: r.eventId,
        received_at: r.receivedAt.toISOString(),
        signature_valid: r.signatureValid,
        account_resolved: r.accountResolved,
        processed: r.processed,
        payload_snippet: r.payloadSnippet,
      })),
    };
  }

  async webhookSilence(): Promise<Record<string, unknown>> {
    const now = new Date();
    const accounts = await this.prisma.account.findMany({
      where: { disconnectedAt: null },
      select: { id: true, platform: true, handle: true, canonicalUserId: true },
    });

    const items: Array<{
      account_id: string;
      account_handle: string | null;
      platform: string;
      product: string;
      last_received_at: string | null;
      silence_seconds: number;
    }> = [];

    for (const account of accounts) {
      for (const product of WEBHOOK_DRIVEN_PRODUCTS) {
        const lastWebhook = await this.prisma.inboundWebhookLog.findFirst({
          where: {
            platform: 'meta',
            accountResolved: true,
            payloadSnippet: { contains: account.canonicalUserId },
          },
          orderBy: { receivedAt: 'desc' },
          select: { receivedAt: true },
        });

        const lastAt = lastWebhook?.receivedAt ?? null;
        const silenceSeconds = lastAt
          ? Math.round((now.getTime() - lastAt.getTime()) / 1000)
          : Number.MAX_SAFE_INTEGER;

        items.push({
          account_id: account.id.toString(),
          account_handle: account.handle,
          platform: account.platform,
          product,
          last_received_at: lastAt?.toISOString() ?? null,
          silence_seconds: silenceSeconds,
        });
      }
    }

    items.sort((a, b) => b.silence_seconds - a.silence_seconds);
    return { items };
  }

  async replayWebhook(id: bigint): Promise<Record<string, unknown>> {
    const row = await this.prisma.inboundWebhookLog.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException(`Webhook ${id.toString()} not found`);
    }

    const snippet = row.payloadSnippet ?? '';
    let envelope: { entry?: Array<{ id?: string; changes?: Array<{ field?: string }> }> } =
      {};
    try {
      envelope = JSON.parse(snippet);
    } catch {
      // snippet is truncated — do our best with entry-less payload
    }

    const entry = envelope.entry?.[0];
    const fieldName = entry?.changes?.[0]?.field ?? '';
    const product = this.fieldToProduct(fieldName);
    const canonicalUserId = entry?.id;

    if (!canonicalUserId) {
      throw new NotFoundException(
        `Webhook ${id.toString()} has no resolvable entry.id`,
      );
    }

    const account = await this.prisma.account.findFirst({
      where: { canonicalUserId },
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundException(
        `No account for canonical_user_id=${canonicalUserId}`,
      );
    }

    const syncJob = await this.prisma.syncJob.findUnique({
      where: {
        accountId_product: { accountId: account.id, product },
      },
      select: { id: true },
    });

    const payload: SyncJobPayload = {
      jobId:
        syncJob?.id.toString() ??
        `replay-${account.id.toString()}-${product}`,
      accountId: account.id.toString(),
      product,
    };

    const queue = this.bullmq.getQueue<SyncJobPayload>(SYNC_QUEUE_NAME);
    const addedJob = await queue.add('sync', payload, {
      priority: this.bullmq.toPriorityNumber('HIGH'),
      jobId: `webhook-replay-${row.id.toString()}-${Date.now()}`,
    });

    return { ok: true, job_id: String(addedJob.id ?? '') };
  }

  private fieldToProduct(field: string): string {
    if (field === 'story_insights' || field === 'stories') return 'stories';
    return 'engagement_new';
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Events (Mongo)
  // ──────────────────────────────────────────────────────────────────────────

  async listEvents(
    filter: EventFilter & { workspaceSlug?: string | null },
  ): Promise<Record<string, unknown>> {
    const col = this.mongo.getCollection('event_log');
    const query: Record<string, unknown> = {};
    if (filter.eventType) query.event_type = filter.eventType;
    if (filter.accountId) query.account_id = filter.accountId;

    const scopedAccountIds = await this.accountIdsForWorkspace(
      filter.workspaceSlug,
    );
    if (scopedAccountIds !== undefined) {
      // event_log stores account_id as string; convert from bigint.
      query.account_id = { $in: scopedAccountIds.map((id) => id.toString()) };
    }

    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    const rows = await col
      .find(query)
      .sort({ emitted_at: -1 })
      .limit(limit)
      .toArray();

    return {
      items: rows.map((r) => this.mongoDocToJson(r)),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Raw responses (Mongo)
  // ──────────────────────────────────────────────────────────────────────────

  async listRawResponses(
    accountId: string | null,
    limit: number,
    workspaceSlug?: string | null,
  ): Promise<Record<string, unknown>> {
    const col = this.mongo.getCollection('raw_platform_responses');
    const query: Record<string, unknown> = {};
    if (accountId) query.accountId = accountId;

    const scopedAccountIds = await this.accountIdsForWorkspace(workspaceSlug);
    if (scopedAccountIds !== undefined) {
      query.accountId = { $in: scopedAccountIds.map((id) => id.toString()) };
    }

    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const rows = await col
      .find(query)
      .project({ body: 0 })
      .sort({ fetchedAt: -1 })
      .limit(safeLimit)
      .toArray();

    return {
      items: rows.map((r) => this.mongoDocToJson(r)),
    };
  }

  async getRawResponse(id: string): Promise<Record<string, unknown>> {
    const col = this.mongo.getCollection('raw_platform_responses');
    const { ObjectId } = await import('mongodb');

    let objectId: import('mongodb').ObjectId | null = null;
    try {
      objectId = new ObjectId(id);
    } catch {
      objectId = null;
    }

    const doc = objectId
      ? await col.findOne({ _id: objectId })
      : await col.findOne({ contentHash: id });

    if (!doc) {
      throw new NotFoundException(`raw_platform_response ${id} not found`);
    }
    return this.mongoDocToJson(doc);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Support matrix
  // ──────────────────────────────────────────────────────────────────────────

  supportMatrix(): Record<string, unknown> {
    const platforms: Record<string, unknown> = {};
    for (const [platform, adapter] of Object.entries(this.adapters)) {
      platforms[platform] = adapter.supportMatrix();
    }
    return { platforms };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  private async recomputeJobForProduct(
    accountId: bigint,
    product: string,
  ): Promise<void> {
    const now = new Date();
    const next = await this.cadence.resolveNextRunAt(accountId, product, now);
    await this.prisma.syncJob
      .update({
        where: { accountId_product: { accountId, product } },
        data: { nextRunAt: next },
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `recomputeJobForProduct failed (${accountId.toString()}/${product}): ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  private async recomputeCadenceBatch(
    platform: string,
    product: string,
  ): Promise<void> {
    const BATCH_SIZE = 500;
    const now = new Date();

    let cursor: bigint | null = null;
    for (;;) {
      const where: Prisma.SyncJobWhereInput = {
        product,
        account: { platform },
      };
      if (cursor !== null) where.id = { gt: cursor };

      const batch = await this.prisma.syncJob.findMany({
        where,
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: { id: true, accountId: true, product: true },
      });
      if (batch.length === 0) break;

      for (const job of batch) {
        const next = await this.cadence.resolveNextRunAt(
          job.accountId,
          job.product,
          now,
        );
        await this.prisma.syncJob.update({
          where: { id: job.id },
          data: { nextRunAt: next },
        });
      }

      cursor = batch[batch.length - 1].id;
      if (batch.length < BATCH_SIZE) break;
    }
  }

  private async shapeAccount(
    account: {
      id: bigint;
      platform: string;
      handle: string | null;
      status: string;
      syncTier: string;
      connectedAt: Date;
      tokens: ReadonlyArray<{ expiresAt: Date | null }>;
      syncJobs: ReadonlyArray<{
        product: string;
        status: string;
        nextRunAt: Date | null;
        lastSuccessAt: Date | null;
        lastError: string | null;
        failureCount: number;
      }>;
      overrides: ReadonlyArray<{ product: string }>;
      workspace?: { slug: string; name: string } | null;
    },
    now: Date,
  ): Promise<Record<string, unknown>> {
    const cadenceDefaults = await this.prisma.cadence.findMany({
      where: { platform: account.platform },
    });
    const cadenceMap = new Map<string, number>();
    for (const c of cadenceDefaults) cadenceMap.set(c.product, c.defaultIntervalSeconds);

    const overrideProducts = new Set(account.overrides.map((o) => o.product));

    return {
      id: account.id.toString(),
      platform: account.platform,
      handle: account.handle,
      status: account.status,
      sync_tier: account.syncTier,
      connected_at: account.connectedAt.toISOString(),
      token_expires_at: account.tokens[0]?.expiresAt?.toISOString() ?? null,
      workspace_slug: account.workspace?.slug ?? null,
      workspace_name: account.workspace?.name ?? null,
      products: account.syncJobs.map((j) => {
        const baseCadence = cadenceMap.get(j.product) ?? 86_400;
        const freshness = this.freshness(
          j.lastSuccessAt,
          j.failureCount,
          baseCadence,
          now,
        );
        return {
          product: j.product,
          last_success_at: j.lastSuccessAt?.toISOString() ?? null,
          next_run_at: j.nextRunAt?.toISOString() ?? null,
          status: j.status,
          failure_count: j.failureCount,
          last_error: j.lastError,
          override_active: overrideProducts.has(j.product),
          freshness,
        };
      }),
    };
  }

  private freshness(
    lastSuccessAt: Date | null,
    failureCount: number,
    cadenceSeconds: number,
    now: Date,
  ): Freshness {
    if (failureCount >= 3) return 'red';
    if (!lastSuccessAt) return 'red';
    const ageSec = (now.getTime() - lastSuccessAt.getTime()) / 1000;
    if (ageSec <= cadenceSeconds * 1.2) return 'green';
    if (ageSec <= cadenceSeconds * 2) return 'yellow';
    return 'red';
  }

  private serialiseAccount(
    account: {
      id: bigint;
      platform: string;
      handle: string | null;
      status: string;
      syncTier: string;
      connectedAt: Date;
    },
  ): Record<string, unknown> {
    return {
      id: account.id.toString(),
      platform: account.platform,
      handle: account.handle,
      status: account.status,
      sync_tier: account.syncTier,
      connected_at: account.connectedAt.toISOString(),
    };
  }

  private platformFromBucketKey(key: string): string {
    // connector-poc:rate:ig:user_token:abc → ig
    const stripped = key.replace(`${this.redis.ns}:rate:`, '');
    const first = stripped.split(':')[0];
    if (first === 'ig') return 'instagram';
    if (first === 'fb') return 'facebook';
    return first;
  }

  private decomposeBucketKey(key: string): {
    platform: string;
    idHash: string | null;
  } {
    const stripped = key.replace(`${this.redis.ns}:rate:`, '');
    const parts = stripped.split(':');
    const platform = this.platformFromBucketKey(key);
    const idHash = parts.length >= 3 ? parts.slice(2).join(':') : null;
    return { platform, idHash };
  }

  private mongoDocToJson(doc: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(doc)) {
      if (k === '_id') {
        out.id = v != null ? String(v) : null;
        continue;
      }
      if (v instanceof Date) {
        out[k] = v.toISOString();
        continue;
      }
      out[k] = v;
    }
    return out;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // System health
  // ──────────────────────────────────────────────────────────────────────────

  async systemHealth(): Promise<{
    mysql: { ok: boolean; latency_ms: number | null; error?: string };
    mongo: { ok: boolean; latency_ms: number | null; error?: string };
    redis: { ok: boolean; latency_ms: number | null; error?: string };
    worker: { last_attempt_at: string | null; idle_seconds: number | null };
    summary: 'ok' | 'warn' | 'danger';
  }> {
    const mysql = await this.pingMysql();
    const mongo = await this.pingMongo();
    const redis = await this.pingRedis();
    const worker = await this.workerHeartbeat();

    const idle = worker.idle_seconds;
    const workerOk = idle != null && idle < 600;
    const allOk = mysql.ok && mongo.ok && redis.ok && workerOk;
    const allDown = !mysql.ok && !mongo.ok && !redis.ok;

    return {
      mysql,
      mongo,
      redis,
      worker,
      summary: allOk ? 'ok' : allDown ? 'danger' : 'warn',
    };
  }

  /**
   * Effective operational configuration — the env + defaults the worker,
   * scheduler, and retention sweep actually resolve at runtime, mirrored
   * here so an operator can see how the platform is tuned without shelling
   * into the containers. Read-only: these are process-level knobs set via
   * env, surfaced (not mutated) by the admin UI.
   *
   * Each numeric field reports both the source (`env` vs `default`) and the
   * resolved value, so a misconfiguration ("why is the worker only doing 1
   * job at a time?") is diagnosable from the console.
   */
  systemConfig(): {
    worker: {
      concurrency: ResolvedNumber;
      engagement_lookback_days: ResolvedNumber;
    };
    scheduler: {
      tick_ms: ResolvedNumber;
      backpressure_max: ResolvedNumber;
    };
    retention: {
      inbound_log_days: ResolvedNumber;
      outbound_delivery_days: ResolvedNumber;
      api_call_log_days: ResolvedNumber;
      mongo_raw_days: ResolvedNumber;
      dry_run: boolean;
      schedule: string;
    };
  } {
    const dry = this.config.get<string>('WEBHOOKS_RETENTION_DRY_RUN');
    return {
      worker: {
        concurrency: resolveEnvInt('WORKER_CONCURRENCY', 4),
        engagement_lookback_days: resolveEnvInt('ENGAGEMENT_LOOKBACK_DAYS', 30),
      },
      scheduler: {
        tick_ms: resolveEnvInt('SCHEDULER_TICK_MS', 30_000),
        backpressure_max: resolveEnvInt('SCHEDULER_BACKPRESSURE_MAX', 2000),
      },
      retention: {
        inbound_log_days: resolveEnvInt('INBOUND_LOG_RETENTION_DAYS', 30),
        outbound_delivery_days: resolveEnvInt('OUTBOUND_DELIVERY_RETENTION_DAYS', 90),
        api_call_log_days: resolveEnvInt('API_CALL_LOG_RETENTION_DAYS', 30),
        mongo_raw_days: resolveEnvInt('MONGO_RAW_RETENTION_DAYS', 14),
        dry_run: dry !== undefined && /^(1|true|yes|on)$/i.test(dry.trim()),
        schedule: '03:00 UTC daily',
      },
    };
  }

  private async pingMysql(): Promise<{ ok: boolean; latency_ms: number | null; error?: string }> {
    const start = Date.now();
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return { ok: true, latency_ms: Date.now() - start };
    } catch (err) {
      return { ok: false, latency_ms: null, error: (err as Error).message };
    }
  }

  private async pingMongo(): Promise<{ ok: boolean; latency_ms: number | null; error?: string }> {
    const start = Date.now();
    try {
      await this.mongo.getDb().command({ ping: 1 });
      return { ok: true, latency_ms: Date.now() - start };
    } catch (err) {
      return { ok: false, latency_ms: null, error: (err as Error).message };
    }
  }

  private async pingRedis(): Promise<{ ok: boolean; latency_ms: number | null; error?: string }> {
    const start = Date.now();
    try {
      await this.redis.client.ping();
      return { ok: true, latency_ms: Date.now() - start };
    } catch (err) {
      return { ok: false, latency_ms: null, error: (err as Error).message };
    }
  }

  private async workerHeartbeat(): Promise<{
    last_attempt_at: string | null;
    idle_seconds: number | null;
  }> {
    try {
      const row = await this.prisma.syncJob.findFirst({
        orderBy: { lastAttemptAt: 'desc' },
        select: { lastAttemptAt: true },
      });
      const at = row?.lastAttemptAt ?? null;
      if (!at) return { last_attempt_at: null, idle_seconds: null };
      const idle = Math.round((Date.now() - at.getTime()) / 1000);
      return { last_attempt_at: at.toISOString(), idle_seconds: idle };
    } catch {
      return { last_attempt_at: null, idle_seconds: null };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Cadence overrides — flat list across accounts
  // ──────────────────────────────────────────────────────────────────────────

  async listCadenceOverrides(): Promise<
    Array<{
      account_id: string;
      account_handle: string | null;
      platform: string;
      product: string;
      interval_seconds: number;
      reason: string | null;
      created_at: string;
      expires_at: string | null;
    }>
  > {
    const rows = await this.prisma.accountCadenceOverride.findMany({
      include: {
        account: {
          select: { id: true, platform: true, handle: true },
        },
      },
      orderBy: [{ accountId: 'asc' }, { product: 'asc' }],
    });
    return rows.map((r) => ({
      account_id: r.account.id.toString(),
      account_handle: r.account.handle ?? null,
      platform: r.account.platform,
      product: r.product,
      interval_seconds: r.overrideIntervalSeconds,
      reason: r.reason ?? null,
      created_at: r.createdAt.toISOString(),
      expires_at: r.expiresAt ? r.expiresAt.toISOString() : null,
    }));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Connect new accounts (discover + seed)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Calls Meta Graph `/me` and `/me/accounts` to enumerate Pages and their
   * linked Instagram Business accounts. Returns a UI-ready payload so the
   * admin can one-click connect any of them.
   *
   * No data is persisted by this call — it's purely a probe.
   */
  async discoverConnections(
    accessToken: string,
    platform: 'facebook' | 'tiktok' | 'threads' | 'youtube' = 'facebook',
    openId?: string,
  ): Promise<{
    me: { id: string | null; name: string | null };
    token_type:
      | 'user'
      | 'page'
      | 'unknown'
      | 'tiktok-business'
      | 'threads-user'
      | 'youtube-channel';
    pages: Array<{
      page_id: string;
      page_name: string;
      page_access_token: string;
      page_already_connected: boolean;
      instagram?: {
        ig_business_id: string;
        username: string | null;
        name: string | null;
        followers_count: number | null;
        profile_picture_url: string | null;
        already_connected: boolean;
      };
    }>;
    tiktok_account?: {
      open_id: string;
      username: string | null;
      display_name: string | null;
      profile_image: string | null;
      followers_count: number | null;
      following_count: number | null;
      videos_count: number | null;
      total_likes: number | null;
      is_verified: boolean | null;
      already_connected: boolean;
    };
    threads_account?: {
      user_id: string;
      username: string | null;
      name: string | null;
      profile_picture_url: string | null;
      biography: string | null;
      is_verified: boolean | null;
      already_connected: boolean;
    };
    youtube_account?: {
      channel_id: string;
      handle: string | null;
      title: string | null;
      description: string | null;
      thumbnail_url: string | null;
      subscriber_count: number | null;
      video_count: number | null;
      view_count: number | null;
      country: string | null;
      uploads_playlist_id: string | null;
      already_connected: boolean;
    };
    warnings: string[];
  }> {
    if (platform === 'tiktok') {
      return this.discoverTikTokConnection(accessToken, openId);
    }
    if (platform === 'threads') {
      return this.discoverThreadsConnection(accessToken);
    }
    if (platform === 'youtube') {
      return this.discoverYoutubeConnection(accessToken);
    }
    const warnings: string[] = [];

    // 1. /me with the SAFE field set (id+name only — both User and Page
    //    objects have these). Asking for `category` or
    //    `instagram_business_account` here breaks User tokens with
    //    `(#100) Tried accessing nonexisting field (category)` because
    //    those fields only exist on Page objects. Disambiguation happens
    //    in step 2 via /me/accounts (User-token-only edge).
    type MeBody = {
      id?: string;
      name?: string;
      category?: string;
      instagram_business_account?: { id: string };
    };
    let meBody: MeBody;
    try {
      meBody = await this.graphGet<MeBody>(
        '/me',
        { fields: 'id,name' },
        accessToken,
      );
    } catch (err) {
      throw new BadRequestException({
        message:
          'Token rejected by Meta on /me — check it is a valid User or Page access token.',
        graph_error: this.extractGraphErrorMessage(err),
      });
    }
    const me = { id: meBody.id ?? null, name: meBody.name ?? null };

    type PageRow = {
      page_id: string;
      page_name: string;
      page_access_token: string;
      instagram_business_account_id: string | null;
    };
    let pageRows: PageRow[] = [];
    let tokenType: 'user' | 'page' | 'unknown' = 'unknown';

    // 2. Try /me/accounts (User-token path). If Meta says
    //    "nonexisting field (accounts)", this is a Page token — fall back.
    try {
      type GraphPage = {
        id: string;
        name: string;
        access_token: string;
        instagram_business_account?: { id: string };
      };
      const body = await this.graphGet<{ data?: GraphPage[] }>(
        '/me/accounts',
        {
          fields: 'id,name,access_token,instagram_business_account{id}',
          limit: '100',
        },
        accessToken,
      );
      tokenType = 'user';
      pageRows = (body.data ?? []).map((p) => ({
        page_id: p.id,
        page_name: p.name,
        page_access_token: p.access_token,
        instagram_business_account_id: p.instagram_business_account?.id ?? null,
      }));
    } catch (err) {
      const msg = this.extractGraphErrorMessage(err);
      const looksLikePageToken = /nonexisting field \(accounts\)/i.test(msg);
      if (looksLikePageToken && meBody.id) {
        // Page-token path: synthesize a single page entry from /me. The
        // supplied token IS the page-scoped token, so reuse it. Hydrate
        // the IG link via a side-call (we no longer ask for it in step 1
        // because the field 400s on User tokens).
        tokenType = 'page';
        let igId: string | null = null;
        try {
          const pageBody = await this.graphGet<{
            instagram_business_account?: { id: string };
          }>(`/${meBody.id}`, { fields: 'instagram_business_account{id}' }, accessToken);
          igId = pageBody.instagram_business_account?.id ?? null;
        } catch {
          // IG hydration is best-effort. If it fails, the page still shows
          // up without an IG link.
        }
        pageRows = [
          {
            page_id: meBody.id,
            page_name: meBody.name ?? meBody.id,
            page_access_token: accessToken,
            instagram_business_account_id: igId,
          },
        ];
        warnings.push(
          'Detected a Page access token. Showing only the Page this token controls. Paste a User token instead to enumerate every Page you manage.',
        );
      } else {
        warnings.push(`Could not list pages: ${msg}`);
      }
    }

    // 3. For each IG-linked page, hydrate username/followers in one extra
    //    call each (cheap, lifetime).
    const out: Awaited<ReturnType<typeof this.discoverConnections>>['pages'] = [];
    const existingAccounts = await this.prisma.account.findMany({
      where: {
        OR: [
          {
            platform: 'facebook',
            canonicalUserId: { in: pageRows.map((p) => p.page_id) },
          },
          {
            platform: 'instagram',
            canonicalUserId: {
              in: pageRows
                .map((p) => p.instagram_business_account_id)
                .filter((id): id is string => !!id),
            },
          },
        ],
      },
      select: { platform: true, canonicalUserId: true },
    });
    const connectedSet = new Set(
      existingAccounts.map((a) => `${a.platform}:${a.canonicalUserId}`),
    );

    for (const p of pageRows) {
      const row: (typeof out)[number] = {
        page_id: p.page_id,
        page_name: p.page_name,
        page_access_token: p.page_access_token,
        page_already_connected: connectedSet.has(`facebook:${p.page_id}`),
      };
      const igId = p.instagram_business_account_id;
      if (igId) {
        try {
          const ig = await this.graphGet<{
            id: string;
            username?: string;
            name?: string;
            followers_count?: number;
            profile_picture_url?: string;
          }>(
            `/${igId}`,
            { fields: 'id,username,name,followers_count,profile_picture_url' },
            p.page_access_token,
          );
          row.instagram = {
            ig_business_id: ig.id,
            username: ig.username ?? null,
            name: ig.name ?? null,
            followers_count: ig.followers_count ?? null,
            profile_picture_url: ig.profile_picture_url ?? null,
            already_connected: connectedSet.has(`instagram:${igId}`),
          };
        } catch (err) {
          row.instagram = {
            ig_business_id: igId,
            username: null,
            name: null,
            followers_count: null,
            profile_picture_url: null,
            already_connected: connectedSet.has(`instagram:${igId}`),
          };
          warnings.push(
            `IG metadata for page ${p.page_name} unavailable: ${this.extractGraphErrorMessage(err)}`,
          );
        }
      }
      out.push(row);
    }

    return { me, token_type: tokenType, pages: out, warnings };
  }

  /**
   * Persists a new Account + OAuthToken + sync_jobs by delegating to
   * AccountsService. Stores the page_id (for IG) inside metadata so the IG
   * adapter can use the per-page rate bucket later.
   */
  /**
   * Probe a TikTok Business Center token by hitting `/business/get/` with
   * the user-supplied open_id (== business_id in BC). Returns null if the
   * caller didn't pass an open_id; otherwise validates the token against
   * the live API and returns the basic profile snapshot.
   *
   * No data is persisted by this call — it's purely a probe.
   */
  private async discoverTikTokConnection(
    accessToken: string,
    openId?: string,
  ): Promise<Awaited<ReturnType<AdminService['discoverConnections']>>> {
    const warnings: string[] = [];
    const empty = {
      me: { id: openId ?? null, name: null },
      token_type: 'tiktok-business' as const,
      pages: [] as Awaited<
        ReturnType<AdminService['discoverConnections']>
      >['pages'],
      warnings,
    };
    if (!openId) {
      warnings.push(
        "Missing 'open_id'. The TikTok BC OAuth callback returns it alongside the access_token — paste it in the form so we can call /business/get/.",
      );
      return empty;
    }
    type TtAccount = {
      display_name?: string;
      username?: string;
      profile_image?: string;
      is_verified?: boolean;
      followers_count?: number;
      following_count?: number;
      videos_count?: number;
      total_likes?: number;
      bio_description?: string;
    };
    type TtEnvelope = { code: number; message: string; data: TtAccount };
    let body: TtEnvelope;
    try {
      const res = await axios.get<TtEnvelope>(
        'https://business-api.tiktok.com/open_api/v1.3/business/get/',
        {
          params: {
            business_id: openId,
            fields: JSON.stringify([
              'display_name',
              'username',
              'profile_image',
              'is_verified',
              'followers_count',
              'following_count',
              'videos_count',
              'total_likes',
              'bio_description',
            ]),
          },
          headers: {
            'Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
          timeout: DISCOVER_TIMEOUT_MS,
          validateStatus: () => true,
        },
      );
      body = res.data;
      if (res.status < 200 || res.status >= 300) {
        throw new BadRequestException({
          message: `TikTok HTTP ${res.status}`,
          tiktok_error: body,
        });
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException({
        message:
          'Token rejected by TikTok on /business/get/. Check the access_token + open_id pair from your BC OAuth callback.',
        tiktok_error: err instanceof Error ? err.message : String(err),
      });
    }
    if (body?.code !== 0) {
      throw new BadRequestException({
        message: `TikTok refused: code=${body?.code} ${body?.message ?? ''}`.trim(),
        tiktok_error: body,
      });
    }
    const acc = body.data ?? {};
    const username = acc.username ?? null;
    const existing = username
      ? await this.prisma.account.findFirst({
          where: { platform: 'tiktok', canonicalUserId: openId },
          select: { id: true },
        })
      : null;
    return {
      me: { id: openId, name: acc.display_name ?? null },
      token_type: 'tiktok-business',
      pages: [],
      tiktok_account: {
        open_id: openId,
        username,
        display_name: acc.display_name ?? null,
        profile_image: acc.profile_image ?? null,
        followers_count: acc.followers_count ?? null,
        following_count: acc.following_count ?? null,
        videos_count: acc.videos_count ?? null,
        total_likes: acc.total_likes ?? null,
        is_verified: acc.is_verified ?? null,
        already_connected: existing != null,
      },
      warnings,
    };
  }

  /**
   * Threads discover — calls graph.threads.net/v1.0/me with the long-lived
   * user token. The Threads OAuth flow returns just an access_token (no
   * separate user id), so /me is the canonical way to resolve the connected
   * user. Read-only probe; never persists.
   */
  private async discoverThreadsConnection(
    accessToken: string,
  ): Promise<Awaited<ReturnType<AdminService['discoverConnections']>>> {
    const warnings: string[] = [];
    type ThreadsMeBody = {
      id?: string;
      username?: string;
      name?: string;
      threads_profile_picture_url?: string;
      threads_biography?: string;
      is_verified?: boolean;
      error?: { message?: string; code?: number; error_subcode?: number };
    };
    let body: ThreadsMeBody;
    try {
      const res = await axios.get<ThreadsMeBody>(
        `${THREADS_GRAPH_BASE}/me`,
        {
          params: {
            fields:
              'id,username,name,threads_profile_picture_url,threads_biography,is_verified',
            access_token: accessToken,
          },
          timeout: DISCOVER_TIMEOUT_MS,
          validateStatus: () => true,
        },
      );
      body = res.data ?? {};
      if (res.status < 200 || res.status >= 300) {
        throw new BadRequestException({
          message: `Threads HTTP ${res.status}`,
          threads_error: body,
        });
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException({
        message:
          'Token rejected by Threads on /me. Verify the access_token is a long-lived Threads user token with scopes threads_basic + threads_manage_insights.',
        threads_error: err instanceof Error ? err.message : String(err),
      });
    }
    if (!body.id) {
      throw new BadRequestException({
        message: 'Threads /me returned no id; token may be malformed.',
        threads_error: body,
      });
    }
    const userId = body.id;
    const existing = await this.prisma.account.findFirst({
      where: { platform: 'threads', canonicalUserId: userId },
      select: { id: true },
    });
    return {
      me: { id: userId, name: body.name ?? body.username ?? null },
      token_type: 'threads-user',
      pages: [],
      threads_account: {
        user_id: userId,
        username: body.username ?? null,
        name: body.name ?? null,
        profile_picture_url: body.threads_profile_picture_url ?? null,
        biography: body.threads_biography ?? null,
        is_verified: body.is_verified ?? null,
        already_connected: existing != null,
      },
      warnings,
    };
  }

  /**
   * Probe a YouTube OAuth access token via Data API v3 channels.list(mine=true).
   * Resolves the channel the token belongs to. If multiple channels are
   * returned (brand-account ownership) we surface the first and add a
   * warning — Phase 5 will add a UI to pick.
   *
   * Cost: 1 Data API quota unit.
   */
  private async discoverYoutubeConnection(
    accessToken: string,
  ): Promise<Awaited<ReturnType<AdminService['discoverConnections']>>> {
    const warnings: string[] = [];
    type YtThumb = { url?: string };
    type YtChannel = {
      id?: string;
      snippet?: {
        title?: string;
        description?: string;
        customUrl?: string;
        country?: string;
        thumbnails?: { default?: YtThumb; medium?: YtThumb; high?: YtThumb };
      };
      statistics?: {
        viewCount?: string;
        subscriberCount?: string;
        videoCount?: string;
      };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
    };
    type YtListBody = {
      items?: YtChannel[];
      error?: { code?: number; message?: string };
    };
    let body: YtListBody;
    try {
      const res = await axios.get<YtListBody>(`${YOUTUBE_DATA_BASE}/channels`, {
        params: { part: 'snippet,statistics,contentDetails', mine: true },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: DISCOVER_TIMEOUT_MS,
        validateStatus: () => true,
      });
      body = res.data ?? {};
      if (res.status < 200 || res.status >= 300) {
        throw new BadRequestException({
          message: `YouTube HTTP ${res.status}`,
          youtube_error: body,
        });
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException({
        message:
          'Token rejected by YouTube on /channels?mine=true. Verify the access_token has scope youtube.readonly.',
        youtube_error: err instanceof Error ? err.message : String(err),
      });
    }
    const items = body.items ?? [];
    if (items.length === 0) {
      throw new BadRequestException({
        message: 'YouTube /channels?mine=true returned no items.',
        youtube_error: body,
      });
    }
    if (items.length > 1) {
      warnings.push(
        `OAuth token owns ${items.length} channels (brand accounts). Connecting the first; Phase 5 will add a picker.`,
      );
    }
    const ch = items[0];
    const channelId = ch.id ?? '';
    const existing = channelId
      ? await this.prisma.account.findFirst({
          where: { platform: 'youtube', canonicalUserId: channelId },
          select: { id: true },
        })
      : null;
    const handle = ch.snippet?.customUrl ? ch.snippet.customUrl.replace(/^@+/, '') : null;
    const thumb =
      ch.snippet?.thumbnails?.high?.url ??
      ch.snippet?.thumbnails?.medium?.url ??
      ch.snippet?.thumbnails?.default?.url ??
      null;
    return {
      me: { id: channelId || null, name: ch.snippet?.title ?? null },
      token_type: 'youtube-channel',
      pages: [],
      youtube_account: {
        channel_id: channelId,
        handle,
        title: ch.snippet?.title ?? null,
        description: ch.snippet?.description ?? null,
        thumbnail_url: thumb,
        subscriber_count: parseIntOrNull(ch.statistics?.subscriberCount),
        video_count: parseIntOrNull(ch.statistics?.videoCount),
        view_count: parseIntOrNull(ch.statistics?.viewCount),
        country: ch.snippet?.country ?? null,
        uploads_playlist_id: ch.contentDetails?.relatedPlaylists?.uploads ?? null,
        already_connected: existing != null,
      },
      warnings,
    };
  }

  async seedConnection(input: {
    platform: Platform;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
    canonicalUserId: string;
    handle?: string;
    metadata?: Record<string, unknown>;
    workspaceId?: string;
    workspaceSlug?: string;
    endUserId?: string;
    isTest?: boolean;
  }): Promise<{ account_id: string; sync_jobs_created: string[] }> {
    let accessToken = input.accessToken;
    let expiresAt = input.expiresAt;

    // Accept either an id (legacy path, used by connect-tool with the JWT
    // `ws` claim) or a slug (admin panel topbar selector). Slug wins when
    // both are present to keep the operator UI authoritative.
    let resolvedWorkspaceId = input.workspaceId;
    if (input.workspaceSlug) {
      try {
        const ws = await this.workspaces.findBySlug(input.workspaceSlug);
        resolvedWorkspaceId = ws.id;
      } catch {
        throw new BadRequestException(
          `Unknown workspace slug: ${input.workspaceSlug}`,
        );
      }
    }

    // Threads: trade a short-lived (1h) token for a long-lived one (60d).
    // Idempotent — if the token is already long-lived Meta returns it
    // unchanged; if THREADS_APP_SECRET isn't configured or upstream rejects,
    // fall back to the original token. Persisting `expiresAt` is what lets
    // ThreadsTokenRefreshService.ensureFresh refresh proactively before
    // expiry; without it the refresh path early-returns and the token dies.
    if (input.platform === 'threads') {
      try {
        const exchanged = await this.threadsTokenRefresh.exchangeShortLived(
          input.accessToken,
        );
        accessToken = exchanged.accessToken;
        if (exchanged.expiresInS && exchanged.expiresInS > 0) {
          expiresAt = new Date(Date.now() + exchanged.expiresInS * 1000);
        }
        this.logger.log(
          `Threads token exchanged to long-lived (expires_in=${exchanged.expiresInS ?? 'unknown'}s)`,
        );
      } catch (err) {
        this.logger.warn(
          `Threads exchangeShortLived failed; persisting the original token. Reason: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return this.accountsService.seedAccount({
      platform: input.platform,
      accessToken,
      refreshToken: input.refreshToken,
      expiresAt,
      canonicalUserId: input.canonicalUserId,
      handle: input.handle,
      metadata: input.metadata,
      workspaceId: resolvedWorkspaceId,
      endUserId: input.endUserId,
      isTest: input.isTest,
    });
  }

  private async graphGet<T>(
    endpoint: string,
    params: Record<string, string>,
    accessToken: string,
  ): Promise<T> {
    const res = await axios.get<T>(`${GRAPH_BASE}${endpoint}`, {
      params: { ...params, access_token: accessToken },
      timeout: DISCOVER_TIMEOUT_MS,
      validateStatus: () => true,
    });
    if (res.status < 200 || res.status >= 300) {
      const err = new Error(`HTTP ${res.status}`) as Error & {
        body?: unknown;
        status?: number;
      };
      err.body = res.data;
      err.status = res.status;
      throw err;
    }
    return res.data;
  }

  private extractGraphErrorMessage(err: unknown): string {
    if (axios.isAxiosError(err)) {
      const data = (err as AxiosError<{ error?: { message?: string } }>).response
        ?.data;
      if (data?.error?.message) return data.error.message;
      return err.message;
    }
    if (err && typeof err === 'object') {
      const e = err as {
        body?: { error?: { message?: string } };
        message?: string;
      };
      if (e.body?.error?.message) return e.body.error.message;
      if (e.message) return e.message;
    }
    return String(err);
  }
}

function parseIntOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
  return null;
}

// Augment AdminService with the YouTube OAuth helpers via prototype patching
// so we don't have to interleave another large method block in the middle of
// the existing class. (Same pattern would normally be a private method but
// this keeps the diff localised.)
declare module './admin.service' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface AdminService {
    youtubeAuthorizeUrl(includeMonetary: boolean): { url: string; scopes: string[] };
    youtubeCompleteOAuth(code: string): Promise<unknown>;
  }
}

const YOUTUBE_SCOPES_BASE = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];
const YOUTUBE_SCOPE_MONETARY =
  'https://www.googleapis.com/auth/yt-analytics-monetary.readonly';
const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

AdminService.prototype.youtubeAuthorizeUrl = function (
  this: AdminService,
  includeMonetary: boolean,
): { url: string; scopes: string[] } {
  const config = (this as unknown as { config: ConfigService }).config;
  const clientId = config.get<string>('GOOGLE_CLIENT_ID');
  const redirectUri = config.get<string>('GOOGLE_REDIRECT_URI');
  if (!clientId || !redirectUri) {
    throw new BadRequestException(
      'GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI must be set in .env',
    );
  }
  const scopes = includeMonetary
    ? [...YOUTUBE_SCOPES_BASE, YOUTUBE_SCOPE_MONETARY]
    : [...YOUTUBE_SCOPES_BASE];
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: scopes.join(' '),
  });
  return { url: `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`, scopes };
};

AdminService.prototype.youtubeCompleteOAuth = async function (
  this: AdminService,
  code: string,
): Promise<unknown> {
  const config = (this as unknown as { config: ConfigService }).config;
  const accountsService = (this as unknown as { accountsService: AccountsService })
    .accountsService;
  const clientId = config.get<string>('GOOGLE_CLIENT_ID');
  const clientSecret = config.get<string>('GOOGLE_CLIENT_SECRET');
  const redirectUri = config.get<string>('GOOGLE_REDIRECT_URI');
  if (!clientId || !clientSecret || !redirectUri) {
    throw new BadRequestException(
      'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI must all be set.',
    );
  }

  // Exchange code for tokens.
  const tokenParams = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const tokenRes = await axios.post<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  }>(GOOGLE_TOKEN_URL, tokenParams, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: DISCOVER_TIMEOUT_MS,
    validateStatus: () => true,
  });
  if (tokenRes.status < 200 || tokenRes.status >= 300 || !tokenRes.data?.access_token) {
    throw new BadRequestException({
      message: `YouTube token exchange failed (HTTP ${tokenRes.status})`,
      google_error: tokenRes.data,
    });
  }
  const accessToken = tokenRes.data.access_token;
  const refreshToken = tokenRes.data.refresh_token;
  const expiresAt =
    tokenRes.data.expires_in && tokenRes.data.expires_in > 0
      ? new Date(Date.now() + tokenRes.data.expires_in * 1000)
      : undefined;
  const scopes = tokenRes.data.scope ? tokenRes.data.scope.split(' ') : undefined;

  // Discover the channel and seed the account.
  const probe = await this.discoverConnections(accessToken, 'youtube');
  const yt = probe.youtube_account;
  if (!yt || !yt.channel_id) {
    throw new BadRequestException({
      message: 'YouTube discover returned no channel after token exchange.',
      probe,
    });
  }

  const seeded = await accountsService.seedAccount({
    platform: 'youtube',
    accessToken,
    refreshToken,
    expiresAt,
    canonicalUserId: yt.channel_id,
    handle: yt.handle ?? undefined,
    metadata: {
      channel_id: yt.channel_id,
      uploads_playlist_id: yt.uploads_playlist_id ?? undefined,
      country: yt.country ?? undefined,
      scopes,
    },
  });

  return {
    seeded,
    youtube_account: yt,
    warnings: probe.warnings,
  };
};
