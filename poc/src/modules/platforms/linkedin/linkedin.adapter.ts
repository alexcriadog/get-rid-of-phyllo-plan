// LinkedInAdapter — facade implementing the PlatformAdapter port.
//
// One platform, two account kinds (metadata.kind): 'member' (the OAuth
// user) and 'organization' (company pages the member administers). The
// fetchers branch internally; the adapter stays kind-agnostic.
//
// fetchContents returns [] for member rows — LinkedIn's person-author
// Posts finder needs r_member_social, a closed permission. Aggregate
// member post analytics ship via fetchAudience instead.

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
import type { BoundLinkedInClient } from '../shared/linkedin-api/linkedin-client';
import { LinkedInTokenRefreshService } from '../shared/linkedin-api/linkedin-token-refresh.service';
import { LinkedInRateLimitStrategy } from './linkedin.rate-limit.strategy';
import { LINKEDIN_SUPPORT_MATRIX } from './linkedin.support-matrix';
import { LINKEDIN_API_CLIENT } from './linkedin.tokens';
import { LinkedInProfileFetcher } from './fetcher/linkedin-profile.fetcher';
import { LinkedInAudienceFetcher } from './fetcher/linkedin-audience.fetcher';
import { LinkedInContentFetcher } from './fetcher/linkedin-content.fetcher';
import { LinkedInCommentsFetcher } from './fetcher/linkedin-comments.fetcher';
import { LinkedInMentionsFetcher } from './fetcher/linkedin-mentions.fetcher';

@Injectable()
export class LinkedInAdapter implements PlatformAdapter {
  readonly platform = 'linkedin';

  constructor(
    @Inject(LINKEDIN_API_CLIENT)
    private readonly linkedInClient: BoundLinkedInClient,
    private readonly strategy: LinkedInRateLimitStrategy,
    private readonly tokenRefresh: LinkedInTokenRefreshService,
    private readonly profileFetcher: LinkedInProfileFetcher,
    private readonly audienceFetcher: LinkedInAudienceFetcher,
    private readonly contentFetcher: LinkedInContentFetcher,
    private readonly commentsFetcher: LinkedInCommentsFetcher,
    private readonly mentionsFetcher: LinkedInMentionsFetcher,
  ) {
    void this.linkedInClient;
  }

  rateLimitHints(context?: PlatformAdapterContext): RateLimitHint[] {
    return this.strategy.hints(context ?? {});
  }

  supportMatrix(): SupportMatrix {
    return LINKEDIN_SUPPORT_MATRIX;
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
