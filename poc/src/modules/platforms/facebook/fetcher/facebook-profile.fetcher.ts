// Facebook profile fetcher. Phase C.
// Single public `fetch(...)` method; orchestration only — HTTP + rate-bucket
// + persistence are inside the injected BoundGraphClient.

import { Inject, Injectable } from '@nestjs/common';
import type { BoundGraphClient } from '../../shared/meta-graph/graph-client';
import { asNumber, extractAccountId } from '../../shared/meta-graph';
import type { ProfileData } from '../../shared/platform-types';
import { buildFacebookContext } from '../facebook.context';
import { FACEBOOK_GRAPH_CLIENT } from '../facebook.tokens';
import { extractPictureUrl } from '../mapper/facebook-post.mapper';

@Injectable()
export class FacebookProfileFetcher {
  constructor(
    @Inject(FACEBOOK_GRAPH_CLIENT)
    private readonly client: BoundGraphClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ProfileData> {
    const body = await this.client.call<Record<string, unknown>>({
      endpoint: `/${canonicalId}`,
      params: {
        fields: 'name,about,category,picture,fan_count,followers_count,link',
      },
      accessToken,
      context: buildFacebookContext(accessToken, canonicalId, metadata),
      accountId: extractAccountId(metadata),
    });

    const picture = extractPictureUrl(body.picture);
    const fanCount = asNumber(body.fan_count);
    const followersCount = asNumber(body.followers_count);

    return {
      username: (body.name as string) ?? null,
      displayName: (body.name as string) ?? null,
      biography: (body.about as string) ?? null,
      avatarUrl: picture,
      profileUrl: (body.link as string) ?? null,
      // FB Pages expose both `fan_count` (likes) and `followers_count`.
      // followers_count is the closer analogue to IG followers — prefer it
      // but fall back to fan_count when missing.
      followersCount: followersCount ?? fanCount,
      followingCount: null,
      postsCount: null,
      verified: null,
      accountType: (body.category as string) ?? null,
      fetchedAt: new Date(),
    };
  }
}
