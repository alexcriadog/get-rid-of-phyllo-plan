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
import { TikTokTokenRefreshService } from '../shared/tiktok-api';
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
    private readonly tokenRefresh: TikTokTokenRefreshService,
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

  /**
   * Resolves a guaranteed-fresh access token. The worker injects `accountId`
   * (bigint) into `metadata`; if for some reason it's not there (ad-hoc
   * admin call, future code path), we fall back to the original token —
   * the adapter still works, it just won't auto-refresh.
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
    return this.commentsFetcher.fetch(token, canonicalId, opts, metadata);
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
