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
  CommentData,
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
/**
 * Rate-limit retry jitter is PROPORTIONAL to the platform's reset window.
 * Why: with a fixed 5s jitter and N rate-limited accounts, all N converge in
 * a 5-second window in the future — when the window opens, they hammer at
 * once and the bucket re-empties immediately. Spreading the retry across
 * the full reset window (capped at 30 min so we don't over-defer short
 * resets) gives uniform pressure once the bucket starts refilling.
 *
 * Floor at 5s so even a 200 ms reset doesn't collapse to "everyone retries
 * at the same millisecond".
 */
const RATE_LIMIT_JITTER_MIN_MS = 5_000;
const RATE_LIMIT_JITTER_MAX_MS = 30 * 60_000;
const THROTTLE_LOCK_TTL_SECONDS = 600;

// Strict failure-budget controls (BullMQ attempts=1; no retry storm).
// After N consecutive failures on a sync_job the account is auto-paused.
// Between failures, nextRunAt is pushed out exponentially so the scheduler
// can't re-pick the same failing job every tick.
const MAX_CONSECUTIVE_FAILURES = 5;
const FAILURE_BACKOFF_BASE_MS = 60_000;
const FAILURE_BACKOFF_MAX_MS = 60 * 60_000;

type ProductType =
  | 'identity'
  | 'audience'
  | 'engagement_new'
  | 'stories'
  | 'comments'
  | 'mentions';

type FetchResultKind = 'identity' | 'audience' | 'content' | 'comments';

interface FetchResult {
  kind: FetchResultKind;
  data: ProfileData | AudienceData | ContentData[] | CommentData[];
}

/**
 * Re-enqueue signal. Thrown inside the handler when we need the same
 * payload retried with a non-default delay (e.g. throttle lock held).
 * BullMQ picks it up through the `failed` path; we re-add before the
 * throw so the scheduler doesn't need to intervene.
 */
