// Facebook Graph API response shapes. Phase C — extracted from
// facebook.adapter.ts inline interfaces so fetchers and mappers can
// import them without forming a circular dependency through the adapter.

import type { GraphInsight } from '../shared/meta-graph';

export interface FacebookAttachment {
  media_type?: string;
  media?: { image?: { src?: string }; source?: string };
  subattachments?: { data: FacebookAttachment[] };
  /**
   * For video posts, `target.id` IS the video_id (matches /{page_id}/videos).
   * For album/carousel posts the top-level target.id matches the post id;
   * subattachments carry per-item target ids. Used to map posts to
   * /videos batch results so we can fetch view counts in O(1) calls.
   */
  target?: { id?: string; url?: string };
  type?: string;
  url?: string;
}

export interface FacebookPost {
  id: string;
  message?: string;
  created_time?: string;
  permalink_url?: string;
  full_picture?: string;
  attachments?: { data: FacebookAttachment[] };
  insights?: { data: GraphInsight[] };
  /** Free summary count via `?fields=comments.summary(total_count)`. */
  comments?: { summary?: { total_count?: number } };
  reactions?: { summary?: { total_count?: number } };
}

export interface FacebookVideo {
  id: string;
  description?: string;
  source?: string;
  created_time?: string;
  permalink_url?: string;
  video_insights?: { data: GraphInsight[] };
}

/** Page Stories API row — see https://developers.facebook.com/docs/page-stories-api/. */
export interface FacebookStory {
  post_id: string;
  /** Graph returns lowercase ('published' / 'archived'); upstream casing is unstable. */
  status?: string;
  /**
   * UNIX timestamp in seconds. Graph returns it as a STRING despite the docs
   * implying numeric (verified in raw_platform_responses). Accept both.
   */
  creation_time?: string | number;
  media_type?: 'video' | 'photo' | string;
  media_id?: string;
  /** Public Facebook story URL. */
  url?: string;
}

export interface FacebookPhotoMedia {
  id: string;
  images?: Array<{ source: string; height?: number; width?: number }>;
  picture?: string;
}

export interface FacebookVideoMedia {
  id: string;
  source?: string;
  picture?: string;
}

export type AccountInsightsCounterMap = {
  impressions: number;
  reach: number;
  profileViews: number;
  totalInteractions: number;
  page_follows: number;
};

// ─── pages_read_user_content shapes ────────────────────────────────────────

export interface FacebookFromActor {
  id?: string;
  name?: string;
}

/** Row from /{page_id}/tagged — third-party post that mentions the Page. */
export interface FacebookTaggedPost extends FacebookPost {
  /** The third-party Page that authored the post. Always present on /tagged. */
  from?: FacebookFromActor;
}

/** Row from /{page_id}/ratings — public review left on the Page. */
export interface FacebookRating {
  created_time?: string;
  rating?: number | null;
  recommendation_type?: 'positive' | 'negative' | string | null;
  review_text?: string | null;
  reviewer?: FacebookFromActor;
  has_review?: boolean;
  has_rating?: boolean;
  open_graph_story?: { id?: string; permalink_url?: string };
}

/** Row from /{post_id}/comments — user-authored comment thread. */
export interface FacebookCommentRow {
  id: string;
  message?: string | null;
  created_time?: string;
  like_count?: number;
  comment_count?: number;
  parent?: { id?: string };
  from?: FacebookFromActor;
  permalink_url?: string;
}

// ─── ads_read shapes ───────────────────────────────────────────────────────

export interface FacebookAdAccount {
  id: string;
  account_id?: string;
  name?: string;
  account_status?: number;
  currency?: string;
  timezone_name?: string;
  amount_spent?: string;
  balance?: string;
  business?: { id?: string; name?: string };
}

export interface FacebookAdInsightsRow {
  date_start?: string;
  date_stop?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  cpp?: string;
  unique_clicks?: string;
  campaign_id?: string;
  campaign_name?: string;
  actions?: Array<{ action_type: string; value: string }>;
}

export interface FacebookAdCampaign {
  id: string;
  name?: string;
  objective?: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  stop_time?: string;
}

// ─── Page Public Content Access shapes ────────────────────────────────────

export interface FacebookPublicPage {
  id: string;
  name?: string;
  fan_count?: number;
  followers_count?: number;
  about?: string;
  category?: string;
  link?: string;
  verification_status?: string;
  picture?: { data?: { url?: string } };
}
