// channels.list item → canonical ProfileData.
//
// Notable mapping decisions:
//  - `username` is `customUrl` minus the leading '@' (some channels still
//    have the legacy non-prefixed form, so strip is a no-op there).
//  - `profileUrl` is reconstructed from customUrl when present, else the
//    generic /channel/<id> form.
//  - `verified` is `null` because YouTube doesn't expose it via the API.
//  - `accountType` is best-effort: a channel with brandingSettings.country
//    set is "brand"; otherwise null. Cheap heuristic, not authoritative.

import type { ProfileData } from '../../shared/platform-types';
import type { YoutubeChannel } from '../../shared/youtube-api/youtube-types';

export function channelToProfile(channel: YoutubeChannel): ProfileData {
  const snippet = channel.snippet ?? {};
  const stats = channel.statistics ?? {};
  const branding = channel.brandingSettings?.channel ?? {};

  const customUrl = snippet.customUrl ?? null;
  const username = customUrl ? customUrl.replace(/^@+/, '') : null;
  const profileUrl = customUrl
    ? `https://www.youtube.com/${customUrl.startsWith('@') ? customUrl : `@${customUrl}`}`
    : channel.id
      ? `https://www.youtube.com/channel/${channel.id}`
      : null;

  const avatar =
    snippet.thumbnails?.high?.url ??
    snippet.thumbnails?.medium?.url ??
    snippet.thumbnails?.default?.url ??
    null;

  return {
    username,
    displayName: snippet.title ?? null,
    biography: snippet.description ?? null,
    avatarUrl: avatar,
    profileUrl,
    followersCount: parseIntSafe(stats.subscriberCount),
    followingCount: null,
    postsCount: parseIntSafe(stats.videoCount),
    verified: null,
    accountType: branding.country ? 'brand' : null,
    website: null,
    category:
      channel.topicDetails?.topicCategories?.[0]?.split('/').pop() ?? null,
    fetchedAt: new Date(),
  };
}

function parseIntSafe(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
  return null;
}
