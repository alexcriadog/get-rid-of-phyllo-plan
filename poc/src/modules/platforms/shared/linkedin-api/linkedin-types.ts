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

export interface LinkedInTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}
