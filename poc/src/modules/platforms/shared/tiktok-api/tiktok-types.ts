// TikTok Business API v1.3 response shapes (business-api.tiktok.com/open_api/v1.3/).
// Verified against live probes 2026-04-29.

/** v1.3 envelope. Success means `code === 0`. */
export interface TikTokV13Envelope<T> {
  code: number;
  message: string;
  request_id: string;
  data: T;
}

/** Cursor-paginated list payload. */
export interface TikTokListResponse<T> {
  list: T[];                  // adapter-side normalisation; raw key is endpoint-specific (videos, comments, etc.)
  cursor?: number;
  has_more?: boolean;
}

export interface TikTokAudienceBucket {
  country?: string;
  city?: string;
  gender?: string;
  age?: string;
  percentage: number;
}

export interface TikTokAudienceActivityEntry {
  hour: string;          // "0".."23" as string
  count: number;
}

/**
 * One entry in the `metrics[]` array returned by `/business/get/` — a per-day
 * snapshot of account-level counters and breakdowns. Field availability
 * depends on what was requested in `fields=`; empty when not requested.
 */
export interface TikTokAccountDailyMetric {
  date: string;                    // YYYY-MM-DD
  // Daily counters
  video_views?: number;
  unique_video_views?: number;     // distinct viewers that day (account-level reach)
  profile_views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  engaged_audience?: number;
  // Followers delta + total
  daily_total_followers?: number;
  daily_new_followers?: number;
  daily_lost_followers?: number;
  // CTAs
  bio_link_clicks?: number;
  email_clicks?: number;
  address_clicks?: number;
  phone_number_clicks?: number;
  app_download_clicks?: number;
  lead_submissions?: number;
  // 24-bucket activity heatmap of when YOUR audience is online that day
  audience_activity?: TikTokAudienceActivityEntry[];
  // Legacy short-form fields kept for backwards compat with existing audience fetcher
  followers_count?: number;
}

/** `/business/get/` data shape (verified live 2026-04-29). */
export interface TikTokBusinessAccount {
  // Profile basics
  display_name?: string;
  username?: string;
  profile_image?: string;
  is_verified?: boolean;
  is_business_account?: boolean;
  followers_count?: number;
  following_count?: number;
  bio_description?: string;
  profile_deep_link?: string;
  total_likes?: number;            // lifetime likes received across the account
  videos_count?: number;           // lifetime video count

  // Audience demographics — gated behind 100-follower threshold
  audience_countries?: TikTokAudienceBucket[];
  audience_cities?: TikTokAudienceBucket[];
  audience_genders?: TikTokAudienceBucket[];
  audience_ages?: TikTokAudienceBucket[];

  /** Daily time-series — entries sorted ascending by date. */
  metrics?: TikTokAccountDailyMetric[];
}

export interface TikTokImpressionSource {
  impression_source: string;   // "For You" | "Follow" | "Personal Profile" | "Search" | "Sound" | "Others"
  percentage: number;
}

export interface TikTokSecondPercentage {
  second: string;              // "0".."N" as string (TikTok returns it as string)
  percentage: number;
}

export interface TikTokAudienceTypeEntry {
  type: string;                // "NEW_VIEWER" | "RETURN_VIEWER" | "FOLLOWER_PERCENT" | "NON_FOLLOWER_PERCENT"
  percentage: number;
}

/**
 * `/business/video/list/` video object — verified live 2026-04-29.
 *
 * The wider field set (reach / total_time_watched / impression_sources / …)
 * is available with the current Business Center token; we just have to
 * request the v1.3-correct field names. See `tiktok.constants.ts` for the
 * full whitelist used by the content fetcher.
 */
export interface TikTokVideo {
  // Core
  item_id: string;
  caption?: string;
  create_time?: string;        // unix seconds AS STRING (verified live)
  thumbnail_url?: string;
  share_url?: string;
  embed_url?: string;          // official TikTok player URL — used by the UI iframe
  media_type?: string;         // "VIDEO"
  is_ad?: boolean;
  video_duration?: number;     // seconds (decimal)

  // Basic engagement counters
  video_views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  favorites?: number;          // TikTok's name for "saves"

  // Deep insights
  reach?: number;              // unique viewers
  total_time_watched?: number; // seconds summed across all viewers
  average_time_watched?: number;
  full_video_watched_rate?: number;   // 0..1
  impression_sources?: TikTokImpressionSource[];
  video_view_retention?: TikTokSecondPercentage[];
  engagement_likes?: TikTokSecondPercentage[];

  // Audience breakdowns — per video, NOT account-level
  audience_countries?: TikTokAudienceBucket[];
  audience_cities?: TikTokAudienceBucket[];
  audience_genders?: TikTokAudienceBucket[];
  audience_types?: TikTokAudienceTypeEntry[];

  // Profile lift
  profile_views?: number;
  new_followers?: number;

  // CTAs
  website_clicks?: number;
  email_clicks?: number;
  phone_number_clicks?: number;
  address_clicks?: number;
  app_download_clicks?: number;
  lead_submissions?: number;
}

/** Comment object (`/business/comment/list/`). */
export interface TikTokComment {
  comment_id: string;
  video_id?: string;
  parent_comment_id?: string;
  text?: string;
  create_time?: number;
  like_count?: number;
  reply_count?: number;
  username?: string;
  display_name?: string;
  is_owner?: boolean;
  liked_by_creator?: boolean;
  pinned?: boolean;
}

export interface TikTokMention {
  item_id: string;
  caption?: string;
  create_time?: number;
  username?: string;
  display_name?: string;
  thumbnail_url?: string;
  share_url?: string;
  video_views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
}
