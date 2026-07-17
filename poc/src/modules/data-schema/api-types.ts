// Wire types for the InsightIQ (InsightIQ) compatibility surface. These match
// the exact JSON shapes InsightIQ's /v1 API returns, verified against live
// staging payloads captured in context/api-samples/ (2026-06-05).
//
// Rule copied from InsightIQ: every field of the unified schema is ALWAYS
// present on the document, `null` when the platform doesn't provide it.
// No per-platform document shapes.

/** Naive-UTC ISO string with microseconds, e.g. "2026-06-05T11:12:04.637000". */
export type ApiTimestamp = string;

export interface ApiRef {
  id: string;
  name: string | null;
}

export interface ApiAccountRef {
  id: string;
  platform_username: string | null;
  username: string | null;
}

export interface ApiWorkPlatformRef {
  id: string;
  name: string;
  logo_url: string | null;
}

/** Common envelope present on every profile / content / audience / comment doc. */
export interface ApiEnvelope {
  id: string;
  created_at: ApiTimestamp;
  updated_at: ApiTimestamp;
  user: ApiRef;
  account: ApiAccountRef;
  work_platform: ApiWorkPlatformRef;
}

export interface ApiReputation {
  follower_count: number | null;
  following_count: number | null;
  subscriber_count: number | null;
  paid_subscriber_count: number | null;
  content_count: number | null;
  content_group_count: number | null;
  watch_time_in_hours: number | null;
  average_open_rate: number | null;
  average_click_rate: number | null;
  like_count: number | null;
  connection_count: number | null;
}

export interface ApiEmail {
  type: string | null;
  email_id: string;
}

export interface ApiProfile extends ApiEnvelope {
  username: string | null;
  platform_username: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  nick_name: string | null;
  url: string | null;
  introduction: string | null;
  image_url: string | null;
  date_of_birth: string | null;
  external_id: string | null;
  platform_account_type: string | null;
  category: string | null;
  website: string | null;
  reputation: ApiReputation;
  emails: ApiEmail[];
  phone_numbers: unknown[];
  addresses: unknown[];
  gender: string | null;
  country: string | null;
  platform_profile_name: string | null;
  platform_profile_id: string | null;
  platform_profile_published_at: string | null;
  is_verified: boolean | null;
  is_business: boolean | null;
  work_experiences: unknown[] | null;
  education: unknown[] | null;
  publications: unknown[] | null;
  certifications: unknown[] | null;
  volunteer_experiences: unknown[] | null;
  honors: unknown[] | null;
  projects: unknown[] | null;
}

export interface ApiStoryNavigation {
  swipe_ups: number | null;
  tap_backs: number | null;
  tap_exits: number | null;
  swipe_backs: number | null;
  swipe_downs: number | null;
  tap_forwards: number | null;
  swipe_forwards: number | null;
  automatic_forwards: number | null;
}

export interface ApiEngagementAdditionalInfo {
  profile_visits: number | null;
  bio_link_clicked: number | null;
  followers_gained: number | null;
  story_navigation: ApiStoryNavigation | null;
  /**
   * Superset extras (not in InsightIQ's contract — consumers that don't know
   * them ignore them). total_interactions: Meta's aggregate interactions
   * metric. reels_skip_rate: % of viewers who skipped the reel (0-100).
   * completion_rate: TikTok full-video-watched rate (as reported by TikTok).
   * story_replies / sticker_interactions / unique_media_views: FB story
   * per-media metrics.
   */
  total_interactions?: number | null;
  reels_skip_rate?: number | null;
  completion_rate?: number | null;
  story_replies?: number | null;
  sticker_interactions?: number | null;
  unique_media_views?: number | null;
  /**
   * Facebook per-reaction breakdown ({ like, love, wow, haha, sad, angry,
   * care } — only reactions with a count). Additive, only-when-present.
   */
  reactions_breakdown?: Record<string, number> | null;
}

export interface ApiEngagement {
  like_count: number | null;
  dislike_count: number | null;
  comment_count: number | null;
  impression_organic_count: number | null;
  reach_organic_count: number | null;
  save_count: number | null;
  view_count: number | null;
  replay_count: number | null;
  watch_time_in_hours: number | null;
  avg_watch_time_in_sec: number | null;
  share_count: number | null;
  impression_paid_count: number | null;
  reach_paid_count: number | null;
  email_open_rate: number | null;
  email_click_rate: number | null;
  unsubscribe_count: number | null;
  spam_report_count: number | null;
  click_count: number | null;
  additional_info: ApiEngagementAdditionalInfo | null;
  repost_count: number | null;
}