// (DelayedRetryError removed — worker no longer self-enqueues. All retry
// scheduling is driven by sync_jobs.nextRunAt + the scheduler tick.)

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
      // Another worker/tick is already processing this (account, product).
      // Push nextRunAt out by 60s and let the scheduler decide when to
      // re-pick — no worker-side re-enqueue, so no amplification.
      this.metrics.incr('sync_worker_throttle_skip', { product });
      await this.prisma.syncJob.update({
        where: { id: syncJobId },
        data: {
          status: 'idle',
          lastAttemptAt: now,
          nextRunAt: new Date(now.getTime() + 60_000),
        },
      });
      return;
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

      // Spread the full metadata bag first so platform-specific fields
      // (business_id for TikTok, page_id for Meta, etc.) reach the adapter
      // unchanged. Then layer the worker-derived fields on top.
      const context = {
        ...metadata,
        tokenHash: sha256Hex(accessToken).slice(0, 16),
        pageId: typeof metadata.page_id === 'string' ? metadata.page_id : undefined,
        channelId: typeof metadata.channel_id === 'string' ? metadata.channel_id : undefined,
        accountId: accountIdBig,
      };

      // Wrap dispatch in an AsyncLocalStorage context so every downstream
      // `metrics.observeApiCall` (and its api_call_log row) is tagged with
      // the product that triggered the fetch — adapters and HTTP layers
      // don't need to thread the product through their signatures.
      const fetchResult = await this.metrics.runWithProduct(
        product,
        () =>
          this.dispatchFetch(
            adapter,
            product as ProductType,
            accessToken,
            account.canonicalUserId,
            context,
          ),
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
      // The 10-minute throttle cooldown is only meaningful after a completed
      // sync. Any failure path below must release the lock, otherwise retries
      // loop through the throttle-skip branch until the TTL expires.
      await this.throttle
        .release(`throttle:${accountIdBig.toString()}:${product}`)
        .catch(() => undefined);

      if (err instanceof RateLimitedError) {
        // Honour Meta's reset window by pushing nextRunAt out; scheduler
        // picks it up again once the window has elapsed. No worker-side
        // re-enqueue → no way for rate-limits to amplify call volume.
        this.metrics.incr('sync_worker_rate_limited', { product });
        // Jitter spans up to the full reset window (capped at 30 min) so
        // many rate-limited accounts spread across the recovery curve
        // instead of slamming back the second the cap reopens.
        const reset = Math.max(0, err.resetInMs);
        const jitterCeiling = Math.min(reset, RATE_LIMIT_JITTER_MAX_MS);
        const jitter = Math.max(
          RATE_LIMIT_JITTER_MIN_MS,
          Math.floor(Math.random() * jitterCeiling),
        );
        const delay = reset + jitter;
        // Persist a durable record so the operational report can answer
        // "how often did our local bucket vs Meta block us in the last N
        // days" without relying on in-memory counters that reset on restart.
        // `bucketKey` distinguishes local-denial (e.g. rate:fb:page:...)
        // from a Meta-side 429 (the message includes "Platform 429").
        await this.emitRawEvent(accountIdBig, product, 'rate.limited', {
          reason: err.message,
          bucket_key: err.bucketKey,
          reset_in_ms: err.resetInMs,
          source: /platform 429/i.test(err.message) ? 'meta' : 'local',
        });
        await this.prisma.syncJob.update({
          where: { id: syncJobId },
          data: {
            status: 'idle',
            lastAttemptAt: now,
            nextRunAt: new Date(now.getTime() + delay),
          },
        });
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

      // Persistent failure — bump counter, advance nextRunAt exponentially,
      // and auto-pause the account once it crosses the failure budget.
      const msg = err instanceof Error ? err.message : String(err);
      this.metrics.incr('sync_worker_error', { product });
      await this.bumpFailure(syncJobId, accountIdBig, now, msg);
      // Do NOT rethrow: BullMQ attempts=1 plus our own backoff already
      // handle the retry. Rethrowing here just floods the `failed` handler
      // logs with the same error.
      return;
    }
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
      case 'comments': {
        if (!adapter.fetchComments) return null;
        const data = await adapter.fetchComments(
          accessToken,
          canonicalId,
          { limit: 50 },
          context,
        );
        return { kind: 'comments', data };
      }
      case 'mentions': {
        if (!adapter.fetchMentions) return null;
        const data = await adapter.fetchMentions(
          accessToken,
          canonicalId,
          { limit: 25 },
          context,
        );
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

    if (result.kind === 'comments') {
      const comments = result.data as CommentData[];
      if (!Array.isArray(comments) || comments.length === 0) return;
      const col = this.mongo.getCollection('comments');
      for (const comment of comments) {
        const cid = (comment as { platformCommentId?: string }).platformCommentId;
        if (!cid) continue;
        await col.updateOne(
          { account_id: accountIdStr, platform_comment_id: cid },
          {
            $set: {
              account_id: accountIdStr,
              platform,
              platform_content_id: comment.platformContentId,
              platform_comment_id: cid,
              data: comment,
              updated_at: now,
            },
            $setOnInsert: { created_at: now },
          },
          { upsert: true },
        );
      }
      return;
    }

    // content (engagement_new, stories, mentions)
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
    const raw = post as unknown as {
      id?: unknown;
      platformContentId?: unknown;
      platform_content_id?: unknown;
    };
    // Adapters return camelCase `platformContentId`; we accept the snake_case
    // and `id` shorthands defensively so future adapters don't silently drop.
    if (typeof raw.platformContentId === 'string') return raw.platformContentId;
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
    if (result.kind === 'comments') return 'comment.added';
    // content
    if (product === 'stories') return 'story.added';
    if (product === 'mentions') return 'mention.added';
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
    accountId: bigint,
    now: Date,
    error: string,
  ): Promise<void> {
    const current = await this.prisma.syncJob.findUnique({
      where: { id: syncJobId },
      select: { failureCount: true },
    });
    const nextFailureCount = (current?.failureCount ?? 0) + 1;
    const backoffMs = Math.min(
      FAILURE_BACKOFF_BASE_MS * Math.pow(2, nextFailureCount - 1),
      FAILURE_BACKOFF_MAX_MS,
    );
    const nextRunAt = new Date(now.getTime() + backoffMs);

    await this.prisma.syncJob.update({
      where: { id: syncJobId },
      data: {
        status: 'idle',
        lastAttemptAt: now,
        lastError: error,
        failureCount: { increment: 1 },
        nextRunAt,
      },
    });

    if (nextFailureCount >= MAX_CONSECUTIVE_FAILURES) {
      this.logger.warn(
        `Circuit breaker tripped: account=${accountId.toString()} ` +
          `sync_job=${syncJobId.toString()} failures=${nextFailureCount} — pausing account`,
      );
      await this.prisma.account.update({
        where: { id: accountId },
        data: { syncTier: 'paused' },
      });
      this.metrics.incr('sync_worker_circuit_break', {});
    }
  }

  private async updateJobStatusIdle(syncJobId: bigint): Promise<void> {
    await this.prisma.syncJob.update({
      where: { id: syncJobId },
      data: { status: 'idle' },
    });
  }

}
