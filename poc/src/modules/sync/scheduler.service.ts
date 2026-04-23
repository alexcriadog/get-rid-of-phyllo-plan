import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { PrismaService } from '@shared/database/prisma.service';
import { BullMqService, SyncJobPayload } from '@shared/redis/bullmq.service';
import { MetricsService } from '@shared/metrics/metrics.service';

const DEFAULT_TICK_MS = 30_000;
const MAX_ROWS_PER_TICK = 500;
const SYNC_QUEUE_NAME = 'sync';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly bullmq: BullMqService,
    private readonly metrics: MetricsService,
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

    const rows = await this.prisma.syncJob.findMany({
      where: {
        status: 'idle',
        nextRunAt: { lte: now, not: null },
      },
      orderBy: [{ priority: 'desc' }, { nextRunAt: 'asc' }],
      take: MAX_ROWS_PER_TICK,
    });

    if (rows.length === 0) {
      this.metrics.incr('scheduler_tick_empty', {});
      return;
    }

    this.metrics.incr('scheduler_tick_rows', {}, rows.length);
    this.logger.debug(`Scheduler tick: enqueueing ${rows.length} jobs`);

    const queue = this.bullmq.getQueue<SyncJobPayload>(SYNC_QUEUE_NAME);

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
}
