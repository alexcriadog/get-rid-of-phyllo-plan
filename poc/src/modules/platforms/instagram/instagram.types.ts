// Instagram Graph API response shapes. Phase E.

export interface GraphMediaChild {
  id: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
}

export interface GraphMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
  is_shared_to_feed?: boolean;
  is_comment_enabled?: boolean;
  alt_text?: string | null;
  media_product_type?: string;
  shortcode?: string;
  owner?: { id: string; username?: string };
  collaborators?: { data?: Array<{ id: string; username?: string }> };
  children?: { data: GraphMediaChild[] };
  // Phase B.2 — probe-confirmed against Camaleonic on Graph v22.
  // Optional because Meta omits / returns null when not applicable
  // (e.g. boost_ads_list when no ad boost; total_views_count on
  // image carousels). All ride free on the existing /media call.
  shares_count?: number;
  reposts_count?: number;
  saved_count?: number;
  total_like_count?: number;
  total_comments_count?: number;
  total_views_count?: number;
  boost_ads_list?: unknown[];
  boost_eligibility_info?: { eligible_to_boost?: boolean; reason?: string };
  legacy_instagram_media_id?: string;
}
