/**
 * Canonical types exchanged between adapters and the sync worker. Each
 * adapter maps its own platform payloads onto these shapes; callers treat
 * every platform uniformly.
 */

export interface ProfileData {
  username: string | null;
  displayName: string | null;
  biography: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
  followersCount: number | null;
  followingCount: number | null;
  postsCount: number | null;
  verified: boolean | null;
  accountType: string | null;
  website?: string | null;
  category?: string | null;
  shoppingReviewStatus?: string | null;
  fetchedAt: Date;
}

export interface DistributionBucket {
  /** Bucket label as reported by the platform, e.g. 'US', 'F.25-34'. */
  label: string;
  /** Raw count or percent, depending on `unit`. */
  value: number;
  /** 'count' or 'percent' — adapters must pick one per distribution. */
  unit: 'count' | 'percent';
}

export interface DemographicBreakdownError {
  breakdown: 'age' | 'gender' | 'country' | 'city';
  message: string;
  code?: number;
  subcode?: number;
}

/** Window keys IG Graph v22 accepts on `*_audience_demographics` insights. */
export type DemographicTimeframe = 'this_week' | 'this_month' | 'prev_month';

export interface DemographicDistributions {
  genderDistribution?: DistributionBucket[];
  ageDistribution?: DistributionBucket[];
  countryDistribution?: DistributionBucket[];
  cityDistribution?: DistributionBucket[];
  /** Per-breakdown errors when the platform refused (permissions, audience size, etc.). */
  errors?: DemographicBreakdownError[];
  /**
   * When the adapter fetches multiple Graph timeframes (Instagram does this
   * for reached/engaged demographics so the UI can pivot between them), each
   * variant lands here. Top-level fields hold a sensible default (typically
   * `prev_month` — the largest fully-accumulated window) for code paths that
   * pre-date this map.
   */
  byTimeframe?: Partial<Record<DemographicTimeframe, DemographicDistributions>>;
}

/** Common shape of `(date, value)` daily series. */
export interface DailySeriesPoint {
  endTime: string;       // YYYY-MM-DD or ISO timestamp; adapter-controlled
  value: number;
}

/** 24-bucket heatmap of when the audience is active each day. */
export interface AudienceActivityBucket {
  hour: number;          // 0..23
  count: number;
}

/**
 * 7×24 heatmap of when followers / audience are active by weekday and hour.
 * `dayOfWeek` follows JS `Date.getDay()` (0=Sunday … 6=Saturday).
 * Adapters that only return a flat hourly breakdown should leave this
 * undefined and populate the simpler `AudienceActivityBucket[]` instead.
 */
export interface AudienceActivityWeeklyBucket {
  dayOfWeek: number;     // 0..6 (0=Sun)
  hour: number;          // 0..23
  count: number;
}

/** Daily totals + time-series captured at the account level. */
export interface AccountInsightsData {
  periodDays?: number;
  // Total-value scalars (sum across the period).
  reach?: number;
  impressions?: number;
  accountsEngaged?: number;
  totalInteractions?: number;
  likes?: number;
  comments?: number;
  saves?: number;
  shares?: number;
  replies?: number;
  views?: number;
  profileViews?: number;
  websiteClicks?: number;
  emailContacts?: number;
  phoneCallClicks?: number;
  textMessageClicks?: number;
  getDirectionsClicks?: number;
  // Lifetime / aggregate-of-account scalars.
  lifetimeLikes?: number;          // total likes received across the account's lifetime
  videosCount?: number;            // total videos published lifetime
  // Daily time series (one entry per day).
  followerCountSeries?: DailySeriesPoint[];
  newFollowersSeries?: DailySeriesPoint[];
  lostFollowersSeries?: DailySeriesPoint[];
  videoViewsSeries?: DailySeriesPoint[];
  uniqueVideoViewsSeries?: DailySeriesPoint[];   // daily account-level reach
  profileViewsSeries?: DailySeriesPoint[];
  likesSeries?: DailySeriesPoint[];
  commentsSeries?: DailySeriesPoint[];
  sharesSeries?: DailySeriesPoint[];
  engagedAudienceSeries?: DailySeriesPoint[];
  // CTAs daily (sum these client-side if you want a period total).
  bioLinkClicksSeries?: DailySeriesPoint[];
  emailClicksSeries?: DailySeriesPoint[];
  phoneNumberClicksSeries?: DailySeriesPoint[];
  addressClicksSeries?: DailySeriesPoint[];
  appDownloadClicksSeries?: DailySeriesPoint[];
  leadSubmissionsSeries?: DailySeriesPoint[];
  /**
   * 24-hour activity heatmap aggregated across the period (sum per hour).
   * Useful for "best time to post" insights.
   */
  audienceActivity?: AudienceActivityBucket[];
  /**
   * 7×24 weekly activity heatmap. Same data, broken down by day of the
   * week so the UI can render a Mon-Sun × 0-23 grid (a Sunday peak is very
   * different from a Tuesday peak).
   */
  audienceActivityWeekly?: AudienceActivityWeeklyBucket[];
  // Platform-specific overflow.
  extra?: Record<string, number>;
}

