// Facebook Graph API response shapes. Phase C — extracted from
// facebook.adapter.ts inline interfaces so fetchers and mappers can
// import them without forming a circular dependency through the adapter.

import type { GraphInsight } from '../shared/meta-graph';

export interface FacebookAttachment {
  media_type?: string;
  media?: { image?: { src?: string }; source?: string };
  subattachments?: { data: FacebookAttachment[] };
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
