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
}

export interface ApiAudience extends ApiEnvelope {
  countries: ApiCountryBucket[];
  cities: ApiCityBucket[];
  gender_age_distribution: ApiGenderAgeBucket[];
  /** Additive split fallbacks (§4.3 note / §10.3) — see ApiContentAudience. */
  gender_distribution: ApiLabelBucket[];
  age_distribution: ApiLabelBucket[];
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
