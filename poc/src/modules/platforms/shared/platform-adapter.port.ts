import { RateLimitHint } from '@shared/redis/rate-bucket.service';
import {
  AdsSnapshot,
  AudienceData,
  CommentData,
  ContentData,
  EngagementDeepSnapshot,
  FetchOpts,
  ProfileData,
  SupportMatrix,
} from './platform-types';

// Re-export data DTOs so consumers can import either from `platform-types`
// or from the port (port = single public entrypoint).
export type {
  AdsSnapshot,
  AudienceData,
  CommentData,
  ContentData,
  EngagementDeepSnapshot,
  FetchOpts,
  ProfileData,
  SupportMatrix,
} from './platform-types';

export interface PlatformAdapterContext {
  tokenHash?: string;
  pageId?: string;
  channelId?: string;
  /**
   * IG Business Account id when the call is operating against an IG asset.
   * Used by RateLimitStrategy.bucKeys to build the `asset:{id}` Redis key
   * the BUC mirror checks before admitting the call.
   */
  igAccountId?: string;
  /**
   * Per-call Graph base URL override. Set for IG-direct accounts
   * (metadata.oauth_flow === 'ig_direct') whose tokens only work against
   * graph.instagram.com. Absent → the client's default (graph.facebook.com).
   */
  graphBaseUrl?: string;
}

/**
 * Hexagonal-port abstraction between the sync worker and per-platform
 * connectors. Every platform implements this and only this — the worker,
 * rate bucket service, scheduler and admin UI are all platform-agnostic.
 */
export interface PlatformAdapter {
  readonly platform: string;

  rateLimitHints(context?: PlatformAdapterContext): RateLimitHint[];
  supportMatrix(): SupportMatrix;

  fetchProfile(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ProfileData>;

  fetchAudience(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AudienceData>;

  fetchContents(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]>;

  fetchStories?(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]>;

  /**
   * Comments per content item. Optional because not every platform exposes
   * a public comments API (only TikTok, IG, FB Pages do today). The worker
   * iterates the most recent N posts and aggregates their comment threads.
   * Implementations should cap the per-call work — typical implementation:
   * accept opts.limit as max comments per video.
   */
  fetchComments?(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<CommentData[]>;

  /**
   * Posts that mention this account (videos tagging the business account on
   * TikTok, posts mentioning the IG handle, etc). Returns ContentData[] —
   * a mention IS a content item, just from a different author.
   */
  fetchMentions?(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]>;

  /**
   * Per-content windowed analytics + audience retention. Distinct from
   * `engagement_new` (Data-API-style lifetime counts that move every
   * minute) — this is the Analytics layer, sliced by content, refreshed
   * at a slower cadence. Returns one snapshot per call carrying every
   * item the adapter could resolve.
   */
  fetchEngagementDeep?(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<EngagementDeepSnapshot>;

  /**
   * Advertising-side data — campaigns the connected user runs that target
   * THIS platform's surface (e.g. YouTube video campaigns via Google Ads).
   * Distinct from any organic content data. Returns a single snapshot.
   */
  fetchAds?(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AdsSnapshot>;
}

export type AdapterRegistry = Record<string, PlatformAdapter>;

export const ADAPTER_REGISTRY = 'ADAPTER_REGISTRY';

/** Thrown when the platform told us the token is no longer valid. */
export class TokenRevokedError extends Error {
  constructor(
    public readonly platform: string,
    public readonly canonicalId: string,
    message = 'Platform rejected access token — needs_reauth',
  ) {
    super(message);
    this.name = 'TokenRevokedError';
  }
}

/** Thrown when our rate bucket (or the platform) denied the call. */
export class RateLimitedError extends Error {
  constructor(
    public readonly platform: string,
    public readonly resetInMs: number,
    public readonly bucketKey: string,
    message = 'Rate limit exceeded',
  ) {
    super(message);
    this.name = 'RateLimitedError';
  }
}

/** Generic wrapper around unexpected adapter-side failures. */
export class AdapterFetchError extends Error {
  public readonly cause: unknown;
  /** Parsed response body when the upstream returned structured error JSON. */
  public readonly body?: unknown;
  constructor(
    public readonly platform: string,
    public readonly endpoint: string,
    cause: unknown,
    message?: string,
    body?: unknown,
  ) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(message ?? `Adapter fetch failed (${platform}:${endpoint}): ${causeMsg}`);
    this.name = 'AdapterFetchError';
    this.cause = cause;
    this.body = body;
  }
}
