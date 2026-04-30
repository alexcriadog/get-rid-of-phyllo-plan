import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { PrismaService } from '@shared/database/prisma.service';
import { BullMqService, SyncJobPayload } from '@shared/redis/bullmq.service';
import { MetricsService } from '@shared/metrics/metrics.service';
import { RateBucketService } from '@shared/redis/rate-bucket.service';
import { RedisService } from '@shared/redis/redis.service';

const DEFAULT_TICK_MS = 30_000;
const MAX_ROWS_PER_TICK = 500;
const SYNC_QUEUE_NAME = 'sync';

/**
 * Stop enqueueing when the BullMQ waiting count crosses this watermark — the
 * worker is clearly behind and stacking more jobs just inflates Redis without
 * helping throughput. Once it drains below the line, ticks resume. Override
 * via `SCHEDULER_BACKPRESSURE_MAX`.
 */
const DEFAULT_BACKPRESSURE_MAX = 2000;

/**
 * Run the orphan-sweep every N scheduler ticks. With the default 30s tick
 * that's once every 10 minutes — enough to recover from a worker crash
 * within a couple of cycles, rare enough to cost ~nothing.
 */
const SWEEP_EVERY_N_TICKS = 20;

/**
 * A `sync_jobs` row is considered orphan-stuck if it has been in
 * `status='queued'` for longer than this. The worker normally takes seconds
 * (or up to a couple of minutes for large fetches); 30 min is well past any
 * legitimate processing time, so a row older than that with no progress is
 * almost certainly a worker-crash artefact.
 */
const ORPHAN_QUEUED_AGE_MS = 30 * 60_000;

/**
 * App-level rate buckets the scheduler peeks before encolar Meta jobs. If
 * any of these are below `PREFLIGHT_FLOOR_FRACTION` of capacity, the
 * platform's jobs are deferred to a future tick — the worker would just
 * RateLimitedError them anyway, costing a Mongo write + Prisma update for
 * nothing. TikTok's QPS bucket refills 10/s so it's never a concern at the
 * scheduler level; per-business daily buckets are account-scoped, so the
 * worker's own bucket check is the right place for those.
 */
const PREFLIGHT_BUCKETS_BY_PLATFORM: Readonly<Record<string, string[]>> = {
  facebook: ['rate:fb:app'],
  instagram: ['rate:ig:app'],
};
const PREFLIGHT_FLOOR_FRACTION = 0.1;       // 10% — leave headroom for inflight

type JobPriority = 'HIGH' | 'NORMAL' | 'BACKFILL';

/**
 * Scheduler process.
 *
 * Only wakes up when the process was started with `node main.js scheduler`.
 * In other modes (api, worker) this bean is still instantiated by Nest
 * but `onApplicationBootstrap` no-ops, so there is no polling overhead.
 */
