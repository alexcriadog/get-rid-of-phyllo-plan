import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import type { Job, Worker } from 'bullmq';
import { PrismaService } from '@shared/database/prisma.service';
import { AesLocalService } from '@shared/crypto/aes-local.service';
import { MongoService } from '@shared/database/mongo.service';
import { BullMqService, SyncJobPayload } from '@shared/redis/bullmq.service';
import { MetricsService } from '@shared/metrics/metrics.service';
import { CadenceService } from './cadence.service';
import { ThrottleLockService } from './throttle-lock.service';
import {
  ADAPTER_REGISTRY,
  AdapterRegistry,
} from '@modules/platforms/platforms.module';
import type {
  PlatformAdapter,
  ContentData,
  ProfileData,
  AudienceData,
} from '@modules/platforms/shared/platform-adapter.port';
import {
  RateLimitedError,
  TokenRevokedError,
} from '@modules/platforms/shared/platform-errors';

const SYNC_QUEUE_NAME = 'sync';
const DEFAULT_CONCURRENCY = 4;
const THROTTLE_SKIP_RETRY_DELAY_MS = 10_000;
const MAX_RATE_LIMIT_JITTER_MS = 5_000;
const THROTTLE_LOCK_TTL_SECONDS = 600;

type ProductType = 'identity' | 'audience' | 'engagement_new' | 'stories';

type FetchResultKind = 'identity' | 'audience' | 'content';

interface FetchResult {
  kind: FetchResultKind;
  data: ProfileData | AudienceData | ContentData[];
}

/**
 * Re-enqueue signal. Thrown inside the handler when we need the same
 * payload retried with a non-default delay (e.g. throttle lock held).
 * BullMQ picks it up through the `failed` path; we re-add before the
 * throw so the scheduler doesn't need to intervene.
 */
