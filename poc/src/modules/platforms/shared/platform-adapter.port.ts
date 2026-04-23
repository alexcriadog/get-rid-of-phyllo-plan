import { RateLimitHint } from '@shared/redis/rate-bucket.service';
import {
  AudienceData,
  ContentData,
  FetchOpts,
  ProfileData,
  SupportMatrix,
} from './platform-types';

// Re-export data DTOs so consumers can import either from `platform-types`
// or from the port (port = single public entrypoint).
export type {
  AudienceData,
  ContentData,
  FetchOpts,
  ProfileData,
  SupportMatrix,
} from './platform-types';

export interface PlatformAdapterContext {
  tokenHash?: string;
  pageId?: string;
  channelId?: string;
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
  constructor(
    public readonly platform: string,
    public readonly endpoint: string,
    cause: unknown,
    message?: string,
  ) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(message ?? `Adapter fetch failed (${platform}:${endpoint}): ${causeMsg}`);
    this.name = 'AdapterFetchError';
  }
}
