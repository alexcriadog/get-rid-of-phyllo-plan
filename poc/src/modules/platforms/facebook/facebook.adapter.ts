// FacebookAdapter — facade implementing the PlatformAdapter port.
//
// All HTTP, rate-limit, persistence, parsing and Graph quirks live in:
//   - shared/meta-graph/  (chokepoint + utilities)
//   - facebook/fetcher/   (per-product orchestration)
//   - facebook/mapper/    (pure transforms)
//   - facebook.rate-limit.strategy.ts
//   - facebook.support-matrix.ts
//
// This file just wires them together. Phase C5.

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
import type { BoundGraphClient } from '../shared/meta-graph/graph-client';
import { FacebookRateLimitStrategy } from './facebook.rate-limit.strategy';
import { FACEBOOK_SUPPORT_MATRIX } from './facebook.support-matrix';
import { FACEBOOK_GRAPH_CLIENT } from './facebook.tokens';
import { FacebookProfileFetcher } from './fetcher/facebook-profile.fetcher';
import { FacebookAudienceFetcher } from './fetcher/facebook-audience.fetcher';
import { FacebookContentFetcher } from './fetcher/facebook-content.fetcher';
import { FacebookStoriesFetcher } from './fetcher/facebook-stories.fetcher';
import { FacebookMentionsFetcher } from './fetcher/facebook-mentions.fetcher';
import { FacebookCommentsFetcher } from './fetcher/facebook-comments.fetcher';

@Injectable()
export class FacebookAdapter implements PlatformAdapter {
  readonly platform = 'facebook';

  constructor(
    @Inject(FACEBOOK_GRAPH_CLIENT)
    private readonly graphClient: BoundGraphClient,
    private readonly strategy: FacebookRateLimitStrategy,
    private readonly profileFetcher: FacebookProfileFetcher,
    private readonly audienceFetcher: FacebookAudienceFetcher,
    private readonly contentFetcher: FacebookContentFetcher,
    private readonly storiesFetcher: FacebookStoriesFetcher,
    private readonly mentionsFetcher: FacebookMentionsFetcher,
    private readonly commentsFetcher: FacebookCommentsFetcher,
  ) {
    // graphClient is held so `BoundGraphClient` stays alive in the DI
    // container alongside the fetchers (they consume it under the same
    // FACEBOOK_GRAPH_CLIENT token).
    void this.graphClient;
  }

  rateLimitHints(context?: PlatformAdapterContext): RateLimitHint[] {
    return this.strategy.hints(context ?? {});
  }

  supportMatrix(): SupportMatrix {
    return FACEBOOK_SUPPORT_MATRIX;
  }

  fetchProfile(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ProfileData> {
    return this.profileFetcher.fetch(accessToken, canonicalId, metadata);
  }

  fetchAudience(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AudienceData> {
    return this.audienceFetcher.fetch(accessToken, canonicalId, metadata);
  }

  fetchContents(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    return this.contentFetcher.fetch(accessToken, canonicalId, opts, metadata);
  }

  fetchStories(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    return this.storiesFetcher.fetch(accessToken, canonicalId, metadata);
  }

  fetchMentions(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    return this.mentionsFetcher.fetch(accessToken, canonicalId, opts, metadata);
  }

  fetchComments(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<CommentData[]> {
    return this.commentsFetcher.fetch(accessToken, canonicalId, opts, metadata);
  }
}
