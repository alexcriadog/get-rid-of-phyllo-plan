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
  /**
   * Phase B (IG only). All optional and platform-specific.
   *   isPublished — whether the account is published / visible.
   *   hasProfilePic — `false` for fresh accounts that haven't set an avatar.
   *   legacyInstagramUserId — pre-v2 IG ID; useful when migrating data
   *     from legacy IG Graph API integrations.
   */
  isPublished?: boolean | null;
  hasProfilePic?: boolean | null;
  legacyInstagramUserId?: string | null;
  /**
   * Optional enriched channel/page metadata. Populated by adapters that
   * surface platform-native settings (YouTube brandingSettings, status,
   * topicDetails, etc.). All optional and platform-specific.
   */
  bannerUrl?: string | null;
  keywords?: string | null;
  topicCategories?: string[] | null;
  privacyStatus?: string | null;
  longUploadsStatus?: string | null;
  madeForKids?: boolean | null;
  defaultLanguage?: string | null;
  country?: string | null;
  publishedAt?: string | null;
  hiddenSubscriberCount?: boolean | null;
  /**
   * Paid-subscriber count distinct from `followersCount`. Populated by
   * platforms where free follow and paid subscription are separate concepts
   * (Twitch today; Substack / Patreon / OnlyFans in the future). Free-follow
   * platforms (IG, YouTube, FB) leave this null and only set followersCount.
   */
  subscriberCount?: number | null;
  /**
   * Twitch tier breakdown. Keys are Twitch tier ids ('1000','2000','3000')
   * mirrored as friendlier `tier1`/`tier2`/`tier3` + `gifts` (gift subs
   * count, counted once in subscriberCount). All optional.
   */
  subscribersByTier?: {
    tier1?: number;
    tier2?: number;
    tier3?: number;
    gifts?: number;
  } | null;
  /**
   * LinkedIn 1st-degree connections (bidirectional, distinct from followers).
   * Other platforms leave this null.
   */
  connectionsCount?: number | null;
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

/**
 * Window keys IG Graph v22 accepts on `*_audience_demographics` insights.
 * Meta retired `prev_month` for these metrics starting in v20 (#100 error
 * "timeframe parameter specified prev_month is no longer supported"); only
 * `this_week` and `this_month` are valid.
 */
export type DemographicTimeframe = 'this_week' | 'this_month';