/** {code,value} country bucket — value is a 0..100 percentage. */
export interface ApiCountryBucket {
  code: string;
  value: number;
}
export interface ApiCityBucket {
  name: string;
  value: number;
}
export interface ApiGenderAgeBucket {
  gender: string;
  age_range: string;
  value: number;
}
export interface ApiLabelBucket {
  label: string;
  value: number;
}

/**
 * Per-post viewer demographics (§4.5). InsightIQ reserves the content-level
 * `audience` key but never fills it; we populate it from our per-post
 * insights. `audience_types` is our additive sub-key (no InsightIQ equivalent).
 */
export interface ApiContentAudience {
  countries: ApiCountryBucket[];
  cities: ApiCityBucket[];
  gender_age_distribution: ApiGenderAgeBucket[];
  audience_types: ApiLabelBucket[];
  /**
   * Additive split fallbacks (§4.3 note / §10.3): until the per-platform
   * normalizers keep the joint gender×age distribution, we carry the
   * separate breakdowns here so no data is lost. Consumer ignores unknown
   * keys; `gender_age_distribution` stays the InsightIQ-native field.
   */
  gender_distribution: ApiLabelBucket[];
  age_distribution: ApiLabelBucket[];
}

/**
 * Deep per-post analytics (§4.6). Entirely our extension — InsightIQ has no
 * native field. Additive namespaced object on the content document.
 */
export interface ApiContentInsights {
  traffic_sources: Array<{
    source: string;
    views: number | null;
    minutes: number | null;
    value: number | null;
  }>;
  devices: Array<{
    device_type: string;
    views: number | null;
    minutes: number | null;
  }>;
  audience_retention: Array<{
    elapsed_ratio: number;
    watch_ratio: number;
    relative_performance: number | null;
  }>;
  viewer_demographics: ApiGenderAgeBucket[];
  sharing: Array<{ service: string; shares: number }>;
  viewer_types: ApiLabelBucket[];
  retention_curve: Array<{ second: number; value: number }>;
  likes_timeline: Array<{ second: number; value: number }>;
  extra: Record<string, unknown>;
}

/** Additive — a Threads quote/repost's referenced post, enough to render it
 *  embedded (the wrapping post often has no text/media of its own). */
export interface ApiReferencedContent {
  external_id: string;
  url: string | null;
  description: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  type: string | null;
  format: string | null;
  platform_profile_name: string | null;
  published_at: string | null;
}

