// Response shapes for the LinkedIn surfaces we call. Field lists kept to
// what the mappers consume — the full raw payload is archived in Mongo by
// the client anyway.

export interface LinkedInMe {
  id: string;
  localizedFirstName?: string;
  localizedLastName?: string;
  localizedHeadline?: string;
  vanityName?: string;
  profilePicture?: {
    displayImage?: string;
    'displayImage~'?: {
      elements?: Array<{
        identifiers?: Array<{ identifier?: string }>;
      }>;
    };
  };
}

export interface LinkedInConnectionsSize {
  firstDegreeSize?: number;
}

export interface LinkedInDateRange {
  start?: { year: number; month: number; day: number };
  end?: { year: number; month: number; day: number };
}

export interface LinkedInPaging {
  start?: number;
  count?: number;
  total?: number;
  links?: Array<{ rel?: string; href?: string }>;
}

export interface LinkedInCollection<T> {
  elements?: T[];
  paging?: LinkedInPaging;
}

export interface LinkedInMemberFollowersElement {
  memberFollowersCount?: number;
  dateRange?: LinkedInDateRange;
}

/** memberCreatorPostAnalytics — 202605 returns metricType as a STRING.
 * Older versions returned an object; accept both. */
export interface LinkedInMemberAnalyticsElement {
  count?: number;
  metricType?: string | Record<string, unknown>;
  dateRange?: LinkedInDateRange;
  targetEntity?: Record<string, string>;
}

export interface LinkedInOrganizationAcl {
  organization: string; // urn:li:organization:123
  role?: string;
  state?: string;
  roleAssignee?: string;
}

export interface LinkedInOrganization {
  id?: number;
  localizedName?: string;
  vanityName?: string;
  localizedDescription?: string;
  localizedWebsite?: string;
}

export interface LinkedInNetworkSize {
  firstDegreeSize?: number;
}

export interface LinkedInPost {
  id: string; // urn:li:share:... | urn:li:ugcPost:...
  author?: string;
  commentary?: string;
  createdAt?: number;
  publishedAt?: number;
  lastModifiedAt?: number;
  lifecycleState?: string;
  visibility?: string;
  content?: {
    media?: { id?: string; title?: string };
    article?: { source?: string; title?: string; thumbnail?: string };
    multiImage?: { images?: Array<{ id?: string }> };
  };
}

export interface LinkedInTotalShareStatistics {
  impressionCount?: number;
  uniqueImpressionsCount?: number;
  clickCount?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  engagement?: number;
}

export interface LinkedInShareStatsElement {
  share?: string;
  ugcPost?: string;
  organizationalEntity?: string;
  totalShareStatistics?: LinkedInTotalShareStatistics;
}

export interface LinkedInFollowerGainsElement {
  followerGains?: {
    organicFollowerGain?: number;
    paidFollowerGain?: number;
  };
  timeRange?: { start?: number; end?: number };
  organizationalEntity?: string;
}

interface LinkedInFollowerCounts {
  organicFollowerCount?: number;
  paidFollowerCount?: number;
}

/** Lifetime follower demographics (follower-statistics WITHOUT timeIntervals). */
export interface LinkedInFollowerDemographicsElement {
  followerCountsBySeniority?: Array<{
    seniority?: string; // urn:li:seniority:N
    followerCounts?: LinkedInFollowerCounts;
  }>;
  followerCountsByFunction?: Array<{
    function?: string; // urn:li:function:N
    followerCounts?: LinkedInFollowerCounts;
  }>;
  followerCountsByIndustry?: Array<{
    industry?: string; // urn:li:industry:N
    followerCounts?: LinkedInFollowerCounts;
  }>;
  followerCountsByGeoCountry?: Array<{
    geo?: string; // urn:li:geo:N
    followerCounts?: LinkedInFollowerCounts;
  }>;
  followerCountsByStaffCountRange?: Array<{
    staffCountRange?: string; // SIZE_2_TO_10 …
    followerCounts?: LinkedInFollowerCounts;
  }>;
  followerCountsByAssociationType?: Array<{
    associationType?: string | null; // EMPLOYEE | null
    followerCounts?: LinkedInFollowerCounts;
  }>;
  organizationalEntity?: string;
}

interface LinkedInPageViewsBucket {
  pageViews?: number;
  uniquePageViews?: number;
}

export interface LinkedInPageStatisticsElement {
  totalPageStatistics?: {
    views?: {
      allPageViews?: LinkedInPageViewsBucket;
      allDesktopPageViews?: LinkedInPageViewsBucket;
      allMobilePageViews?: LinkedInPageViewsBucket;
      overviewPageViews?: LinkedInPageViewsBucket;
      careersPageViews?: LinkedInPageViewsBucket;
      jobsPageViews?: LinkedInPageViewsBucket;
      lifeAtPageViews?: LinkedInPageViewsBucket;
    };
    clicks?: Record<string, unknown>;
  };
  pageStatisticsByGeoCountry?: Array<{
    geo?: string;
    pageStatistics?: {
      views?: { allPageViews?: LinkedInPageViewsBucket };
    };
  }>;
  timeRange?: { start?: number; end?: number };
  organization?: string;
}

/** Aggregate / time-bound org share statistics element. */
export interface LinkedInShareStatsAggregateElement {
  totalShareStatistics?: LinkedInTotalShareStatistics;
  timeRange?: { start?: number; end?: number };
  organizationalEntity?: string;
}

/** socialMetadata — per-reaction-type counts + comment summary. */
export interface LinkedInSocialMetadata {
  reactionSummaries?: Record<string, { count?: number }>;
  commentSummary?: { count?: number; topLevelCount?: number };
  commentsState?: string;
  entity?: string;
}

export interface LinkedInComment {
  id?: string | number;
  $URN?: string;
  commentUrn?: string;
  actor?: string; // urn:li:person|organization:...
  object?: string; // parent post urn
  message?: { text?: string };
  created?: { time?: number };
  parentComment?: string;
  likesSummary?: {
    totalLikes?: number;
    aggregatedTotalLikes?: number;
  };
}

export interface LinkedInNotification {
  action?: string; // SHARE_MENTION | COMMENT | LIKE | SHARE | ...
  organizationalEntity?: string;
  generatedActivity?: string;
  sourcePost?: string; // urn:li:share|ugcPost:...
  lastModifiedAt?: number;
}

/** Standardized-data entity (industries / functions / seniorities / geo). */
export interface LinkedInStandardizedEntity {
  localizedName?: string;
  name?: { localized?: Record<string, string> };
  defaultLocalizedName?: { value?: string };
}

/** /rest/images asset — downloadUrl expires (downloadUrlExpiresAt, epoch ms). */
export interface LinkedInImageAsset {
  downloadUrl?: string;
  downloadUrlExpiresAt?: number;
  status?: string;
}

/** /rest/videos asset. */
export interface LinkedInVideoAsset {
  downloadUrl?: string;
  thumbnail?: string;
  status?: string;
  duration?: number;
}

/** Restli BATCH_GET envelope: results keyed by (decoded) URN. */
export interface LinkedInBatchResults<T> {
  results?: Record<string, T>;
  errors?: Record<string, unknown>;
}

export interface LinkedInTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}
