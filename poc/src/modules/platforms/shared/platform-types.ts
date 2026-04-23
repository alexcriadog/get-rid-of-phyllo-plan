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

export interface AudienceData {
  genderDistribution: DistributionBucket[];
  ageDistribution: DistributionBucket[];
  countryDistribution: DistributionBucket[];
  cityDistribution: DistributionBucket[];
  interests?: DistributionBucket[];
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
