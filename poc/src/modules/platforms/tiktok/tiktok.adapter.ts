// TikTokAdapter — facade implementing PlatformAdapter for TikTok Business
// organic accounts. F3.
//
// All HTTP, rate-limit, persistence, parsing and TikTok quirks live in:
//   - shared/tiktok-api/  (chokepoint + Bearer auth + cursor paging)
//   - tiktok/fetcher/     (per-product orchestration)
//   - tiktok/mapper/      (pure transforms)
//   - tiktok.rate-limit.strategy.ts
//   - tiktok.support-matrix.ts

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
import type { BoundTikTokClient } from '../shared/tiktok-api';
import { TikTokRateLimitStrategy } from './tiktok.rate-limit.strategy';
import { TIKTOK_SUPPORT_MATRIX } from './tiktok.support-matrix';
import { TIKTOK_API_CLIENT } from './tiktok.tokens';
import { TikTokProfileFetcher } from './fetcher/tiktok-profile.fetcher';
import { TikTokAudienceFetcher } from './fetcher/tiktok-audience.fetcher';
import { TikTokContentFetcher } from './fetcher/tiktok-content.fetcher';
import { TikTokCommentsFetcher } from './fetcher/tiktok-comments.fetcher';
import { TikTokMentionsFetcher } from './fetcher/tiktok-mentions.fetcher';

@Injectable()
export class TikTokAdapter implements PlatformAdapter {
  readonly platform = 'tiktok';

  constructor(
    @Inject(TIKTOK_API_CLIENT)
    private readonly apiClient: BoundTikTokClient,
    private readonly strategy: TikTokRateLimitStrategy,
    private readonly profileFetcher: TikTokProfileFetcher,
    private readonly audienceFetcher: TikTokAudienceFetcher,
    private readonly contentFetcher: TikTokContentFetcher,
    private readonly commentsFetcher: TikTokCommentsFetcher,
    private readonly mentionsFetcher: TikTokMentionsFetcher,
  ) {
    void this.apiClient;
  }

  rateLimitHints(context?: PlatformAdapterContext): RateLimitHint[] {
    return this.strategy.hints(context ?? {});
  }

  supportMatrix(): SupportMatrix {
    return TIKTOK_SUPPORT_MATRIX;
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

  fetchComments(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<CommentData[]> {
    return this.commentsFetcher.fetch(accessToken, canonicalId, opts, metadata);
  }

  fetchMentions(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    return this.mentionsFetcher.fetch(accessToken, canonicalId, opts, metadata);
  }
}
