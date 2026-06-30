// TikTok profile fetcher. v1.3.

import { Inject, Injectable } from '@nestjs/common';
import type { ProfileData } from '../../shared/platform-types';
import type {
  BoundTikTokClient,
  TikTokBusinessAccount,
} from '../../shared/tiktok-api';
import { extractAccountId } from '../../shared/tiktok-api';
import { buildTikTokContext } from '../tiktok.context';
import { TIKTOK_API_CLIENT } from '../tiktok.tokens';

const PROFILE_FIELDS = [
  'display_name',
  'username',
  'profile_image',
  'is_verified',
  'is_business_account',
  'followers_count',
  'following_count',
  'bio_description',
  'profile_deep_link',
  'total_likes',
  'videos_count',
];

@Injectable()
export class TikTokProfileFetcher {
  constructor(
    @Inject(TIKTOK_API_CLIENT) private readonly client: BoundTikTokClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ProfileData> {
    const ctx = buildTikTokContext(accessToken, canonicalId, metadata);
    const account = await this.client.call<TikTokBusinessAccount>({
      endpoint: '/business/get/',
      method: 'GET',
      fields: PROFILE_FIELDS,
      accessToken,
      context: ctx,
      accountId: extractAccountId(metadata),
    });

    // TikTok exposes `videos_count` (lifetime) and `total_likes` (lifetime
    // likes received). The first lands in postsCount; the second is account
    // insight, surfaced via the audience fetcher (lifetimeLikes there).
    const profileUrl =
      account.profile_deep_link ??
      (account.username != null ? `https://www.tiktok.com/@${account.username}` : null);

    return {
      username: account.username ?? null,
      displayName: account.display_name ?? null,
      biography: account.bio_description ?? null,
      avatarUrl: account.profile_image ?? null,
      profileUrl,
      followersCount: account.followers_count ?? null,
      followingCount: account.following_count ?? null,
      postsCount: account.videos_count ?? null,
      verified: account.is_verified ?? null,
      accountType: account.is_business_account ? 'business' : null,
      fetchedAt: new Date(),
    };
  }
}
