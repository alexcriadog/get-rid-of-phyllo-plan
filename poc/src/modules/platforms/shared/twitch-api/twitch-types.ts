// Helix response shapes. Strictly the fields we read — the raw payload is
// archived in Mongo (raw_platform_responses) so anything we miss here stays
// inspectable.
//
// Helix returns `{ data: T[], pagination?: { cursor?: string } }` for list
// endpoints; the cursor is only present when there are more pages. The
// follower endpoint additionally returns `total` at the top level so we can
// read follower_count without paginating.

export interface TwitchPagination {
  cursor?: string;
}

export interface TwitchListResponse<T> {
  data: T[];
  pagination?: TwitchPagination;
}

export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  /** '' (none), 'affiliate', 'partner'. */
  broadcaster_type: string;
  /** '' (none), 'staff', 'admin', 'global_mod'. */
  type: string;
  description: string;
  profile_image_url: string;
  offline_image_url: string;
  /**
   * Deprecated by Twitch but still returned. Channel-lifetime view count.
   * May be 0 for old / private channels.
   */
  view_count?: number;
  email?: string;
  /** ISO 8601 timestamp. */
  created_at: string;
}

export interface TwitchChannel {
  broadcaster_id: string;
  broadcaster_login: string;
  broadcaster_name: string;
  broadcaster_language: string;
  game_id: string;
  game_name: string;
  title: string;
  delay: number;
  tags: string[];
  content_classification_labels: string[];
  is_branded_content: boolean;
}

/**
 * `GET /channels/followers?first=1` returns the total count at the top level
 * even when first=1 caps the array. We only read `.total`.
 */
export interface TwitchFollowersResponse {
  total: number;
  data: Array<{
    user_id: string;
    user_login: string;
    user_name: string;
    followed_at: string;
  }>;
  pagination?: TwitchPagination;
}

export interface TwitchSubscription {
  broadcaster_id: string;
  broadcaster_login: string;
  broadcaster_name: string;
  gifter_id: string;
  gifter_login: string;
  gifter_name: string;
  is_gift: boolean;
  plan_name: string;
  /** '1000' (tier 1), '2000' (tier 2), '3000' (tier 3). */
  tier: string;
  user_id: string;
  user_login: string;
  user_name: string;
}

export interface TwitchSubscriptionsResponse {
  total: number;
  /** Sum of monthly USD value, all subs combined. Twitch returns this as a
   * convenience; do NOT treat it as creator revenue (revenue share differs
   * by tier and partner status, not exposed). */
  points: number;
  data: TwitchSubscription[];
  pagination?: TwitchPagination;
}

export interface TwitchMutedSegment {
  duration: number;
  offset: number;
}

export interface TwitchVideo {
  id: string;
  stream_id: string | null;
  user_id: string;
  user_login: string;
  user_name: string;
  title: string;
  description: string;
  /** ISO 8601. */
  created_at: string;
  /** ISO 8601. */
  published_at: string;
  url: string;
  thumbnail_url: string;
  /** 'public' or 'private'. */
  viewable: string;
  view_count: number;
  /** ISO 639-1 (or 'other'). */
  language: string;
  /** 'archive' (broadcast), 'highlight' (clipped), 'upload' (manual upload). */
  type: string;
  /** Helix-format duration: '3h8m33s' / '1m25s' / '47s'. */
  duration: string;
  muted_segments: TwitchMutedSegment[] | null;
}

export interface TwitchClip {
  id: string;
  url: string;
  embed_url: string;
  broadcaster_id: string;
  broadcaster_name: string;
  creator_id: string;
  creator_name: string;
  video_id: string;
  game_id: string;
  language: string;
  title: string;
  view_count: number;
  /** ISO 8601. */
  created_at: string;
  thumbnail_url: string;
  /** Seconds. */
  duration: number;
  /** Offset into the source VOD where the clip starts. */
  vod_offset: number | null;
  is_featured: boolean;
}

export interface TwitchGame {
  id: string;
  name: string;
  box_art_url: string;
  igdb_id?: string;
}

/** Response from GET https://id.twitch.tv/oauth2/validate */
export interface TwitchValidateResponse {
  client_id: string;
  login: string;
  scopes: string[];
  user_id: string;
  /** Seconds until expiry. */
  expires_in: number;
}

/** Response from POST https://id.twitch.tv/oauth2/token (refresh + initial). */
export interface TwitchTokenResponse {
  access_token: string;
  refresh_token: string;
  /** Seconds. ~14,124 for user tokens. */
  expires_in: number;
  scope: string[];
  token_type: string;
}
