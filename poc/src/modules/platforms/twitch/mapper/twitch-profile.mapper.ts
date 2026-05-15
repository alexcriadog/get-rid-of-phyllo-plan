// Helix /users + /channels + /channels/followers + /subscriptions
// → canonical ProfileData.
//
// Mapping decisions:
//  - `username` is `login` (Twitch's URL slug; always lowercase).
//  - `displayName` is `display_name` (case-preserved, may include Unicode).
//  - `profileUrl` reconstructed from `login`.
//  - `accountType` is `broadcaster_type` ('partner', 'affiliate', '' → null).
//  - `bannerUrl` is `offline_image_url` (the closest analogue — the panel
//    image shown when the channel is offline).
//  - `subscriberCount` + `subscribersByTier` come from the /subscriptions
//    aggregation done in the fetcher (Helix returns a list, we count).
//  - `country` left null — Twitch doesn't expose broadcaster country.
//  - `defaultLanguage` is `broadcaster_language` (ISO 639-1) from /channels.

import type { ProfileData } from '../../shared/platform-types';
import type {
  TwitchChannel,
  TwitchUser,
} from '../../shared/twitch-api/twitch-types';

export interface TwitchSubsAggregate {
  total: number;
  tier1: number;
  tier2: number;
  tier3: number;
  gifts: number;
}

export interface TwitchProfileSource {
  user: TwitchUser;
  channel: TwitchChannel | null;
  followerCount: number | null;
  subs: TwitchSubsAggregate | null;
}

export function twitchUserToProfile(src: TwitchProfileSource): ProfileData {
  const { user, channel, followerCount, subs } = src;
  const profileUrl = user.login ? `https://www.twitch.tv/${user.login}` : null;
  const accountType =
    user.broadcaster_type && user.broadcaster_type.length > 0
      ? user.broadcaster_type
      : null;

  return {
    username: user.login || null,
    displayName: user.display_name || null,
    biography: user.description || null,
    avatarUrl: user.profile_image_url || null,
    profileUrl,
    followersCount: followerCount,
    followingCount: null,
    postsCount: null,
    verified: null,
    accountType,
    website: null,
    category: null,
    bannerUrl: user.offline_image_url || null,
    defaultLanguage: channel?.broadcaster_language || null,
    country: null,
    publishedAt: user.created_at || null,
    subscriberCount: subs?.total ?? null,
    subscribersByTier: subs
      ? {
          tier1: subs.tier1,
          tier2: subs.tier2,
          tier3: subs.tier3,
          gifts: subs.gifts,
        }
      : null,
    fetchedAt: new Date(),
  };
}
