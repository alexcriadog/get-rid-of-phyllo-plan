import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { ulid } from "ulid";
import type { Job, Worker } from "bullmq";
import type { AnyBulkWriteOperation } from "mongodb";
import { PrismaService } from "@shared/database/prisma.service";
import { AesLocalService } from "@shared/crypto/aes-local.service";
import { MongoService } from "@shared/database/mongo.service";
import { BullMqService, SyncJobPayload } from "@shared/redis/bullmq.service";
import { MetricsService } from "@shared/metrics/metrics.service";
import { CadenceService } from "./cadence.service";
import { ThrottleLockService } from "./throttle-lock.service";
import {
  ADAPTER_REGISTRY,
  AdapterRegistry,
} from "@modules/platforms/platforms.module";
import type {
  PlatformAdapter,
  AdsSnapshot,
  CommentData,
  ContentData,
  EngagementDeepSnapshot,
  ProfileData,
  AudienceData,
} from "@modules/platforms/shared/platform-adapter.port";
import {
  RateLimitedError,
  TokenRevokedError,
} from "@modules/platforms/shared/platform-errors";
import { FacebookExtrasService } from "@modules/platforms/facebook/fetcher/facebook-extras.service";
import { TokenLifecycleEmitter } from "@modules/outbound-webhooks/token-lifecycle-emitter.service";
import { DataEventDispatcher } from "@modules/outbound-webhooks/data-event-dispatcher.service";
import { RefreshCadenceService } from "@modules/outbound-webhooks/refresh-cadence.service";
import {
  CanonicalWriteService,
  type DualWriteResult,
} from "./canonical-write.service";

const SYNC_QUEUE_NAME = "sync";
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

/**
 * Engagement window. The worker passes `since` to adapter.fetchContents()
 * so each sync only paginates as far back as needed.
 *
 * - First sync (lastSuccessAt is null) → since = now - LOOKBACK_DAYS.
 *   Backfills the requested historical window in one go. Up to MAX_POSTS
 *   defensive cap so a runaway account doesn't crash a worker slot.
 * - Incremental sync (lastSuccessAt set) → since = lastSuccessAt - OVERLAP.
 *   Only walks the new posts published since last success, plus a small
 *   overlap to catch late-indexed content.
 *
 * Override LOOKBACK via `ENGAGEMENT_LOOKBACK_DAYS` (default 30 for the PoC;
 * production should set 90).
 */
const ENGAGEMENT_LOOKBACK_DAYS_DEFAULT = 90;
const ENGAGEMENT_MAX_POSTS_PER_SYNC = 500;

/** Coerce an unknown into a positive finite number, else fall back. */
function pickPositiveNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

type ProductType =
  | "identity"
  | "audience"
  | "engagement_new"
  | "engagement_deep"
  | "stories"
  | "comments"
  | "mentions"
  | "ratings"
  | "ads";

// 'noop' means the dispatch already persisted the result via a side-channel
// (e.g. FacebookExtrasService writes ratings/ads to dedicated collections);
// the worker should skip the canonical Mongo persist step but still record
// success + emit an event.
type FetchResultKind =
  | "identity"
  | "audience"
  | "content"
  | "comments"
  | "engagement_deep"
  | "ads"
  | "noop";

interface FetchResult {
  kind: FetchResultKind;
  data:
    | ProfileData
    | AudienceData
    | ContentData[]
    | CommentData[]
    | EngagementDeepSnapshot
    | AdsSnapshot
    | Record<string, unknown>;
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
  return createHash("sha256").update(input, "utf8").digest("hex");
}

