// Threads profile fetcher.
//
// Single endpoint: GET /{user-id} (or /me) with `fields=`. The Threads Graph
// returns the same envelope as FB/IG (single object on /{id}), so we get the
// JSON back and map straight onto ProfileData.
//
// `profileUrl` isn't in the response — Threads doesn't surface a server-side
// permalink for users. We reconstruct https://www.threads.net/@<username>
// when username is present.

import { Inject, Injectable } from '@nestjs/common';
import type { BoundThreadsClient } from '../../shared/threads-api/threads-client';
import type { ThreadsUser } from '../../shared/threads-api/threads-types';
import { extractAccountId } from '../../shared/meta-graph';
import type { ProfileData } from '../../shared/platform-types';
import { buildThreadsContext } from '../threads.context';
import { THREADS_API_CLIENT } from '../threads.tokens';

const PROFILE_FIELDS = [
  'id',
  'username',
  'name',
  'threads_profile_picture_url',
  'threads_biography',
  'is_verified',
].join(',');

@Injectable()
export class ThreadsProfileFetcher {
  constructor(
    @Inject(THREADS_API_CLIENT)
    private readonly client: BoundThreadsClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ProfileData> {
    const body = await this.client.call<ThreadsUser>({
      endpoint: `/${canonicalId}`,
      params: { fields: PROFILE_FIELDS },
      accessToken,
      context: buildThreadsContext(accessToken, canonicalId, metadata),
      accountId: extractAccountId(metadata),
    });

    const username = body.username ?? null;
    const profileUrl = username ? `https://www.threads.net/@${username}` : null;

    return {
      username,
      displayName: body.name ?? null,
      biography: body.threads_biography ?? null,
      avatarUrl: body.threads_profile_picture_url ?? null,
      profileUrl,
      // followersCount is not on the user object — it's on the
      // /me/threads_insights endpoint and lives on AudienceData. null here.
      followersCount: null,
      followingCount: null,
      postsCount: null,
      verified: body.is_verified ?? null,
      accountType: null,
      fetchedAt: new Date(),
    };
  }
}