@Injectable()
export class SchedulerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SchedulerService.name);
  private tickHandle: NodeJS.Timeout | null = null;
  private inFlight = false;
  /** Increments every tick. Used to throttle the orphan sweep. */
  private tickCounter = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bullmq: BullMqService,
    private readonly metrics: MetricsService,
    private readonly rateBucket: RateBucketService,
    private readonly redis: RedisService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.argv[2] !== 'scheduler') {
      this.logger.debug('Not running in scheduler mode — no-op bootstrap');
      return;
    }

    const tickMs = this.resolveTickMs();
    this.logger.log(`Scheduler starting, tick=${tickMs}ms`);

    // Fire once immediately, then on a fixed interval
    void this.tickSafe();
    this.tickHandle = setInterval(() => void this.tickSafe(), tickMs);
  }

  onApplicationShutdown(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
      this.logger.log('Scheduler stopped');
    }
  }

  private resolveTickMs(): number {
    const raw = process.env.SCHEDULER_TICK_MS;
    if (!raw) return DEFAULT_TICK_MS;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      this.logger.warn(`Invalid SCHEDULER_TICK_MS=${raw}; using default ${DEFAULT_TICK_MS}`);
      return DEFAULT_TICK_MS;
    }
    return n;
  }

  /**
   * Guard re-entry: overlapping ticks would double-enqueue jobs between
   * the findMany and the status update.
   */
  private async tickSafe(): Promise<void> {
    if (this.inFlight) {
      this.logger.debug('Scheduler tick already in flight, skipping');
      return;
    }

    this.inFlight = true;
    try {
      await this.tick();
    } catch (err) {
      this.logger.error('Scheduler tick failed', err instanceof Error ? err.stack : String(err));
    } finally {
      this.inFlight = false;
    }
  }

  private async tick(): Promise<void> {
    const now = new Date();
    this.tickCounter += 1;

    // Recover orphan rows that got stuck in `status='queued'` because the
    // worker crashed mid-job. Cheap query, runs every 10 min.
    if (this.tickCounter % SWEEP_EVERY_N_TICKS === 0) {
      await this.sweepOrphans(now);
    }

    const queue = this.bullmq.getQueue<SyncJobPayload>(SYNC_QUEUE_NAME);

    // Backpressure: if the queue is already deep, skip this tick. Otherwise
    // a slow worker accumulates jobs in Redis indefinitely.
    const backpressureMax = this.resolveBackpressureMax();
    const waiting = await queue.getWaitingCount();
    if (waiting >= backpressureMax) {
      this.metrics.incr('scheduler_tick_backpressure', {});
      this.logger.debug(
        `Scheduler tick: backpressure waiting=${waiting} (max=${backpressureMax}); skip`,
      );
      return;
    }
    // Cap how many we enqueue this tick so we don't push past the watermark.
    const enqueueBudget = Math.min(MAX_ROWS_PER_TICK, backpressureMax - waiting);

    const rawRows = await this.prisma.syncJob.findMany({
      where: {
        status: 'idle',
        nextRunAt: { lte: now, not: null },
        // Defence in depth against ban risk: never enqueue for paused or
        // broken accounts. The worker enforces the same invariants, but
        // filtering here stops us from even adding the BullMQ job.
        account: {
          syncTier: { not: 'paused' },
          status: { not: 'needs_reauth' },
        },
      },
      orderBy: [{ priority: 'desc' }, { nextRunAt: 'asc' }],
      take: enqueueBudget,
      include: { account: { select: { platform: true } } },
    });

    if (rawRows.length === 0) {
      this.metrics.incr('scheduler_tick_empty', {});
      return;
    }

    // Pre-flight: if a platform's app bucket is exhausted, defer those jobs
    // for this tick — encolar them just to have the worker reject is waste.
    const blockedPlatforms = await this.preflightCheck();
    let deferred = 0;
    const rows = rawRows.filter((r) => {
      if (blockedPlatforms.has(r.account.platform)) {
        deferred += 1;
        this.metrics.incr('scheduler_preflight_skip', {
          platform: r.account.platform,
        });
        return false;
      }
      return true;
    });
    if (deferred > 0) {
      this.logger.debug(
        `Scheduler tick: deferred ${deferred} jobs for platforms [${[...blockedPlatforms].join(', ')}] (bucket below ${Math.round(PREFLIGHT_FLOOR_FRACTION * 100)}%)`,
      );
    }
    if (rows.length === 0) {
      this.metrics.incr('scheduler_tick_all_deferred', {});
      return;
    }

    this.metrics.incr('scheduler_tick_rows', {}, rows.length);
    this.logger.debug(`Scheduler tick: enqueueing ${rows.length} jobs (waiting=${waiting})`);

    for (const row of rows) {
      const payload: SyncJobPayload = {
        jobId: row.id.toString(),
        accountId: row.accountId.toString(),
        product: row.product,
      };

      try {
        await queue.add('sync', payload, {
          priority: this.bullmq.toPriorityNumber(this.normalisePriority(row.priority)),
          jobId: `sync-${payload.jobId}-${row.updatedAt.getTime()}`,
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 86_400, count: 500 },
        });

        await this.prisma.syncJob.update({
          where: { id: row.id },
          data: { status: 'queued' },
        });

        this.metrics.incr('scheduler_enqueued', { product: row.product });
      } catch (err) {
        this.logger.error(
          `Failed to enqueue sync_job ${row.id.toString()}: ${err instanceof Error ? err.message : String(err)}`,
        );
        this.metrics.incr('scheduler_enqueue_error', { product: row.product });
      }
    }
  }

  private normalisePriority(raw: string): JobPriority {
    if (raw === 'HIGH' || raw === 'NORMAL' || raw === 'BACKFILL') {
      return raw;
    }
    return 'NORMAL';
  }

  /**
   * Returns the set of platform names whose app-level rate bucket is below
   * the floor — those jobs should be deferred this tick. We peek (no spend)
   * via `getState`, so this costs one HMGET per bucket and never burns a
   * token. If the bucket has never been touched (state=null) we treat it as
   * "fine" — first acquire will populate it.
   */
  private async preflightCheck(): Promise<Set<string>> {
    const blocked = new Set<string>();
    const probes = Object.entries(PREFLIGHT_BUCKETS_BY_PLATFORM).flatMap(
      ([platform, suffixes]) =>
        suffixes.map(async (suffix) => {
          try {
            const state = await this.rateBucket.getState(this.redis.key(suffix));
            if (!state) return;
            const floor = state.capacity * PREFLIGHT_FLOOR_FRACTION;
            if (state.tokens < floor) {
              blocked.add(platform);
            }
          } catch (err) {
            this.logger.warn(
              `Preflight peek failed for ${suffix}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }),
    );
    await Promise.all(probes);
    return blocked;
  }

  private resolveBackpressureMax(): number {
    const raw = process.env.SCHEDULER_BACKPRESSURE_MAX;
    if (!raw) return DEFAULT_BACKPRESSURE_MAX;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      return DEFAULT_BACKPRESSURE_MAX;
    }
    return Math.floor(n);
  }

  /**
   * Reset rows stuck in `status='queued'` long enough that the worker has
   * almost certainly crashed mid-job. Once back to `idle`, the next tick
   * will pick them up via the normal nextRunAt filter (which is in the past
   * by the time we get here, so they'll be re-enqueued promptly).
   *
   * Safe under races: BullMQ deduplicates by jobId (`sync-${id}-${updatedAt}`).
   * If the original job was somehow still alive in the queue, the reset bumps
   * `updatedAt`, the new enqueue gets a NEW BullMQ jobId, and worst case the
   * worker runs the job twice — the second pass hits the throttle lock and
   * no-ops in milliseconds.
   */
  private async sweepOrphans(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - ORPHAN_QUEUED_AGE_MS);
    const result = await this.prisma.syncJob.updateMany({
      where: {
        status: 'queued',
        updatedAt: { lt: cutoff },
      },
      data: {
        status: 'idle',
        lastError: 'swept_orphan_queued',
      },
    });
    if (result.count > 0) {
      this.logger.warn(
        `Orphan sweep: reset ${result.count} stuck 'queued' rows older than ${ORPHAN_QUEUED_AGE_MS / 60_000}min back to 'idle'`,
      );
      this.metrics.incr('scheduler_orphan_sweep', {}, result.count);
    }
  }
}