@Injectable()
export class SyncWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
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
    private readonly facebookExtras: FacebookExtrasService,
    private readonly lifecycle: TokenLifecycleEmitter,
    private readonly dataEvents: DataEventDispatcher,
    private readonly canonicalWrite: CanonicalWriteService,
    private readonly refreshCadence: RefreshCadenceService,
    @Inject(ADAPTER_REGISTRY) private readonly adapters: AdapterRegistry,
  ) {}

  onApplicationBootstrap(): void {
    if (process.argv[2] !== "worker") {
      this.logger.debug("Not running in worker mode — no-op bootstrap");
      return;
    }

    const concurrency = this.resolveConcurrency();
    this.logger.log(`SyncWorker starting, concurrency=${concurrency}`);

    this.worker = this.bullmq.getWorker<SyncJobPayload>(
      SYNC_QUEUE_NAME,
      (job) => this.handle(job),
      { concurrency },
    );

    this.worker.on("failed", (job, err) => {
      this.logger.warn(
        `Job ${job?.id ?? "<none>"} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    this.worker.on("error", (err) => {
      this.logger.error(
        `Worker error: ${err instanceof Error ? err.stack : String(err)}`,
      );
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
      this.logger.log("SyncWorker stopped");
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

    this.metrics.incr("sync_worker_job_started", { product });

    const [account, syncJobRow] = await Promise.all([
      this.prisma.account.findUnique({
        where: { id: accountIdBig },
        include: { tokens: true },
      }),
      // Pull lastSuccessAt + settings for the incremental-window
      // calculation and per-(account, product) overrides. Cheap (PK lookup).
      this.prisma.syncJob.findUnique({
        where: { id: syncJobId },
        select: { lastSuccessAt: true, settings: true },
      }),
    ]);

    if (!account || account.syncTier === "paused") {
      await this.markJobSkipped(
        syncJobId,
        now,
        account ? "paused" : "missing_account",
      );
      this.metrics.incr("sync_worker_skipped_paused", { product });
      return;
    }

    if (account.status === "needs_reauth") {
      await this.markJobSkipped(syncJobId, now, "needs_reauth");
      this.metrics.incr("sync_worker_skipped_needs_reauth", { product });
      return;
    }

    // B-2: a disconnected account has had its tokens deleted and must not
    // sync. The scheduler already filters these out; this is defence in
    // depth for jobs that were already queued when the disconnect landed.
    if (account.status === "disconnected") {
      await this.markJobSkipped(syncJobId, now, "disconnected");
      this.metrics.incr("sync_worker_skipped_disconnected", { product });
      return;
    }

    const token = account.tokens[0];
    if (!token) {
      await this.markJobFailed(syncJobId, now, "No OAuth token on file");
      this.metrics.incr("sync_worker_error_no_token", { product });
      return;
    }

    const adapter = this.adapters[account.platform];
    if (!adapter) {
      await this.markJobFailed(
        syncJobId,
        now,
        `No adapter for ${account.platform}`,
      );
      this.metrics.incr("sync_worker_error_no_adapter", {
        platform: account.platform,
      });
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
      this.metrics.incr("sync_worker_throttle_skip", { product });
      await this.prisma.syncJob.update({
        where: { id: syncJobId },
        data: {
          status: "idle",
          lastAttemptAt: now,
          nextRunAt: new Date(now.getTime() + 60_000),
        },
      });
      return;
    }

    try {
      // ads_read needs USER scope; the rest of the FB products run on the
      // PAGE token. Fall back gracefully if either side is missing so a
      // legacy account (page-token-only) still works for non-ads products.
      const wantsUserToken =
        account.platform === "facebook" && product === "ads";
      const accessToken =
        wantsUserToken && token.userAccessTokenCiphertext
          ? this.aes.decrypt(token.userAccessTokenCiphertext)
          : this.aes.decrypt(token.accessTokenCiphertext);

      // Account may or may not have `metadata` JSON in its schema. Handle
      // both so adding it later is a non-breaking change.
      const metadataCarrier = account as unknown as { metadata?: unknown };
      const metadata =
        metadataCarrier.metadata && typeof metadataCarrier.metadata === "object"
          ? (metadataCarrier.metadata as Record<string, unknown>)
          : {};

      // Spread the full metadata bag first so platform-specific fields
      // (business_id for TikTok, page_id for Meta, etc.) reach the adapter
      // unchanged. Then layer the worker-derived fields on top.
      const settings =
        syncJobRow?.settings && typeof syncJobRow.settings === "object"
          ? (syncJobRow.settings as Record<string, unknown>)
          : null;
      const context = {
        ...metadata,
        tokenHash: sha256Hex(accessToken).slice(0, 16),
        pageId:
          typeof metadata.page_id === "string" ? metadata.page_id : undefined,
        channelId:
          typeof metadata.channel_id === "string"
            ? metadata.channel_id
            : undefined,
        accountId: accountIdBig,
        lastSuccessAt: syncJobRow?.lastSuccessAt ?? null,
        settings,
      };

      // Wrap dispatch in an AsyncLocalStorage context so every downstream
      // `metrics.observeApiCall` (and its api_call_log row) is tagged with
      // the product that triggered the fetch — adapters and HTTP layers
      // don't need to thread the product through their signatures.
      const fetchResult = await this.metrics.runWithProduct(product, () =>
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

      // Resolve the per-(platform, product) refresh window so the worker's
      // engagement-change detection uses the SAME window the dispatcher stamps
      // onto `window_start`. getConfig is memoized (60s) + deterministic, so
      // detection (here) and reporting (dispatcher.fire) stay consistent even
      // when an operator overrides refreshWindowDays.
      const refreshCfg = await this.refreshCadence.getConfig(
        account.platform,
        product,
      );

      // Single canonical persist: maps to the InsightIQ-standard shape and
      // stores it in the served collections (profiles/contents/audience/
      // comments). Returns the {itemsAdded, sampleIds} delta for webhooks.
      const delta = await this.canonicalWrite.persist(
        {
          id: accountIdBig,
          platform: account.platform,
          canonicalUserId: account.canonicalUserId,
          handle: account.handle,
          endUserId: account.endUserId,
          connectedAt: account.connectedAt,
          createdAt: account.createdAt,
        },
        fetchResult as DualWriteResult,
        refreshCfg.windowDays,
      );
      await this.emitEvent(accountIdBig, product, fetchResult);
      // Public-facing webhook for clients: fire data.<product>.updated.
      // Cadence (immediate / hourly / daily) is resolved per workspace
      // inside the dispatcher; snapshot products always fire immediately.
      await this.dataEvents.fire({
        accountId: accountIdBig,
        product,
        itemsAdded: delta.itemsAdded,
        sampleIds: delta.sampleIds,
        itemsUpdated: delta.itemsUpdated,
        updatedSampleIds: delta.updatedSampleIds,
      });
      await this.scheduleNextRun(syncJobId, accountIdBig, product, now, true);

      this.metrics.incr("sync_worker_success", {
        product,
        platform: account.platform,
      });
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
        this.metrics.incr("sync_worker_rate_limited", { product });
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
        await this.emitRawEvent(accountIdBig, product, "rate.limited", {
          reason: err.message,
          bucket_key: err.bucketKey,
          reset_in_ms: err.resetInMs,
          source: /platform 429/i.test(err.message) ? "meta" : "local",
        });
        await this.prisma.syncJob.update({
          where: { id: syncJobId },
          data: {
            status: "idle",
            lastAttemptAt: now,
            nextRunAt: new Date(now.getTime() + delay),
          },
        });
        return;
      }

      if (err instanceof TokenRevokedError) {
        this.metrics.incr("sync_worker_token_revoked", { product });
        await this.prisma.account.update({
          where: { id: accountIdBig },
          data: { status: "needs_reauth" },
        });
        await this.emitRawEvent(accountIdBig, product, "account.needs_reauth", {
          reason: err.message,
        });
        // Public-facing webhook: client gets `token.expired` so they can
        // route the end-user back through OAuth. Distinct from the
        // internal Mongo `account.needs_reauth` event above (which carries
        // worker stack details).
        await this.lifecycle.tokenExpired(accountIdBig, {
          reason: err.message,
        });
        await this.updateJobStatusIdle(syncJobId);
        return;
      }

      // Persistent failure — bump counter, advance nextRunAt exponentially,
      // and auto-pause the account once it crosses the failure budget.
      const msg = err instanceof Error ? err.message : String(err);
      this.metrics.incr("sync_worker_error", { product });
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
      lastSuccessAt?: Date | null;
      settings?: Record<string, unknown> | null;
    },
  ): Promise<FetchResult | null> {
    switch (product) {
      case "identity": {
        const data = await adapter.fetchProfile(
          accessToken,
          canonicalId,
          context,
        );
        return { kind: "identity", data };
      }
      case "audience": {
        const data = await adapter.fetchAudience(
          accessToken,
          canonicalId,
          context,
        );
        return { kind: "audience", data };
      }
      case "engagement_new": {
        const since = this.computeEngagementSince(context.settings ?? null);
        const limit = pickPositiveNumber(
          context.settings?.maxPostsPerSync,
          ENGAGEMENT_MAX_POSTS_PER_SYNC,
        );
        const data = await adapter.fetchContents(
          accessToken,
          canonicalId,
          { since, limit },
          context,
        );
        return { kind: "content", data };
      }
      case "engagement_deep": {
        if (!adapter.fetchEngagementDeep) return null;
        const data = await adapter.fetchEngagementDeep(
          accessToken,
          canonicalId,
          context,
        );
        return { kind: "engagement_deep", data };
      }
      case "stories": {
        if (!adapter.fetchStories) return null;
        const data = await adapter.fetchStories(
          accessToken,
          canonicalId,
          context,
        );
        return { kind: "content", data };
      }
      case "comments": {
        if (!adapter.fetchComments) return null;
        const data = await adapter.fetchComments(
          accessToken,
          canonicalId,
          { limit: 50 },
          context,
        );
        return { kind: "comments", data };
      }
      case "mentions": {
        if (!adapter.fetchMentions) return null;
        const data = await adapter.fetchMentions(
          accessToken,
          canonicalId,
          { limit: 25 },
          context,
        );
        return { kind: "content", data };
      }
      case "ratings": {
        // FB-only side-channel product: pages_read_user_content lets us
        // pull /{page}/ratings. The service writes to `page_ratings`
        // directly so the worker just records success.
        if (adapter.platform !== "facebook") return null;
        const result = await this.facebookExtras.syncRatings(
          context.accountId,
          accessToken,
          canonicalId,
        );
        return { kind: "noop", data: { ...result } };
      }
      case "ads": {
        // Facebook: side-channel writes to `ad_insights` via FacebookExtrasService.
        // YouTube + future platforms: adapter.fetchAds returns a canonical
        // AdsSnapshot that we persist to the generic `ads_campaigns` collection.
        if (adapter.platform === "facebook") {
          const result = await this.facebookExtras.syncAdInsights(
            context.accountId,
            accessToken,
          );
          return { kind: "noop", data: { ...result } };
        }
        if (!adapter.fetchAds) return null;
        const data = await adapter.fetchAds(accessToken, canonicalId, context);
        return { kind: "ads", data };
      }
      default: {
        this.logger.warn(`Unknown product: ${product}`);
        return null;
      }
    }
  }

  private async emitEvent(
    accountId: bigint,
    product: string,
    result: FetchResult,
  ): Promise<void> {
    const eventType = this.eventTypeForResult(product, result);
    const payload: Record<string, unknown> = {
      kind: result.kind,
      size:
        result.kind === "content" ? (result.data as ContentData[]).length : 1,
    };
    if (
      result.kind === "noop" &&
      result.data &&
      typeof result.data === "object"
    ) {
      // Surface the per-product summary (mentionsStored, insightRows, …)
      // that the side-channel service produced, for debug visibility.
      Object.assign(payload, { summary: result.data });
    }
    await this.emitRawEvent(accountId, product, eventType, payload);
  }

  private eventTypeForResult(product: string, result: FetchResult): string {
    if (result.kind === "identity") return "profile.updated";
    if (result.kind === "audience") return "audience.updated";
    if (result.kind === "comments") return "comment.added";
    if (result.kind === "engagement_deep") return "engagement_deep.updated";
    if (result.kind === "ads") return "ads.updated";
    if (result.kind === "noop") {
      if (product === "ratings") return "rating.captured";
      if (product === "ads") return "ad_insight.captured";
      return "sync.completed";
    }
    // content
    if (product === "stories") return "story.added";
    if (product === "mentions") return "mention.added";
    return "content.added";
  }

  private async emitRawEvent(
    accountId: bigint,
    product: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const col = this.mongo.getCollection("event_log");
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
    const nextRunAt = await this.cadence.resolveNextRunAt(
      accountId,
      product,
      now,
    );
    await this.prisma.syncJob.update({
      where: { id: syncJobId },
      data: success
        ? {
            status: "idle",
            lastSuccessAt: now,
            lastAttemptAt: now,
            nextRunAt,
            failureCount: 0,
            lastError: null,
          }
        : {
            status: "idle",
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
        status: "idle",
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
        status: "failed",
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
        status: "idle",
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
        data: { syncTier: "paused" },
      });
      this.metrics.incr("sync_worker_circuit_break", {});
    }
  }

  /**
   * Window start for an engagement_new fetch. Always returns
   * `now - LOOKBACK_DAYS` (default 90d) — `lastSuccessAt` is intentionally
   * ignored.
   *
   * Why: incremental windows (only refresh posts published since the last
   * run) miss the metric growth curve of older content. Reels in
   * particular accumulate the bulk of their views in the first 7-14 days
   * after publish, so a snapshot taken hours after publish became the
   * frozen value forever. Re-fetching the last 90 days every run keeps
   * the curve up-to-date. See docs/refresh-cadence.md for the cost
   * analysis (negligible vs Meta's BUC budget per asset).
   *
   * LOOKBACK precedence: per-job settings.lookbackDays > env
   * (ENGAGEMENT_LOOKBACK_DAYS) > default (90).
   */
  private computeEngagementSince(
    settings: Record<string, unknown> | null,
  ): Date {
    const lookbackDays = this.resolveEngagementLookbackDays(settings);
    return new Date(Date.now() - lookbackDays * 86_400_000);
  }

  private resolveEngagementLookbackDays(
    settings: Record<string, unknown> | null,
  ): number {
    const fromSettings = pickPositiveNumber(settings?.lookbackDays, NaN);
    if (Number.isFinite(fromSettings) && fromSettings > 0) {
      return Math.floor(fromSettings);
    }
    const raw = process.env.ENGAGEMENT_LOOKBACK_DAYS;
    if (!raw) return ENGAGEMENT_LOOKBACK_DAYS_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return ENGAGEMENT_LOOKBACK_DAYS_DEFAULT;
    return Math.floor(n);
  }

  private async updateJobStatusIdle(syncJobId: bigint): Promise<void> {
    await this.prisma.syncJob.update({
      where: { id: syncJobId },
      data: { status: "idle" },
    });
  }
}