export interface AudienceData {
  genderDistribution: DistributionBucket[];
  ageDistribution: DistributionBucket[];
  countryDistribution: DistributionBucket[];
  cityDistribution: DistributionBucket[];
  /** Demographics of accounts that WERE reached (wider than followers). */
  reachedDemographics?: DemographicDistributions;
  /** Demographics of accounts that engaged. */
  engagedDemographics?: DemographicDistributions;
  interests?: DistributionBucket[];
  accountInsights?: AccountInsightsData;
  fetchedAt: Date;
}

export type ContentType =
  | 'image'
  | 'video'
  | 'carousel'
  | 'reel'
  | 'story'
  | 'live'
  | 'other';

export interface ContentMetrics {
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  impressions?: number;
  reach?: number;
  views?: number;
  /** Platform-specific metrics the canonical shape doesn't cover. */
  extra?: Record<string, number>;
}

/** A `(second, percentage)` data point for retention / engagement curves. */
export interface SecondPercentage {
  second: number;        // 0..N seconds offset from start
  percentage: number;    // 0..1
}

/**
 * Per-post insight breakdowns. All fields are optional and platform-specific
 * — adapters populate only the buckets they actually have. Lives inside
 * ContentData (and therefore inside the `posts.data` doc in Mongo).
 */
export interface ContentInsights {
  /** Traffic-source distribution: For You, Search, Personal Profile, Sound, etc. */
  trafficSources?: DistributionBucket[];
  /** Retention curve — what % of viewers were still watching at each second. */
  retentionCurve?: SecondPercentage[];
  /** When viewers liked the video, by second offset. */
  likesTimeline?: SecondPercentage[];
  /** Per-post audience demographics — distinct from account-level audience. */
  audienceCountries?: DistributionBucket[];
  audienceCities?: DistributionBucket[];
  audienceGenders?: DistributionBucket[];
  /** Viewer types — NEW_VIEWER / RETURN_VIEWER / FOLLOWER / NON_FOLLOWER. */
  audienceTypes?: DistributionBucket[];
}

export interface ContentChild {
  id: string;
  mediaType: ContentType;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  permalink?: string | null;
}

export interface ContentData {
  platformContentId: string;
  contentType: ContentType;
  caption: string | null;
  permalink: string | null;
  mediaUrls: string[];
  thumbnailUrl?: string | null;
  /**
   * Platform-provided embeddable player URL. Used by the UI when the
   * platform doesn't expose a downloadable mediaUrl (TikTok BC v1.3 case)
   * — the dialog renders `<iframe src={embedUrl}>` instead of `<video>`.
   */
  embedUrl?: string | null;
  metrics: ContentMetrics;
  /** Per-post insight breakdowns when the platform exposes them. */
  insights?: ContentInsights;
  publishedAt: Date | null;
  fetchedAt: Date;
  /** Carousel children (present when contentType === 'carousel'). */
  children?: ContentChild[];
  /** Instagram media_product_type: FEED / REELS / STORY / AD. */
  mediaProductType?: string | null;
  /** Human-readable platform URL slug, e.g. IG shortcode. */
  shortcode?: string | null;
  /** True for Reels shared to the feed. */
  isSharedToFeed?: boolean | null;
  /** Poster's handle (useful when the post comes from a different owner). */
  ownerHandle?: string | null;
  /**
   * Reference (hash / object id) to the raw blob stored in Mongo
   * `raw_platform_responses`. Not the blob itself — keep canonical records
   * lightweight.
   */
  rawResponse: {
    collection: string;
    contentHash: string;
  };
}

export interface FetchOpts {
  since?: Date;
  until?: Date;
  limit?: number;
}

/**
 * Canonical comment shape exposed by adapters. Matches the typical "thread"
 * layout used across platforms: top-level comments + parentCommentId for
 * nested replies. Non-thread platforms (early Meta APIs) leave parent null.
 */
export interface CommentData {
  platformCommentId: string;
  /** Which content (post/video) this comment belongs to. */
  platformContentId: string;
  /** When this is a reply, the parent comment id. */
  parentCommentId?: string | null;
  authorHandle: string | null;
  authorDisplayName: string | null;
  text: string;
  publishedAt: Date | null;
  fetchedAt: Date;
  metrics: { likes?: number; replies?: number };
  /** Pinned to the top of the thread by the content owner. */
  pinned?: boolean;
  /** Liked by the content owner / page admin (visible signal on TikTok / IG). */
  likedByCreator?: boolean;
  /** True when the comment is by the account owner replying to a fan. */
  isOwnerReply?: boolean;
  rawResponse: {
    collection: string;
    contentHash: string;
  };
}

export type SupportState = 'supported' | 'empty_possible' | 'not_supported';

/**
 * Adapter capability declaration. Keyed by product, then by field name.
 * Example:
 *   {
 *     profile: { followersCount: 'supported', verified: 'empty_possible' },
 *     audience: { cityDistribution: 'supported' }
 *   }
 */
export type SupportMatrix = Record<string, Record<string, SupportState>>;
