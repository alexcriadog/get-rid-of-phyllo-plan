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

export interface DemographicDistributions {
  genderDistribution?: DistributionBucket[];
  ageDistribution?: DistributionBucket[];
  countryDistribution?: DistributionBucket[];
  cityDistribution?: DistributionBucket[];
  /** Per-breakdown errors when the platform refused (permissions, audience size, etc.). */
  errors?: DemographicBreakdownError[];
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
  // Daily time series (one entry per day).
  followerCountSeries?: Array<{ endTime: string; value: number }>;
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
  metrics: ContentMetrics;
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