class DelayedRetryError extends Error {
  constructor(public readonly delayMs: number) {
    super(`Delayed retry in ${delayMs}ms`);
    this.name = 'DelayedRetryError';
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

@Injectable()
export class SyncWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SyncWorker.name);
  private worker: Worker<SyncJobPayload> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aes: AesLocalService,
    private readonly mongo: MongoService,
    private readonly bullmq: BullMqService,
    private readonly metrics: MetricsService,
    private readonly cadence: CadenceService,
    private readonly throttle: ThrottleLockService,
    @Inject(ADAPTER_REGISTRY) private readonly adapters: AdapterRegistry,
  ) {}

  onApplicationBootstrap(): void {
    if (process.argv[2] !== 'worker') {
      this.logger.debug('Not running in worker mode — no-op bootstrap');
      return;
    }

    const concurrency = this.resolveConcurrency();
    this.logger.log(`SyncWorker starting, concurrency=${concurrency}`);

    this.worker = this.bullmq.getWorker<SyncJobPayload>(
      SYNC_QUEUE_NAME,
      (job) => this.handle(job),
      { concurrency },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        `Job ${job?.id ?? '<none>'} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    this.worker.on('error', (err) => {
      this.logger.error(`Worker error: ${err instanceof Error ? err.stack : String(err)}`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
      this.logger.log('SyncWorker stopped');
    }
  }

  private resolveConcurrency(): number {
    const raw = process.env.WORKER_CONCURRENCY;
    if (!raw) return DEFAULT_CONCURRENCY;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_CONCURRENCY;
    return Math.floor(n);
  }

  /**
   * BullMQ handler. Any thrown error is interpreted by BullMQ as a failure
   * and triggers retry logic. We distinguish:
   *   - RateLimitedError → re-enqueue with delay, mark idle, swallow
   *   - TokenRevokedError → mark account needs_reauth, return
   *   - DelayedRetryError → re-enqueue already done, swallow
   *   - other → bump failureCount + rethrow so BullMQ retries
   */
  private async handle(job: Job<SyncJobPayload>): Promise<void> {
    const { jobId, accountId, product } = job.data;
    const now = new Date();
    const syncJobId = BigInt(jobId);
    const accountIdBig = BigInt(accountId);

    this.metrics.incr('sync_worker_job_started', { product });

    const account = await this.prisma.account.findUnique({
      where: { id: accountIdBig },
      include: { tokens: true },
    });

    if (!account || account.syncTier === 'paused') {
      await this.markJobSkipped(syncJobId, now, account ? 'paused' : 'missing_account');
      this.metrics.incr('sync_worker_skipped_paused', { product });
      return;
    }

    if (account.status === 'needs_reauth') {
      await this.markJobSkipped(syncJobId, now, 'needs_reauth');
      this.metrics.incr('sync_worker_skipped_needs_reauth', { product });
      return;
    }

    const token = account.tokens[0];
    if (!token) {
      await this.markJobFailed(syncJobId, now, 'No OAuth token on file');
      this.metrics.incr('sync_worker_error_no_token', { product });
      return;
    }

    const adapter = this.adapters[account.platform];
    if (!adapter) {
      await this.markJobFailed(syncJobId, now, `No adapter for ${account.platform}`);
      this.metrics.incr('sync_worker_error_no_adapter', { platform: account.platform });
      throw new Error(`No adapter for ${account.platform}`);
    }

    // Throttle lock (10 min post-sync cooldown). Skip if already held,
    // re-queue with short delay so BullMQ can pick it up again later.
    const throttleAcquired = await this.throttle.acquire(
      accountIdBig,
      product,
      THROTTLE_LOCK_TTL_SECONDS,
    );
    if (!throttleAcquired) {
      this.metrics.incr('sync_worker_throttle_skip', { product });
      await this.reenqueueWithDelay(job, THROTTLE_SKIP_RETRY_DELAY_MS);
      await this.updateJobStatusIdle(syncJobId);
      throw new DelayedRetryError(THROTTLE_SKIP_RETRY_DELAY_MS);
    }

    try {
      const accessToken = this.aes.decrypt(token.accessTokenCiphertext);

      // Account may or may not have `metadata` JSON in its schema. Handle
      // both so adding it later is a non-breaking change.
      const metadataCarrier = account as unknown as { metadata?: unknown };
      const metadata =
        metadataCarrier.metadata && typeof metadataCarrier.metadata === 'object'
          ? (metadataCarrier.metadata as Record<string, unknown>)
          : {};

      const context = {
        tokenHash: sha256Hex(accessToken).slice(0, 16),
        pageId: typeof metadata.page_id === 'string' ? metadata.page_id : undefined,
        channelId: typeof metadata.channel_id === 'string' ? metadata.channel_id : undefined,
        accountId: accountIdBig,
      };

      const fetchResult = await this.dispatchFetch(
        adapter,
        product as ProductType,
        accessToken,
        account.canonicalUserId,
        context,
      );

      if (!fetchResult) {
        // Product not supported by this adapter — cadence still advances
        // so we don't busy-loop.
        await this.scheduleNextRun(syncJobId, accountIdBig, product, now, true);
        return;
      }

      await this.persistToMongo(accountIdBig, account.platform, fetchResult);
      await this.emitEvent(accountIdBig, product, fetchResult);
      await this.scheduleNextRun(syncJobId, accountIdBig, product, now, true);

      this.metrics.incr('sync_worker_success', { product, platform: account.platform });
    } catch (err) {
      if (err instanceof RateLimitedError) {
        this.metrics.incr('sync_worker_rate_limited', { product });
        const delay =
          Math.max(0, err.resetInMs) + Math.floor(Math.random() * MAX_RATE_LIMIT_JITTER_MS);
        await this.reenqueueWithDelay(job, delay);
        await this.updateJobStatusIdle(syncJobId);
        return;
      }

      if (err instanceof TokenRevokedError) {
        this.metrics.incr('sync_worker_token_revoked', { product });
        await this.prisma.account.update({
          where: { id: accountIdBig },
          data: { status: 'needs_reauth' },
        });
        await this.emitRawEvent(accountIdBig, product, 'account.needs_reauth', {
          reason: err.message,
        });
        await this.updateJobStatusIdle(syncJobId);
        return;
      }

      if (err instanceof DelayedRetryError) {
        // Re-enqueue already scheduled above; swallow to avoid BullMQ retry
        return;
      }

      // Persistent failure — bump counter and let BullMQ retry
      const msg = err instanceof Error ? err.message : String(err);
      this.metrics.incr('sync_worker_error', { product });
      await this.bumpFailure(syncJobId, now, msg);
      throw err instanceof Error ? err : new Error(msg);
    }
    // Intentionally no `finally` releasing the throttle lock — we want the
    // 10-minute cooldown window to remain for the full TTL.
  }

  private async dispatchFetch(
    adapter: PlatformAdapter,
    product: ProductType,
    accessToken: string,
    canonicalId: string,
    context: {
      tokenHash: string;
      pageId?: string;
      channelId?: string;
      accountId: bigint;
    },
  ): Promise<FetchResult | null> {
    switch (product) {
      case 'identity': {
        const data = await adapter.fetchProfile(accessToken, canonicalId, context);
        return { kind: 'identity', data };
      }
      case 'audience': {
        const data = await adapter.fetchAudience(accessToken, canonicalId, context);
        return { kind: 'audience', data };
      }
      case 'engagement_new': {
        const data = await adapter.fetchContents(
          accessToken,
          canonicalId,
          { limit: 25 },
          context,
        );
        return { kind: 'content', data };
      }
      case 'stories': {
        if (!adapter.fetchStories) return null;
        const data = await adapter.fetchStories(accessToken, canonicalId, context);
        return { kind: 'content', data };
      }
      default: {
        this.logger.warn(`Unknown product: ${product}`);
        return null;
      }
    }
  }

  private async persistToMongo(
    accountId: bigint,
    platform: string,
    result: FetchResult,
  ): Promise<void> {
    const accountIdStr = accountId.toString();
    const now = new Date();

    if (result.kind === 'identity') {
      const col = this.mongo.getCollection('identity_snapshots');
      await col.updateOne(
        { account_id: accountIdStr },
        {
          $set: {
            account_id: accountIdStr,
            platform,
            data: result.data,
            updated_at: now,
          },
          $setOnInsert: { created_at: now },
        },
        { upsert: true },
      );
      return;
    }

    if (result.kind === 'audience') {
      const col = this.mongo.getCollection('audience_snapshots');
      await col.updateOne(
        { account_id: accountIdStr },
        {
          $set: {
            account_id: accountIdStr,
            platform,
            data: result.data,
            updated_at: now,
          },
          $setOnInsert: { created_at: now },
        },
        { upsert: true },
      );
      return;
    }

    // content
    const posts = result.data as ContentData[];
    if (!Array.isArray(posts) || posts.length === 0) return;
    const col = this.mongo.getCollection('posts');
    for (const post of posts) {
      const platformContentId = this.extractContentId(post);
      if (!platformContentId) continue;
      await col.updateOne(
        { account_id: accountIdStr, platform_content_id: platformContentId },
        {
          $set: {
            account_id: accountIdStr,
            platform,
            platform_content_id: platformContentId,
            data: post,
            updated_at: now,
          },
          $setOnInsert: { created_at: now },
        },
        { upsert: true },
      );
    }
  }

  private extractContentId(post: ContentData): string | null {
    const raw = post as unknown as { id?: unknown; platform_content_id?: unknown };
    if (typeof raw.platform_content_id === 'string') return raw.platform_content_id;
    if (typeof raw.id === 'string') return raw.id;
    return null;
  }

  private async emitEvent(
    accountId: bigint,
    product: string,
    result: FetchResult,
  ): Promise<void> {
    const eventType = this.eventTypeForResult(product, result);
    await this.emitRawEvent(accountId, product, eventType, {
      kind: result.kind,
      size: result.kind === 'content' ? (result.data as ContentData[]).length : 1,
    });
  }

  private eventTypeForResult(product: string, result: FetchResult): string {
    if (result.kind === 'identity') return 'profile.updated';
    if (result.kind === 'audience') return 'audience.updated';
    // content
    if (product === 'stories') return 'story.added';
    return 'content.added';
  }

  private async emitRawEvent(
    accountId: bigint,
    product: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const col = this.mongo.getCollection('event_log');
    await col.insertOne({
      event_id: ulid(),
      event_type: eventType,
      account_id: accountId.toString(),
      product,
      emitted_at: new Date(),
      payload,
    });
  }

  private async scheduleNextRun(
    syncJobId: bigint,
    accountId: bigint,
    product: string,
    now: Date,
    success: boolean,
  ): Promise<void> {
    const nextRunAt = await this.cadence.resolveNextRunAt(accountId, product, now);
    await this.prisma.syncJob.update({
      where: { id: syncJobId },
      data: success
        ? {
            status: 'idle',
            lastSuccessAt: now,
            lastAttemptAt: now,
            nextRunAt,
            failureCount: 0,
            lastError: null,
          }
        : {
            status: 'idle',
            lastAttemptAt: now,
            nextRunAt,
          },
    });
  }

  private async markJobSkipped(
    syncJobId: bigint,
    now: Date,
    reason: string,
  ): Promise<void> {
    await this.prisma.syncJob.update({
      where: { id: syncJobId },
      data: {
        status: 'idle',
        lastAttemptAt: now,
        lastError: `skipped:${reason}`,
      },
    });
  }

  private async markJobFailed(
    syncJobId: bigint,
    now: Date,
    error: string,
  ): Promise<void> {
    await this.prisma.syncJob.update({
      where: { id: syncJobId },
      data: {
        status: 'failed',
        lastAttemptAt: now,
        lastError: error,
        failureCount: { increment: 1 },
      },
    });
  }

  private async bumpFailure(
    syncJobId: bigint,
    now: Date,
    error: string,
  ): Promise<void> {
    await this.prisma.syncJob.update({
      where: { id: syncJobId },
      data: {
        status: 'idle',
        lastAttemptAt: now,
        lastError: error,
        failureCount: { increment: 1 },
      },
    });
  }

  private async updateJobStatusIdle(syncJobId: bigint): Promise<void> {
    await this.prisma.syncJob.update({
      where: { id: syncJobId },
      data: { status: 'idle' },
    });
  }

  private async reenqueueWithDelay(
    job: Job<SyncJobPayload>,
    delayMs: number,
  ): Promise<void> {
    const queue = this.bullmq.getQueue<SyncJobPayload>(SYNC_QUEUE_NAME);
    await queue.add('sync', job.data, {
      delay: delayMs,
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 86_400, count: 500 },
    });
  }
}
