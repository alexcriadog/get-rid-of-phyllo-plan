// YoutubeAdapter — facade implementing the PlatformAdapter port.
//
// Wires together: profile (channels.list), content (uploads playlist +
// batched videos.list), audience (Analytics reports), comments
// (commentThreads.list per top-N video). Mentions and stories are not
// applicable to YouTube and are intentionally absent.
//
// All HTTP, rate-limit, persistence, parsing live in:
//   - shared/youtube-api/  (chokepoint client + token refresh + types)
//   - youtube/fetcher/     (per-product orchestration)
//   - youtube/mapper/      (pure transforms)
//   - youtube.rate-limit.strategy.ts
//   - youtube.support-matrix.ts

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
import type { BoundYoutubeClient } from '../shared/youtube-api/youtube-client';
import { YoutubeTokenRefreshService } from '../shared/youtube-api/youtube-token-refresh.service';
import { YoutubeRateLimitStrategy } from './youtube.rate-limit.strategy';
import { YOUTUBE_SUPPORT_MATRIX } from './youtube.support-matrix';
import { YOUTUBE_API_CLIENT } from './youtube.tokens';
import { YoutubeProfileFetcher } from './fetcher/youtube-profile.fetcher';
import { YoutubeContentFetcher } from './fetcher/youtube-content.fetcher';
import { YoutubeAudienceFetcher } from './fetcher/youtube-audience.fetcher';
import { YoutubeCommentsFetcher } from './fetcher/youtube-comments.fetcher';

@Injectable()
export class YoutubeAdapter implements PlatformAdapter {
  readonly platform = 'youtube';

  constructor(
    @Inject(YOUTUBE_API_CLIENT)
    private readonly youtubeClient: BoundYoutubeClient,
    private readonly strategy: YoutubeRateLimitStrategy,
    private readonly tokenRefresh: YoutubeTokenRefreshService,
    private readonly profileFetcher: YoutubeProfileFetcher,
    private readonly contentFetcher: YoutubeContentFetcher,
    private readonly audienceFetcher: YoutubeAudienceFetcher,
    private readonly commentsFetcher: YoutubeCommentsFetcher,
  ) {
    void this.youtubeClient;
  }

  rateLimitHints(context?: PlatformAdapterContext): RateLimitHint[] {
    return this.strategy.hints(context ?? {});
  }

  supportMatrix(): SupportMatrix {
    return YOUTUBE_SUPPORT_MATRIX;
  }

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
    return this.commentsFetcher.fetch(token, canonicalId, opts, metadata);
  }
}
