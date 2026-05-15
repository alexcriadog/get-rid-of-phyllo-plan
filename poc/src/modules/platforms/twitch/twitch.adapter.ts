// TwitchAdapter — facade implementing the PlatformAdapter port.
//
// Wires together: profile (Helix /users + /channels + /channels/followers +
// /subscriptions) and content (VODs + clips). Audience, engagement_deep,
// comments, mentions, stories, ratings, ads are deliberately not
// implemented — see twitch.support-matrix.ts for rationale.
//
// `fetchAudience` is required by the PlatformAdapter port, so we implement it
// as a no-op that returns empty distributions. The worker only calls it when
// `audience` is in PRODUCTS_BY_PLATFORM for the account's platform, and
// Twitch is intentionally not listed there — so this path should never
// actually run for production accounts. The implementation exists only to
// keep the type contract satisfied.

import { Inject, Injectable } from '@nestjs/common';
import type { RateLimitHint } from '@shared/redis/rate-bucket.service';
import {
  PlatformAdapter,
  PlatformAdapterContext,
} from '../shared/platform-adapter.port';
import type {
  AudienceData,
  ContentData,
  FetchOpts,
  ProfileData,
  SupportMatrix,
} from '../shared/platform-types';
import type { BoundTwitchClient } from '../shared/twitch-api/twitch-client';
import { TwitchTokenRefreshService } from '../shared/twitch-api/twitch-token-refresh.service';
import { TwitchRateLimitStrategy } from './twitch.rate-limit.strategy';
import { TWITCH_SUPPORT_MATRIX } from './twitch.support-matrix';
import { TWITCH_API_CLIENT } from './twitch.tokens';
import { TwitchProfileFetcher } from './fetcher/twitch-profile.fetcher';
import { TwitchContentFetcher } from './fetcher/twitch-content.fetcher';

@Injectable()
export class TwitchAdapter implements PlatformAdapter {
  readonly platform = 'twitch';

  constructor(
    @Inject(TWITCH_API_CLIENT)
    private readonly twitchClient: BoundTwitchClient,
    private readonly strategy: TwitchRateLimitStrategy,
    private readonly tokenRefresh: TwitchTokenRefreshService,
    private readonly profileFetcher: TwitchProfileFetcher,
    private readonly contentFetcher: TwitchContentFetcher,
  ) {
    void this.twitchClient;
  }

  rateLimitHints(context?: PlatformAdapterContext): RateLimitHint[] {
    return this.strategy.hints(context ?? {});
  }

  supportMatrix(): SupportMatrix {
    return TWITCH_SUPPORT_MATRIX;
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

  async fetchContents(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    const token = await this.freshToken(metadata, accessToken);
    return this.contentFetcher.fetch(token, canonicalId, opts, metadata);
  }

  async fetchAudience(): Promise<AudienceData> {
    // See file header — Twitch is intentionally not in PRODUCTS_BY_PLATFORM
    // for `audience`. This stub is only here to satisfy the port contract.
    return {
      genderDistribution: [],
      ageDistribution: [],
      countryDistribution: [],
      cityDistribution: [],
      fetchedAt: new Date(),
    };
  }
}
