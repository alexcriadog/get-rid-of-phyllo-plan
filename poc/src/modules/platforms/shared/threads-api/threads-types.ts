// Threads API JSON shapes (graph.threads.net v1.0).
// Reference: https://developers.facebook.com/docs/threads/threads-objects

/**
 * Profile fields exposed by `GET /me` (and `/{user_id}`). The exact subset
 * we request is configured in the profile fetcher's `fields=` query param.
 */
export interface ThreadsUser {
  id: string;
  username?: string;
  name?: string;
  threads_profile_picture_url?: string;
  threads_biography?: string;
  is_verified?: boolean;
  // Account-level metric returned via /threads_insights — surfaced on the
  // profile object too in some shapes.
  followers_count?: number;
}

export type ThreadsMediaType =
  | 'TEXT_POST'
  | 'IMAGE'
  | 'VIDEO'
  | 'CAROUSEL_ALBUM'
  | 'REPOST_FACADE'
  | 'AUDIO';

/**
 * Location tagged on a post. The `location{...}` field is an EDGE — the wire
 * shape is `{ data: [ThreadsLocation] }`, not a plain object (verified live
 * 2026-07-10 on a Miami-tagged post). Changelog 2025-05-27.
 */
export interface ThreadsLocation {
  id: string;
  name?: string;
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  postal_code?: string;
}

/** Poll attachment (changelog 2025-04-14; `total_votes` added 2025-08-12). */
export interface ThreadsPollAttachment {
  option_a?: string;
  option_b?: string;
  option_c?: string;
  option_d?: string;
  option_a_votes_percentage?: number;
  option_b_votes_percentage?: number;
  option_c_votes_percentage?: number;
  option_d_votes_percentage?: number;
  expiration_timestamp?: string;
  total_votes?: number;
}

/**
 * One post returned by `GET /me/threads` or `GET /{thread_id}`.
 */
export interface ThreadsPost {
  id: string;
  media_product_type?: 'THREADS';
  media_type?: ThreadsMediaType;
  text?: string;
  permalink?: string;
  timestamp?: string; // ISO 8601 UTC
  shortcode?: string;
  thumbnail_url?: string;
  media_url?: string;
  owner?: { id: string };
  username?: string;
  is_quote_post?: boolean;
  /** The post this one QUOTES (present when is_quote_post). Requested as a
   *  nested `quoted_post{...}` field; carries the referenced post's content. */
  quoted_post?: ThreadsPost;
  /** The post this one RE-SHARES (media_type REPOST_FACADE). */
  reposted_post?: ThreadsPost;
  has_replies?: boolean;
  reply_audience?: 'EVERYONE' | 'ACCOUNTS_YOU_FOLLOW' | 'MENTIONED_ONLY';
  alt_text?: string;
  /** Carousel children. */
  children?: { data: ThreadsPost[] };
  /** Topic tag shown in the post header (changelog 2025-07-21). */
  topic_tag?: string;
  /** URL attached to a link post. */
  link_attachment_url?: string;
  /** GIF attached to the post (changelog 2025-02-13). */
  gif_url?: string;
  /** Media blurred as a spoiler until tapped. */
  is_spoiler_media?: boolean;
  /** Location tag edge — see ThreadsLocation for the `{ data: [...] }` shape. */
  location?: { data?: ThreadsLocation[] };
  location_id?: string;
  poll_attachment?: ThreadsPollAttachment;
  /** Rich-text spans (mentions/links/tags). Undocumented shape — archived raw. */
  text_entities?: unknown;
  text_attachment?: unknown;
  /** Disappearing ("ghost") post state + expiry, when the feature applies. */
  ghost_post_status?: string;
  ghost_post_expiration_timestamp?: string;
  /** Numerator for views/likes/etc. when expanded inline. */
  views?: number;
  likes?: number;
  replies?: number;
  reposts?: number;
  quotes?: number;
  shares?: number;
  clicks?: number;
}

/**
 * Reply object from `GET /{thread_id}/replies`. Same shape as a post plus a
 * couple of reply-specific fields.
 */
export interface ThreadsReply extends ThreadsPost {
  root_post?: { id: string };
  replied_to?: { id: string };
  hide_status?:
    | 'NOT_HUSHED'
    | 'UNHUSHED'
    | 'HIDDEN'
    | 'COVERED'
    | 'BLOCKED'
    | 'RESTRICTED';
  /** True when the reply is by the post owner replying to a fan. */
  is_reply_owned_by_me?: boolean;
}

/**
 * One row of an insight call. Per-post insights and account insights both
 * use this envelope; the worker reads either `total_value.value` or the
 * time series under `values[]`.
 */
export interface ThreadsInsight {
  name: string;
  period?: 'lifetime' | 'day';
  title?: string;
  description?: string;
  total_value?: { value: number };
  values?: Array<{ value: number; end_time?: string }>;
}

export interface ThreadsApiPaging {
  cursors?: { before?: string; after?: string };
  next?: string;
  previous?: string;
}

/**
 * Generic envelope. Some endpoints return `{data: T}` (single object), some
 * return `{data: T[], paging}`. We type both via call-site overloads.
 */
export interface ThreadsApiResponse<T> {
  data: T;
  paging?: ThreadsApiPaging;
}

/**
 * Graph-style error body. Threads uses the same shape as Facebook Graph,
 * so we can reuse the AdapterFetchError mapping logic.
 */
export interface ThreadsApiError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

/**
 * Mention object from `GET /me/mentioned_threads`.
 */
export interface ThreadsMention extends ThreadsPost {
  /** The thread author who mentioned us. */
  from?: { id: string; username?: string };
}
