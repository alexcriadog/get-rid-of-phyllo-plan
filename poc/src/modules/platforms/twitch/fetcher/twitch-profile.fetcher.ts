// Twitch profile fetcher.
//
// Pipeline (1 broadcaster):
//   1. GET /users (mine) — base identity. Cost: 1 Helix point.
//   2. GET /channels?broadcaster_id= — title, language, current game.
//      Cost: 1 point.
//   3. GET /channels/followers?broadcaster_id=&moderator_id=&first=1 —
//      total count via the top-level `.total` field. Cost: 1 point.
//   4. GET /subscriptions?broadcaster_id=&first=100 + paginate (up to
//      SUBS_MAX_PAGES) — aggregate by tier and gift status. Cost: up to
//      SUBS_MAX_PAGES Helix points.
//
// Steps 3 + 4 are best-effort: if the scope was not granted (403) we log
// and persist the snapshot without the count rather than failing the whole
// profile fetch. Identity is the most important product — better to ship
// follower/sub gaps than to mark the account as failing every 6h.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ProfileData } from '../../shared/platform-types';
import type {
  BoundTwitchClient,
  TwitchCallContext,
} from '../../shared/twitch-api/twitch-client';
import type { TwitchSubscriptionsResponse } from '../../shared/twitch-api/twitch-types';
import { extractAccountId } from '../../shared/meta-graph';
import { buildTwitchContext } from '../twitch.context';
import {
  twitchUserToProfile,
  type TwitchSubsAggregate,
} from '../mapper/twitch-profile.mapper';
import { TWITCH_API_CLIENT } from '../twitch.tokens';

const SUBS_PAGE_SIZE = 100;
const SUBS_MAX_PAGES = 50;

@Injectable()
export class TwitchProfileFetcher {
  private readonly logger = new Logger(TwitchProfileFetcher.name);

  constructor(
    @Inject(TWITCH_API_CLIENT)
    private readonly client: BoundTwitchClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ProfileData> {
    const accountId = extractAccountId(metadata);
    const ctx = buildTwitchContext(accessToken, canonicalId, metadata);
    const callCtx: TwitchCallContext = { accessToken, context: ctx, accountId };

    // 1. /users (mine) — empty ids/logins → self
    const usersRes = await this.client.getUsers(callCtx);
    const user = usersRes.data?.[0];
    if (!user) {
      throw new Error(
        `twitch /users returned no items for canonicalId=${canonicalId}`,
      );
    }
    const broadcasterId = user.id;

    // 2. /channels — current title/game/language
    const channel = await this.client
      .getChannel({ ...callCtx, broadcasterId })
      .then((r) => r.data?.[0] ?? null)
      .catch((err) => {
        this.logger.warn(
          `getChannel failed for ${broadcasterId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return null;
      });

    // 3. /channels/followers — total count via top-level .total
    const followerCount = await this.client
      .getFollowers({
        ...callCtx,
        broadcasterId,
        moderatorId: broadcasterId,
        first: 1,
      })
      .then((r) => (typeof r.total === 'number' ? r.total : null))
      .catch((err) => {
        this.logger.warn(
          `getFollowers failed for ${broadcasterId}: ${
            err instanceof Error ? err.message : String(err)
          } — proceeding without follower_count`,
        );
        return null;
      });

    // 4. /subscriptions — paginate, aggregate by tier
    const subs = await this.aggregateSubscriptions(callCtx, broadcasterId);

    return twitchUserToProfile({
      user,
      channel,
      followerCount,
      subs,
    });
  }

  private async aggregateSubscriptions(
    callCtx: TwitchCallContext,
    broadcasterId: string,
  ): Promise<TwitchSubsAggregate | null> {
    let total = 0;
    let tier1 = 0;
    let tier2 = 0;
    let tier3 = 0;
    let gifts = 0;
    let after: string | undefined;
    let pages = 0;
    let officialTotal: number | null = null;

    try {
      while (pages < SUBS_MAX_PAGES) {
        const res: TwitchSubscriptionsResponse =
          await this.client.getSubscriptions({
            ...callCtx,
            broadcasterId,
            first: SUBS_PAGE_SIZE,
            after,
          });
        if (officialTotal === null && typeof res.total === 'number') {
          officialTotal = res.total;
        }
        for (const s of res.data ?? []) {
          total += 1;
          if (s.is_gift) gifts += 1;
          switch (s.tier) {
            case '1000':
              tier1 += 1;
              break;
            case '2000':
              tier2 += 1;
              break;
            case '3000':
              tier3 += 1;
              break;
            default:
              break;
          }
        }
        const cursor = res.pagination?.cursor;
        if (!cursor || (res.data?.length ?? 0) < SUBS_PAGE_SIZE) break;
        after = cursor;
        pages += 1;
      }
    } catch (err) {
      this.logger.warn(
        `getSubscriptions failed for ${broadcasterId}: ${
          err instanceof Error ? err.message : String(err)
        } — proceeding without subscriber data`,
      );
      return null;
    }

    // Trust the API's reported total over our running count when available
    // (covers the case where the broadcaster has > SUBS_MAX_PAGES × 100 subs
    // and pagination got truncated).
    if (officialTotal !== null && officialTotal > total) {
      total = officialTotal;
    }

    return { total, tier1, tier2, tier3, gifts };
  }
}
