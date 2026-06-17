// Threads profile fetcher.
//
// Single endpoint: GET /{user-id} (or /me) with `fields=`. The Threads Graph
// returns the same envelope as FB/IG (single object on /{id}), so we get the
// JSON back and map straight onto ProfileData.
//
// `profileUrl` isn't in the response — Threads doesn't surface a server-side
// permalink for users. We reconstruct https://www.threads.net/@<username>
// when username is present.
//
// `followersCount` is NOT on the user object — it lives on the
// /{id}/threads_insights endpoint (metric=followers_count). We fetch it as a
// best-effort second call so the count reaches the canonical profile's
// reputation.follower_count (and from there the consumer). A failure of this
// secondary call never fails the identity snapshot — followers fall back to
// null and are retried on the next sync.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BoundThreadsClient } from '../../shared/threads-api/threads-client';
import type {
  ThreadsApiResponse,
  ThreadsInsight,
  ThreadsUser,
} from '../../shared/threads-api/threads-types';
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

type ThreadsContext = ReturnType<typeof buildThreadsContext>;

@Injectable()
export class ThreadsProfileFetcher {
  private readonly logger = new Logger(ThreadsProfileFetcher.name);

  constructor(
    @Inject(THREADS_API_CLIENT)
    private readonly client: BoundThreadsClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ProfileData> {
    const context = buildThreadsContext(accessToken, canonicalId, metadata);
    const accountId = extractAccountId(metadata);

    const body = await this.client.call<ThreadsUser>({
      endpoint: `/${canonicalId}`,
      params: { fields: PROFILE_FIELDS },
      accessToken,
      context,
      accountId,
    });

    // Secondary, best-effort call — the follower count is the only piece of the
    // profile that isn't on the user object.
    const followersCount = await this.fetchFollowerCount(
      accessToken,
      canonicalId,
      context,
      accountId,
    );

    const username = body.username ?? null;
    const profileUrl = username ? `https://www.threads.net/@${username}` : null;

    return {
      username,
      displayName: body.name ?? null,
      biography: body.threads_biography ?? null,
      avatarUrl: body.threads_profile_picture_url ?? null,
      profileUrl,
      followersCount,
      // following_count is not exposed by the Threads API.
      followingCount: null,
      postsCount: null,
      verified: body.is_verified ?? null,
      accountType: null,
      fetchedAt: new Date(),
    };
  }

  /**
   * Reads the lifetime follower count from
   * GET /{id}/threads_insights?metric=followers_count. Threads ships it either
   * as `total_value.value` (current count) or a daily `values[]` series (we
   * take the latest sample). The `followers_count` metric has NO 100-follower
   * gate (that gate only applies to follower_demographics), so it's available
   * for any account with the insights scope.
   *
   * Returns null on ANY failure — a missing `threads_manage_insights` scope, a
   * rate-limit, or an empty body must never sink the identity snapshot; the
   * profile still saves and the count is retried next cycle.
   */
  private async fetchFollowerCount(
    accessToken: string,
    canonicalId: string,
    context: ThreadsContext,
    accountId: bigint | undefined,
  ): Promise<number | null> {
    try {
      const res = await this.client.call<ThreadsApiResponse<ThreadsInsight[]>>({
        endpoint: `/${canonicalId}/threads_insights`,
        params: { metric: 'followers_count' },
        accessToken,
        context,
        accountId,
      });
      for (const insight of res.data ?? []) {
        if (typeof insight.total_value?.value === 'number') {
          return insight.total_value.value;
        }
        const last = insight.values?.[insight.values.length - 1]?.value;
        if (typeof last === 'number') return last;
      }
      return null;
    } catch (err) {
      this.logger.warn(
        `Threads followers_count fetch failed for ${canonicalId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }
}
