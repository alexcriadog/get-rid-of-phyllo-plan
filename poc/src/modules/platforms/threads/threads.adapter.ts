// ThreadsAdapter — facade implementing the PlatformAdapter port.
//
// Sprint 2 ships profile + audience. Sprint 3 adds the content fetcher (and
// post mapper) and Sprint 4 adds replies/comments + mentions. Each capability
// is wired in here as it lands; the worker only ever sees this facade.
//
// All HTTP, rate-limit, persistence, parsing live in:
//   - shared/threads-api/  (chokepoint + types)
//   - threads/fetcher/     (per-product orchestration)
//   - threads/mapper/      (pure transforms)
//   - threads.rate-limit.strategy.ts
//   - threads.support-matrix.ts

import { Inject, Injectable } from '@nestjs/common';
import type { RateLimitHint } from '@shared/redis/rate-bucket.service';
import {
  PlatformAdapter,
  PlatformAdapterContext,
} from '../shared/platform-adapter.port';
import type {
  AudienceData,
  CommentData,
  ContentData,
  FetchOpts,
  ProfileData,
  SupportMatrix,
} from '../shared/platform-types';
import type { BoundThreadsClient } from '../shared/threads-api/threads-client';
import { ThreadsTokenRefreshService } from '../shared/threads-api/threads-token-refresh.service';
import { ThreadsRateLimitStrategy } from './threads.rate-limit.strategy';
import { THREADS_SUPPORT_MATRIX } from './threads.support-matrix';
import { THREADS_API_CLIENT } from './threads.tokens';
import { ThreadsProfileFetcher } from './fetcher/threads-profile.fetcher';
import { ThreadsAudienceFetcher } from './fetcher/threads-audience.fetcher';
import { ThreadsContentFetcher } from './fetcher/threads-content.fetcher';
import { ThreadsRepliesFetcher } from './fetcher/threads-replies.fetcher';
import { ThreadsMentionsFetcher } from './fetcher/threads-mentions.fetcher';

@Injectable()
export class ThreadsAdapter implements PlatformAdapter {
  readonly platform = 'threads';

  constructor(
    @Inject(THREADS_API_CLIENT)
    private readonly threadsClient: BoundThreadsClient,
    private readonly strategy: ThreadsRateLimitStrategy,
    private readonly tokenRefresh: ThreadsTokenRefreshService,
    private readonly profileFetcher: ThreadsProfileFetcher,
    private readonly audienceFetcher: ThreadsAudienceFetcher,
    private readonly contentFetcher: ThreadsContentFetcher,
    private readonly repliesFetcher: ThreadsRepliesFetcher,
    private readonly mentionsFetcher: ThreadsMentionsFetcher,
  ) {
    // threadsClient is held so BoundThreadsClient stays alive in the DI
    // container alongside the fetchers (they consume it under the same
    // THREADS_API_CLIENT token).
    void this.threadsClient;
  }

  rateLimitHints(context?: PlatformAdapterContext): RateLimitHint[] {
    return this.strategy.hints(context ?? {});
  }

  supportMatrix(): SupportMatrix {
    return THREADS_SUPPORT_MATRIX;
  }

  /**
   * Resolves a guaranteed-fresh access token. The worker injects `accountId`
   * (bigint) into `metadata`; if for some reason it's not there (ad-hoc
   * admin call) we fall back to the original token — the adapter still
   * works, it just won't auto-refresh.
   */
  private async freshToken(
    metadata: Record<string, unknown> | undefined,
    accessToken: string,
  ): Promise<string> {
    const accountId =
      typeof metadata?.accountId === 'bigint' ? metadata.accountId : null;
    if (accountId == null) return accessToken;
    return this.tokenRefresh.ensureFresh(accountId, accessToken);
  }

  async fetchProfile(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ProfileData> {
    const token = await this.freshToken(metadata, accessToken);
    return this.profileFetcher.fetch(token, canonicalId, metadata);
  }

  async fetchAudience(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AudienceData> {
    const token = await this.freshToken(metadata, accessToken);
    return this.audienceFetcher.fetch(token, canonicalId, metadata);
  }

  async fetchContents(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    const token = await this.freshToken(metadata, accessToken);
    return this.contentFetcher.fetch(token, canonicalId, opts, metadata);
  }

  async fetchComments(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<CommentData[]> {
    const token = await this.freshToken(metadata, accessToken);
    return this.repliesFetcher.fetch(token, canonicalId, opts, metadata);
  }

  async fetchMentions(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    const token = await this.freshToken(metadata, accessToken);
    return this.mentionsFetcher.fetch(token, canonicalId, opts, metadata);
  }
}
