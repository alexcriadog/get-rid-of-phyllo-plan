// Instagram profile fetcher. Phase E.

import { Inject, Injectable } from '@nestjs/common';
import type { BoundGraphClient } from '../../shared/meta-graph/graph-client';
import { asNumber, extractAccountId } from '../../shared/meta-graph';
import type { ProfileData } from '../../shared/platform-types';
import { buildInstagramContext } from '../instagram.context';
import { INSTAGRAM_GRAPH_CLIENT } from '../instagram.tokens';

@Injectable()
export class InstagramProfileFetcher {
  constructor(
    @Inject(INSTAGRAM_GRAPH_CLIENT)
    private readonly client: BoundGraphClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ProfileData> {
    // IG Business /<ig_user_id> — safe field set. `account_type` and
    // `shopping_review_status` return 400 for any account not enrolled
    // in IG Shopping, and one bad field invalidates the whole call —
    // so we skip them. `website` is universally available.
    //
    // Phase B additions (probe-confirmed against Camaleonic):
    //   is_published, has_profile_pic, legacy_instagram_user_id.
    // shopping_product_tag_eligibility was probe-rejected (#10
    // permission) on our scope set — kept out.
    const body = await this.client.call<Record<string, unknown>>({
      endpoint: `/${canonicalId}`,
      params: {
        fields:
          'id,username,name,biography,profile_picture_url,followers_count,follows_count,media_count,website,is_published,has_profile_pic,legacy_instagram_user_id',
      },
      accessToken,
      context: buildInstagramContext(accessToken, canonicalId, metadata),
      accountId: extractAccountId(metadata),
    });

    const username = (body.username as string) ?? null;
    return {
      username,
      displayName: (body.name as string) ?? null,
      biography: (body.biography as string) ?? null,
      avatarUrl: (body.profile_picture_url as string) ?? null,
      profileUrl: username ? `https://instagram.com/${username}` : null,
      followersCount: asNumber(body.followers_count),
      followingCount: asNumber(body.follows_count),
      postsCount: asNumber(body.media_count),
      verified: null,
      accountType: null,
      website: (body.website as string) ?? null,
      isPublished:
        typeof body.is_published === 'boolean' ? body.is_published : null,
      hasProfilePic:
        typeof body.has_profile_pic === 'boolean' ? body.has_profile_pic : null,
      legacyInstagramUserId:
        typeof body.legacy_instagram_user_id === 'string'
          ? body.legacy_instagram_user_id
          : null,
      fetchedAt: new Date(),
    };
  }
}