export interface ApiContent extends ApiEnvelope {
  engagement: ApiEngagement;
  authors: unknown[] | null;
  audience: ApiContentAudience | null;
  platform: unknown | null;
  external_id: string;
  title: string | null;
  format: string | null;
  type: string | null;
  url: string | null;
  media_url: string | null;
  duration: number | null;
  description: string | null;
  visibility: string | null;
  thumbnail_url: string | null;
  persistent_thumbnail_url: string | null;
  published_at: string | null;
  platform_profile_id: string | null;
  platform_profile_name: string | null;
  sponsored: unknown | null;
  collaboration: unknown | null;
  is_owned_by_platform_user: boolean | null;
  hashtags: string[] | null;
  content_tags: string[] | null;
  mentions: string[] | null;
  media_urls: string[];
  /** Additive (§4.6) — our deep analytics. InsightIQ leaves no field here. */
  insights: ApiContentInsights | null;
  /** Additive — Threads quote post: the post this one QUOTES (embeddable). */
  quoted_post?: ApiReferencedContent | null;
  /** Additive — Threads repost: the post this one RE-SHARES. */
  reposted_post?: ApiReferencedContent | null;
  /** Additive — Threads topic tag shown in the post header. */
  topic_tag?: string | null;
  /** Additive — Threads tagged location (coordinates when exposed). */
  location?: ApiContentLocation | null;
  /** Additive — accessibility alt text on the post media. */
  alt_text?: string | null;
  /** Additive — Threads URL attached to a link post. */
  link_attachment_url?: string | null;
  /** Additive — Threads attached GIF URL. */
  gif_url?: string | null;
  /** Additive — Threads media blurred as a spoiler until tapped. */
  is_spoiler_media?: boolean | null;
  /** Additive — Threads poll (options + vote percentages 0-100). */
  poll?: ApiContentPoll | null;
  /**
   * Additive, only-when-present — author handle when the item was authored
   * by someone other than the connected account (mentions product). Own
   * posts omit it.
   */
  owner_username?: string;
  /**
   * Max-capture additive keys (all platforms — see
   * docs/max-capture-all-platforms.md). Same contract as the Threads keys
   * above: present ONLY when the platform exposed the datum, so existing
   * docs keep their exact shape and consumers that don't know a key ignore
   * it. One concept = one key across platforms.
   */
  /** Additive — title of an attached link/article (LinkedIn, Facebook). */
  link_attachment_title?: string | null;
  /** Additive — product surface: FEED/REELS/STORY (IG), status_type (FB),
   *  VIDEO/SHORTS (YouTube), ARCHIVE/HIGHLIGHT/UPLOAD/CLIP (Twitch). */
  media_product_type?: string | null;
  /** Additive — official embeddable player URL (TikTok, YouTube, Twitch). */
  embed_url?: string | null;
  /** Additive — YouTube videoCategoryId / Twitch clip game_id. */
  category_id?: string | null;
  /** Additive — content language (YouTube, Twitch). */
  default_language?: string | null;
  /** Additive — audio language when distinct (YouTube). */
  default_audio_language?: string | null;
  /** Additive — upload/lifecycle state (YouTube uploadStatus, LinkedIn
   *  lifecycleState). */
  upload_status?: string | null;
  /** Additive — whether comments are open (Instagram). */
  is_comment_enabled?: boolean | null;
  /** Additive — Reel shared to the feed (Instagram). */
  is_shared_to_feed?: boolean | null;
  /** Additive — hd/sd (YouTube). */
  definition?: string | null;
  /** Additive — 2d/3d (YouTube). */
  dimension?: string | null;
  /** Additive — captions available (YouTube). */
  has_captions?: boolean | null;
  /** Additive — licensed content flag (YouTube). */
  licensed_content?: boolean | null;
  /** Additive — youtube / creativeCommon (YouTube). */
  license?: string | null;
  /** Additive — third-party embeds allowed (YouTube). */
  embeddable?: boolean | null;
  /** Additive — public like/view counters visible (YouTube). */
  public_stats_viewable?: boolean | null;
  /** Additive — made-for-kids self declaration (YouTube). */
  made_for_kids?: boolean | null;
  /** Additive — none/upcoming/live (YouTube; Twitch emits 'none'). */
  live_broadcast_content?: string | null;
  /** Additive — topic category URLs (YouTube). */
  topic_categories?: string[] | null;
  /** Additive — recording timestamp (YouTube). */
  recording_date?: string | null;
  /** Additive — recording GPS (YouTube). Distinct from `location`
   *  (a user-TAGGED place with id/name). */
  recording_location?: {
    latitude: number | null;
    longitude: number | null;
    altitude: number | null;
  } | null;
  /** Additive — live window + concurrent viewers (YouTube). */
  live_streaming_details?: {
    actual_start_time: string | null;
    actual_end_time: string | null;
    scheduled_start_time: string | null;
    scheduled_end_time: string | null;
    concurrent_viewers: number | null;
  } | null;
  /** Additive — Twitch clip featured flag. */
  is_featured?: boolean | null;
  /** Additive — Twitch clip's source VOD id. */
  source_video_id?: string | null;
}

/** Additive — location tagged on a post (Threads location tagging). */
export interface ApiContentLocation {
  id: string;
  name: string | null;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  postal_code: string | null;
}

/** Additive — poll attached to a post (Threads). */
export interface ApiContentPoll {
  options: Array<{ label: string; votes_percentage: number | null }>;
  expires_at: string | null;
  total_votes: number | null;
}

/** Additive — why a demographic breakdown came back empty (Graph/API error). */
export interface ApiDemographicError {
  breakdown: 'age' | 'gender' | 'country' | 'city';
  message: string;
  code?: number;
  subcode?: number;
}

/**
 * Additive — one demographic scope (reached / engaged). Same bucket shapes as
 * the follower-level fields on ApiAudience, but every field is optional: a
 * platform may expose only some breakdowns, and `errors` explains the rest.
 */
export interface ApiAudienceDemographics {
  countries?: ApiCountryBucket[];
  cities?: ApiCityBucket[];
  gender_age_distribution?: ApiGenderAgeBucket[];
  gender_distribution?: ApiLabelBucket[];
  age_distribution?: ApiLabelBucket[];
  /**
   * Professional-graph facets. LinkedIn fills these for page VISITORS (its
   * reached scope), which is often all it returns — without them a
   * visitor-industry-only response would map to an empty scope and vanish.
   */
  industry_distribution?: ApiLabelBucket[];
  seniority_distribution?: ApiLabelBucket[];
  function_distribution?: ApiLabelBucket[];
  company_size_distribution?: ApiLabelBucket[];
  errors?: ApiDemographicError[];
  /**
   * Per-window variants. Instagram fetches reached/engaged demographics for
   * each Graph window it still accepts (`this_week`, `this_month`); the
   * top-level fields carry the best-populated one.
   */
  by_timeframe?: Record<string, ApiAudienceDemographics>;
}

