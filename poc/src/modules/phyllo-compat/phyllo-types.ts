// Wire types for the Phyllo (InsightIQ) compatibility surface. These match
// the exact JSON shapes Phyllo's /v1 API returns, verified against live
// staging payloads captured in context/phyllo-api-samples/ (2026-06-05).
//
// Rule copied from Phyllo: every field of the unified schema is ALWAYS
// present on the document, `null` when the platform doesn't provide it.
// No per-platform document shapes.

/** Naive-UTC ISO string with microseconds, e.g. "2026-06-05T11:12:04.637000". */
export type PhylloTimestamp = string;

export interface PhylloRef {
  id: string;
  name: string | null;
}

export interface PhylloAccountRef {
  id: string;
  platform_username: string | null;
  username: string | null;
}

export interface PhylloWorkPlatformRef {
  id: string;
  name: string;
  logo_url: string | null;
}

/** Common envelope present on every profile / content / audience / comment doc. */
export interface PhylloEnvelope {
  id: string;
  created_at: PhylloTimestamp;
  updated_at: PhylloTimestamp;
  user: PhylloRef;
  account: PhylloAccountRef;
  work_platform: PhylloWorkPlatformRef;
}

export interface PhylloReputation {
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

export interface PhylloEmail {
  type: string | null;
  email_id: string;
}

export interface PhylloProfile extends PhylloEnvelope {
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
  reputation: PhylloReputation;
  emails: PhylloEmail[];
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

export interface PhylloStoryNavigation {
  swipe_ups: number | null;
  tap_backs: number | null;
  tap_exits: number | null;
  swipe_backs: number | null;
  swipe_downs: number | null;
  tap_forwards: number | null;
  swipe_forwards: number | null;
  automatic_forwards: number | null;
}

export interface PhylloEngagementAdditionalInfo {
  profile_visits: number | null;
  bio_link_clicked: number | null;
  followers_gained: number | null;
  story_navigation: PhylloStoryNavigation | null;
}

export interface PhylloEngagement {
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
  additional_info: PhylloEngagementAdditionalInfo | null;
  repost_count: number | null;
}

/** {code,value} country bucket — value is a 0..100 percentage. */
export interface PhylloCountryBucket {
  code: string;
  value: number;
}
export interface PhylloCityBucket {
  name: string;
  value: number;
}
export interface PhylloGenderAgeBucket {
  gender: string;
  age_range: string;
  value: number;
}
export interface PhylloLabelBucket {
  label: string;
  value: number;
}

/**
 * Per-post viewer demographics (§4.5). Phyllo reserves the content-level
 * `audience` key but never fills it; we populate it from our per-post
 * insights. `audience_types` is our additive sub-key (no Phyllo equivalent).
 */
export interface PhylloContentAudience {
  countries: PhylloCountryBucket[];
  cities: PhylloCityBucket[];
  gender_age_distribution: PhylloGenderAgeBucket[];
  audience_types: PhylloLabelBucket[];
  /**
   * Additive split fallbacks (§4.3 note / §10.3): until the per-platform
   * normalizers keep the joint gender×age distribution, we carry the
   * separate breakdowns here so no data is lost. Consumer ignores unknown
   * keys; `gender_age_distribution` stays the Phyllo-native field.
   */
  gender_distribution: PhylloLabelBucket[];
  age_distribution: PhylloLabelBucket[];
}

/**
 * Deep per-post analytics (§4.6). Entirely our extension — Phyllo has no
 * native field. Additive namespaced object on the content document.
 */
export interface PhylloContentInsights {
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
  viewer_demographics: PhylloGenderAgeBucket[];
  sharing: Array<{ service: string; shares: number }>;
  viewer_types: PhylloLabelBucket[];
  retention_curve: Array<{ second: number; value: number }>;
  likes_timeline: Array<{ second: number; value: number }>;
  extra: Record<string, unknown>;
}

export interface PhylloContent extends PhylloEnvelope {
  engagement: PhylloEngagement;
  authors: unknown[] | null;
  audience: PhylloContentAudience | null;
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
  /** Additive (§4.6) — our deep analytics. Phyllo leaves no field here. */
  insights: PhylloContentInsights | null;
}

export interface PhylloAudience extends PhylloEnvelope {
  countries: PhylloCountryBucket[];
  cities: PhylloCityBucket[];
  gender_age_distribution: PhylloGenderAgeBucket[];
  /** Additive split fallbacks (§4.3 note / §10.3) — see PhylloContentAudience. */
  gender_distribution: PhylloLabelBucket[];
  age_distribution: PhylloLabelBucket[];
}

export interface PhylloCommentContentRef {
  id: string;
  url: string | null;
  published_at: string | null;
}

export interface PhylloComment extends PhylloEnvelope {
  text: string;
  commenter_display_name: string | null;
  commenter_id: string | null;
  commenter_username: string | null;
  commenter_profile_url: string | null;
  like_count: number | null;
  reply_count: number | null;
  external_id: string;
  content: PhylloCommentContentRef;
}

/** Standard list envelope. */
export interface PhylloListEnvelope<T> {
  data: T[];
  metadata: {
    offset: number;
    limit: number;
    from_date: string | null;
    to_date: string | null;
  };
}
