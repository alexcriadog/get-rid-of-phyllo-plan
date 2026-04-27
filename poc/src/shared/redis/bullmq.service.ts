import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  Queue,
  QueueEvents,
  Worker,
  WorkerOptions,
  Processor,
  QueueOptions,
} from 'bullmq';
import { RedisService } from './redis.service';

export type QueueName = 'sync' | 'events' | 'delivery';

export const QUEUE_NAMES: ReadonlyArray<QueueName> = ['sync', 'events', 'delivery'];

/**
 * PoC priority ladder. BullMQ treats lower numbers as higher priority — see
 * https://docs.bullmq.io/guide/jobs/prioritized .
 */
export type JobPriority = 'HIGH' | 'NORMAL' | 'BACKFILL';

export const PRIORITY_NUMBERS: Record<JobPriority, number> = {
  HIGH: 1,
  NORMAL: 2,
  BACKFILL: 3,
};

export function toPriorityNumber(p: JobPriority): number {
  return PRIORITY_NUMBERS[p];
}

/**
 * Payload shape for `sync` queue jobs. Consumer type contract shared between
 * scheduler (producer), webhook handler (producer), manual refresh (producer),
 * and the sync worker (consumer).
 */
export type SyncJobPayload = {
  jobId: string | number;
  accountId: string | number;
  product: string;
};

/** Re-export under the name the sync/webhooks modules expect. */
export { BullmqService as BullMqService };

@Injectable()
export class BullmqService implements OnModuleDestroy {
  private readonly logger = new Logger(BullmqService.name);
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Map<string, Worker>();
  private readonly queueEvents = new Map<string, QueueEvents>();

  constructor(private readonly redis: RedisService) {}

  /**
   * Lazily construct (and cache) a BullMQ Queue bound to the shared redis
   * connection. Keys are auto-prefixed with the configured namespace so
   * queues from different environments don't collide in the same Redis.
   */
  getQueue<TData = unknown>(name: QueueName): Queue<TData> {
    const cached = this.queues.get(name);
    if (cached) {
      return cached as unknown as Queue<TData>;
    }

    const opts: QueueOptions = {
      connection: this.redis.client,
      prefix: this.prefix(),
      defaultJobOptions: {
        removeOnComplete: { count: 500, age: 24 * 3600 },
        removeOnFail: { count: 500, age: 7 * 24 * 3600 },
        // No automatic retries. If a sync fails, the scheduler will pick it
        // up again on its next tick once `sync_jobs.nextRunAt` elapses, with
        // exponential backoff baked into `bumpFailure`. This makes Meta API
        // call volume strictly bounded by the cadence; no retry storms.
        attempts: 1,
      },
    };

    const q = new Queue<TData>(name, opts);
    this.queues.set(name, q as unknown as Queue);
    this.logger.log(`Queue '${name}' ready (prefix=${opts.prefix})`);
    return q;
  }

  /** Convenience method form of the standalone `toPriorityNumber` helper. */
  toPriorityNumber(p: JobPriority): number {
    return toPriorityNumber(p);
  }

  /**
   * Construct a BullMQ Worker for the given queue. Callers MUST retain the
   * returned instance for their lifetime — the service registers it for
   * clean shutdown on module destroy.
   */
  getWorker<TData = unknown, TResult = unknown>(
    name: QueueName,
    processor: Processor<TData, TResult>,
    opts: Partial<WorkerOptions> = {},
  ): Worker<TData, TResult> {
    const key = `${name}:${this.workers.size}`;
    const workerOpts: WorkerOptions = {
      connection: this.redis.client,
      prefix: this.prefix(),
      concurrency: opts.concurrency ?? 4,
      ...opts,
    };
    const worker = new Worker<TData, TResult>(name, processor, workerOpts);
    worker.on('error', (err) => {
      this.logger.error(`Worker '${name}' error: ${err.message}`);
    });
    this.workers.set(key, worker as unknown as Worker);
    this.logger.log(
      `Worker '${name}' started (concurrency=${workerOpts.concurrency})`,
    );
    return worker;
  }

  /**
   * Stream of lifecycle events for a queue (completed/failed/stalled). Useful
   * for admin dashboards.
   */
  getQueueEvents(name: QueueName): QueueEvents {
    const cached = this.queueEvents.get(name);
    if (cached) {
      return cached;
    }
    const ev = new QueueEvents(name, {
      connection: this.redis.client,
      prefix: this.prefix(),
    });
    this.queueEvents.set(name, ev);
    return ev;
  }

  async onModuleDestroy(): Promise<void> {
    // Close workers first so they stop pulling jobs.
    for (const [key, worker] of this.workers) {
      await worker.close().catch(() => {
        /* swallow — shutdown */
      });
      this.logger.log(`Worker '${key}' closed`);
    }
    this.workers.clear();

    for (const [name, queue] of this.queues) {
      await queue.close().catch(() => {
        /* swallow — shutdown */
      });
      this.logger.log(`Queue '${name}' closed`);
    }
    this.queues.clear();

    for (const [name, ev] of this.queueEvents) {
      await ev.close().catch(() => {
        /* swallow — shutdown */
      });
      this.logger.log(`QueueEvents '${name}' closed`);
    }
    this.queueEvents.clear();
  }

  private prefix(): string {
    // BullMQ will namespace its own internal keys under this prefix.
    return this.redis.key('bullmq');
  }
}
