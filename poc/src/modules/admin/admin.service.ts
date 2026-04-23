import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import { MongoService } from '@shared/database/mongo.service';
import { RedisService } from '@shared/redis/redis.service';
import { RateBucketService } from '@shared/redis/rate-bucket.service';
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

const SYNC_QUEUE_NAME: QueueName = 'sync';
const EVENTS_QUEUE_NAME: QueueName = 'events';
const DELIVERY_QUEUE_NAME: QueueName = 'delivery';

const QUEUE_NAMES: ReadonlyArray<QueueName> = [
  SYNC_QUEUE_NAME,
  EVENTS_QUEUE_NAME,
  DELIVERY_QUEUE_NAME,
];

const WEBHOOK_DRIVEN_PRODUCTS: ReadonlyArray<string> = ['engagement_new'];

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
    @Inject(ADAPTER_REGISTRY) private readonly adapters: AdapterRegistry,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Overview
  // ──────────────────────────────────────────────────────────────────────────

  async overview(): Promise<Record<string, unknown>> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const [total, byPlatform, byStatus, syncsLastHour, webhooksLastHour] =
      await Promise.all([
        this.prisma.account.count(),
        this.prisma.account.groupBy({
          by: ['platform'],
          _count: { _all: true },
        }),
        this.prisma.account.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.prisma.apiCallLog.count({
          where: { calledAt: { gte: oneHourAgo } },
        }),
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
    const states = await this.rateBucket.listAllBuckets();
    const buckets = states.map((s) => {
      const decomposed = this.decomposeBucketKey(s.bucketKey);
      const usageRatio = s.capacity > 0 ? 1 - s.tokens / s.capacity : 0;
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
      };
    });
    return { buckets };
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

  async reenqueueSyncJob(id: bigint): Promise<Record<string, unknown>> {
    const now = new Date();
    const updated = await this.prisma.syncJob.update({
      where: { id },
      data: { nextRunAt: now, status: 'idle' },
    });
    return { ok: true, id: updated.id.toString() };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Next runs timeline
  // ──────────────────────────────────────────────────────────────────────────

  async nextRuns(horizonHours: number): Promise<Record<string, unknown>> {
    const now = new Date();
    const horizonMs = Math.max(1, horizonHours) * 60 * 60 * 1000;
    const until = new Date(now.getTime() + horizonMs);

    const rows = await this.prisma.syncJob.findMany({
      where: {
        nextRunAt: { lte: until, not: null },
      },
      include: {
        account: {
          select: { handle: true, platform: true, syncTier: true, id: true },
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
          accountId: r.accountId.toString(),
          accountHandle: r.account?.handle ?? null,
          platform: r.account?.platform ?? null,
          product: r.product,
          next_run_at: r.nextRunAt?.toISOString() ?? null,
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

  async listAccountsDetailed(): Promise<Record<string, unknown>> {
    const now = new Date();
    const accounts = await this.prisma.account.findMany({
      include: {
        tokens: { select: { expiresAt: true } },
        syncJobs: true,
        overrides: {
          where: {
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          select: { product: true },
        },
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

  async listApiCalls(filter: ApiCallFilter): Promise<Record<string, unknown>> {
    const where: Prisma.ApiCallLogWhereInput = {};
    if (filter.platform) where.platform = filter.platform;
    if (filter.accountId !== undefined) where.accountId = filter.accountId;
    if (filter.statusClass) {
      const range = this.statusClassRange(filter.statusClass);
      if (range) where.statusCode = range;
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

    const accountMap = new Map<string, string | null>();
    if (accountIds.length > 0) {
      const accounts = await this.prisma.account.findMany({
        where: { id: { in: accountIds } },
        select: { id: true, handle: true },
      });
      for (const a of accounts) accountMap.set(a.id.toString(), a.handle);
    }

    return {
      items: rows.map((r) => ({
        platform: r.platform,
        endpoint: r.endpoint,
        method: r.method,
        status_code: r.statusCode,
        duration_ms: r.durationMs,
        tokens_before: r.tokensBefore,
        tokens_after: r.tokensAfter,
        usage_header: r.usageHeader,
        account_id: r.accountId?.toString() ?? null,
        account_handle: r.accountId
          ? accountMap.get(r.accountId.toString()) ?? null
          : null,
        called_at: r.calledAt.toISOString(),
      })),
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

  async listEvents(filter: EventFilter): Promise<Record<string, unknown>> {
    const col = this.mongo.getCollection('event_log');
    const query: Record<string, unknown> = {};
    if (filter.eventType) query.event_type = filter.eventType;
    if (filter.accountId) query.account_id = filter.accountId;

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
  ): Promise<Record<string, unknown>> {
    const col = this.mongo.getCollection('raw_platform_responses');
    const query: Record<string, unknown> = {};
    if (accountId) query.accountId = accountId;

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
}
