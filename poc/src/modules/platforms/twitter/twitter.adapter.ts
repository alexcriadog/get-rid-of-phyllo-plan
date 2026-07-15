// TwitterAdapter — LOGIN-ONLY facade implementing the PlatformAdapter port.
//
// X (Twitter) connections exist to prove account ownership and capture the
// handle: the OAuth callback in connect-tool makes the one and only X API
// call (GET /2/users/me) and persists the result into account.metadata.
// Content/metric data for X accounts is produced by the consuming backend
// via scraping — this connector NEVER calls the X API after connect (the
// free tier couldn't sustain it, and we deliberately hold no refresh token,
// so the 2h access token lapses right after login by design).
//
// fetchProfile therefore re-emits the snapshot from account.metadata: the
// identity sync job and the token-canary probe both keep succeeding without
// spending X API quota, and the /v1 identity read serves the login-time
// snapshot. It refreshes only when the account reconnects.
//
// fetchAudience/fetchContents are port-contract stubs — `twitter` only lists
// `identity` in PRODUCTS_BY_PLATFORM, so the worker never dispatches them.

import { Injectable } from '@nestjs/common';
import type { RateLimitHint } from '@shared/redis/rate-bucket.service';
import type { PlatformAdapter } from '../shared/platform-adapter.port';
import type {
  AudienceData,
  ContentData,
  ProfileData,
  SupportMatrix,
} from '../shared/platform-types';
import { TWITTER_SUPPORT_MATRIX } from './twitter.support-matrix';

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

@Injectable()
export class TwitterAdapter implements PlatformAdapter {
  readonly platform = 'twitter';

  rateLimitHints(): RateLimitHint[] {
    // No live X API calls → nothing to meter.
    return [];
  }

  supportMatrix(): SupportMatrix {
    return TWITTER_SUPPORT_MATRIX;
  }

  async fetchProfile(
    _accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ProfileData> {
    const m = metadata ?? {};
    const username = str(m.username);
    return {
      username,
      displayName: str(m.display_name),
      biography: str(m.description),
      avatarUrl: str(m.avatar_url),
      profileUrl: username
        ? `https://x.com/${username}`
        : `https://x.com/i/user/${canonicalId}`,
      followersCount: num(m.followers_count),
      followingCount: num(m.following_count),
      postsCount: num(m.tweet_count),
      verified: typeof m.verified === 'boolean' ? m.verified : null,
      accountType: str(m.verified_type),
      website: str(m.website),
      publishedAt: str(m.created_at),
      fetchedAt: new Date(),
    };
  }

  async fetchAudience(): Promise<AudienceData> {
    // Port-contract stub — `audience` is not in PRODUCTS_BY_PLATFORM for
    // twitter, so the worker never dispatches this.
    return {
      genderDistribution: [],
      ageDistribution: [],
      countryDistribution: [],
      cityDistribution: [],
      fetchedAt: new Date(),
    };
  }

  async fetchContents(): Promise<ContentData[]> {
    // Port-contract stub — content for X comes from scraping, outside this
    // connector. `engagement_new` is not enrolled for twitter accounts.
    return [];
  }
}
