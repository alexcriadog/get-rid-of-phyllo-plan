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

/** `/business/get/` data shape (verified live). */
export interface TikTokBusinessAccount {
  display_name?: string;
  username?: string;
  profile_image?: string;
  is_verified?: boolean;
  followers_count?: number;
  following_count?: number;
  bio_description?: string;
  audience_countries?: Array<{ country: string; percentage: number }>;
  audience_genders?: Array<{ gender: string; percentage: number }>;
  /** Daily time-series — entries sorted ascending by date. */
  metrics?: Array<{
    date: string;             // YYYY-MM-DD
    followers_count?: number;
    engaged_audience?: number;
  }>;
}

/** `/business/video/list/` video object (verified live). */
export interface TikTokVideo {
  item_id: string;
  caption?: string;
  create_time?: string;        // unix seconds AS STRING (verified live)
  thumbnail_url?: string;
  share_url?: string;
  video_duration?: number;     // seconds (decimal)
  video_views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
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