export interface DemographicDistributions {
  genderDistribution?: DistributionBucket[];
  ageDistribution?: DistributionBucket[];
  countryDistribution?: DistributionBucket[];
  cityDistribution?: DistributionBucket[];
  /**
   * Professional-graph facets (LinkedIn page-visitor demographics).
   * Optional and platform-specific.
   */
  industryDistribution?: DistributionBucket[];
  seniorityDistribution?: DistributionBucket[];
  functionDistribution?: DistributionBucket[];
  companySizeDistribution?: DistributionBucket[];
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
  // `impressions` removed — Meta retired page_impressions on
  // 2025-11-15 and rebranded the replacement as "Views". Use the
  // `views` field. Meta Ads API still has an `impressions` field
  // for paid ads — surfaced separately by facebook-extras.service.
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
  /**
   * Professional-graph facets (LinkedIn org followers). Optional and
   * platform-specific — other platforms leave them undefined.
   */
  industryDistribution?: DistributionBucket[];
  seniorityDistribution?: DistributionBucket[];
  functionDistribution?: DistributionBucket[];
  companySizeDistribution?: DistributionBucket[];
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
  /** Twitch clip — a short clipped excerpt from a VOD or live stream. */
  | 'clip'
  | 'other';

export interface ContentMetrics {
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  // `impressions` removed — Meta retired post_impressions on
  // 2025-11-15 and rebranded the replacement as "Views". Use
  // `views` field. Ads API still surfaces impressions for paid ads
  // separately (see facebook-extras.service ad_insights output).
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

/**
 * A post REFERENCED by another one (Threads quote / repost). Carries enough of
 * the referenced post to render it embedded, since the wrapping post often has
 * no text/media of its own.
 */
export interface ReferencedContent {
  platformContentId: string;
  ownerHandle: string | null;
  caption: string | null;
  permalink: string | null;
  contentType: ContentType;
  mediaUrls: string[];
  thumbnailUrl?: string | null;
  publishedAt?: Date | null;
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
  /** Tag / keyword strings the author put on the content. */
  tags?: string[] | null;
  /** YouTube videoCategoryId, IG content category, TikTok video category, etc. */
  categoryId?: string | null;
  /** Primary language declared on the content. */
  defaultLanguage?: string | null;
  /** Audio language when different from default. */
  defaultAudioLanguage?: string | null;
  /** Definition / quality marker (hd / sd, 1080p, etc.). */
  definition?: string | null;
  /** 2d / 3d (YouTube). */
  dimension?: string | null;
  /** Whether captions are available (YouTube returns "true"/"false"). */
  hasCaptions?: string | null;
  /** Whether the content is licensed material (YouTube). */
  licensedContent?: boolean | null;
  /** Publisher-declared license (creativeCommon / youtube). */
  license?: string | null;
  /** Whether the content can be embedded by third parties. */
  embeddable?: boolean | null;
  /** Whether public stats (likes/views) are visible. */
  publicStatsViewable?: boolean | null;
  /** Made for kids self-declaration. */
  madeForKids?: boolean | null;
  /** Privacy state (public / unlisted / private / scheduled). */
  privacyStatus?: string | null;
  /** Live state when applicable: none / upcoming / live. */
  liveBroadcastContent?: string | null;
  /** Upload status (uploaded / processed / failed / rejected). */
  uploadStatus?: string | null;
  /** ISO 8601 duration when the content has one (YouTube PT4M13S). */
  duration?: string | null;
  /** Topic categories / Wikipedia URLs the platform classified the content under. */
  topicCategories?: string[] | null;
  /** Recording timestamp when the content carries one. */
  recordingDate?: string | null;
  /** GPS coordinates if the content carries them. */
  recordingLocation?: {
    latitude?: number;
    longitude?: number;
    altitude?: number;
  } | null;
  /** Live broadcast window + concurrent viewers. */
  liveStreamingDetails?: {
    actualStartTime?: string | null;
    actualEndTime?: string | null;
    scheduledStartTime?: string | null;
    scheduledEndTime?: string | null;
    concurrentViewers?: string | null;
    activeLiveChatId?: string | null;
  } | null;
  /**
   * Threads quote post: the post this one QUOTES (`is_quote_post`). The
   * wrapping post frequently has no text/media of its own — render this
   * embedded so the item isn't blank.
   */
  quotedPost?: ReferencedContent | null;
  /** Threads repost (`REPOST_FACADE`): the post this one RE-SHARES. */
  repostedPost?: ReferencedContent | null;
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

/**
 * Per-content deep analytics snapshot. Cross-platform shape filled by the
 * `engagement_deep` product. Each item is one piece of content with its
 * windowed metrics and several cross-tab breakdowns. Platform adapters that
 * don't expose this surface simply don't implement `fetchEngagementDeep`.
 *
 * Conceptually distinct from `engagement_new` (Data-API-style lifetime
 * counts refreshed often) — `engagement_deep` is the Analytics layer,
 * windowed and sliced per-content, refreshed less frequently because the
 * underlying numbers move slowly.
 */
export interface EngagementDeepItem {
  contentId: string;
  /** Free-form metric bag — adapter decides which keys. Keys are camelCase. */
  metrics: Record<string, number>;
  trafficSources?: Array<{ source: string; views: number; minutes: number }>;
  countries?: Array<{ country: string; views: number; minutes: number }>;
  devices?: Array<{ deviceType: string; views: number; minutes: number }>;
  demographics?: Array<{
    ageGroup: string;
    gender: string;
    viewerPercentage: number;
  }>;
  sharing?: Array<{ service: string; shares: number }>;
}

export interface RetentionCurve {
  /** Content the curve belongs to (top viewed video in the window). */
  contentId: string;
  /** Window the curve was computed over (lookback days). */
  periodDays: number;
  /** Sorted by elapsedRatio ascending. */
  points: Array<{
    elapsedRatio: number;
    audienceWatchRatio: number;
    relativeRetentionPerformance: number;
  }>;
}

export interface EngagementDeepSnapshot {
  periodDays: number;
  items: EngagementDeepItem[];
  /** Retention curve for the top-views item, when available. */
  retention?: RetentionCurve | null;
  /** Per-call error messages when one of the batched sub-queries failed. */
  errors?: Array<{ bucket: string; message: string }>;
  fetchedAt: Date;
}

/**
 * Ads campaigns snapshot — the advertising side. Generic shape so other
 * platforms (Meta Ads, TikTok Ads) can fill it. YouTube populates this via
 * the Google Ads API (`adwords` scope).
 */
export interface AdsCustomerSummary {
  /** Customer ID with no hyphens. */
  id: string;
  /** Original resource name from the API: "customers/1234567890". */
  resourceName: string;
}

export interface AdsCampaignRow {
  campaignId: string;
  campaignName: string;
  status: string;
  channelType?: string;
  videoViews?: number;
  videoViewRate?: number | null;
  averageCpvUsd?: number | null;
  costUsd?: number;
  impressions?: number;
}

export interface AdsSnapshot {
  /** Accessible customer (advertiser) accounts the connected user can act on. */
  customers: AdsCustomerSummary[];
  /** Campaign rows fetched against the primary customer. */
  primaryCustomerId?: string | null;
  campaigns: AdsCampaignRow[];
  totalViews: number;
  totalCostUsd: number;
  /** Adapter-controlled diagnostics surfaced for the dashboard. */
  notes?: string[];
  fetchedAt: Date;
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