/** Additive — one point of a daily series. */
export interface ApiDailySeriesPoint {
  end_time: string;
  value: number;
}

/** Additive — account-level metrics captured alongside the demographics. */
export interface ApiAudienceAccountInsights {
  period_days?: number;
  reach?: number;
  accounts_engaged?: number;
  total_interactions?: number;
  likes?: number;
  comments?: number;
  saves?: number;
  shares?: number;
  replies?: number;
  views?: number;
  profile_views?: number;
  website_clicks?: number;
  email_contacts?: number;
  phone_call_clicks?: number;
  text_message_clicks?: number;
  get_directions_clicks?: number;
  lifetime_likes?: number;
  videos_count?: number;
  follower_count_series?: ApiDailySeriesPoint[];
  new_followers_series?: ApiDailySeriesPoint[];
  lost_followers_series?: ApiDailySeriesPoint[];
  video_views_series?: ApiDailySeriesPoint[];
  unique_video_views_series?: ApiDailySeriesPoint[];
  profile_views_series?: ApiDailySeriesPoint[];
  likes_series?: ApiDailySeriesPoint[];
  comments_series?: ApiDailySeriesPoint[];
  shares_series?: ApiDailySeriesPoint[];
  engaged_audience_series?: ApiDailySeriesPoint[];
  bio_link_clicks_series?: ApiDailySeriesPoint[];
  email_clicks_series?: ApiDailySeriesPoint[];
  phone_number_clicks_series?: ApiDailySeriesPoint[];
  address_clicks_series?: ApiDailySeriesPoint[];
  app_download_clicks_series?: ApiDailySeriesPoint[];
  lead_submissions_series?: ApiDailySeriesPoint[];
  /** 24-bucket "when is the audience online" histogram. */
  audience_activity?: Array<{ hour: number; count: number }>;
  /** 7×24 grid of the same signal; day_of_week follows JS getDay() (0=Sun). */
  audience_activity_weekly?: Array<{
    day_of_week: number;
    hour: number;
    count: number;
  }>;
  /** Platform-specific overflow (already snake_case at the source). */
  extra?: Record<string, number>;
}

export interface ApiAudience extends ApiEnvelope {
  countries: ApiCountryBucket[];
  cities: ApiCityBucket[];
  gender_age_distribution: ApiGenderAgeBucket[];
  /** Additive split fallbacks (§4.3 note / §10.3) — see ApiContentAudience. */
  gender_distribution: ApiLabelBucket[];
  age_distribution: ApiLabelBucket[];
  /**
   * Additive, only-when-present — why the follower breakdowns above are empty
   * (e.g. TikTok's 100-follower gate). Separate from reached_demographics so a
   * platform without a reached scope doesn't have to invent one to explain
   * itself.
   */
  follower_demographics_errors?: ApiDemographicError[];
  /**
   * Additive, only-when-present — scopes WIDER than followers. Instagram
   * derives these over a rolling window (12 Graph calls); other platforms
   * populate only `errors` to explain a refusal. Audiences synced before
   * 2026-07-17 lack these until their next refresh.
   */
  reached_demographics?: ApiAudienceDemographics;
  engaged_demographics?: ApiAudienceDemographics;
  /** Additive, only-when-present — account-level totals + daily series. */
  account_insights?: ApiAudienceAccountInsights;
  /**
   * Additive, only-when-present — professional-graph facets (LinkedIn org
   * followers). Other platforms leave them absent.
   */
  industry_distribution?: ApiLabelBucket[];
  seniority_distribution?: ApiLabelBucket[];
  function_distribution?: ApiLabelBucket[];
  company_size_distribution?: ApiLabelBucket[];
}

export interface ApiCommentContentRef {
  id: string;
  url: string | null;
  published_at: string | null;
}

export interface ApiComment extends ApiEnvelope {
  text: string;
  commenter_display_name: string | null;
  commenter_id: string | null;
  commenter_username: string | null;
  commenter_profile_url: string | null;
  like_count: number | null;
  reply_count: number | null;
  external_id: string;
  content: ApiCommentContentRef;
  /**
   * Additive, only-when-present — comment metadata InsightIQ's shape drops
   * but our UI needs (threading, publish time, owner signals). Comments
   * synced before 2026-07-15 lack these until their next refresh.
   */
  published_at?: string | null;
  parent_comment_id?: string;
  pinned?: boolean;
  liked_by_creator?: boolean;
  is_owner_reply?: boolean;
}

/** Standard list envelope. */
export interface ApiListEnvelope<T> {
  data: T[];
  metadata: {
    offset: number;
    limit: number;
    from_date: string | null;
    to_date: string | null;
  };
}
