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
}
