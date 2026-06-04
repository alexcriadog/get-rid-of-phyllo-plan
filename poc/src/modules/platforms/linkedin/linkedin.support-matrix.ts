// LinkedIn support matrix.
//
// Three products:
//   - identity: /v2/me (+ connections + memberFollowersCount) for members;
//     /rest/organizations + networkSizes for orgs.
//   - audience: NO demographics on either surface. Member analytics
//     aggregates + follower series land in accountInsights.
//   - engagement_new: ORG posts only. Member posts are not listable —
//     r_member_social is a closed LinkedIn permission ("not accepting
//     access requests"); member accounts return zero content items.

import type { SupportMatrix } from '../shared/platform-types';

export const LINKEDIN_SUPPORT_MATRIX: SupportMatrix = {
  profile: {
    username: 'empty_possible', // vanityName not guaranteed
    displayName: 'supported',
    biography: 'supported',
    avatarUrl: 'empty_possible',
    profileUrl: 'empty_possible',
    followersCount: 'supported',
    followingCount: 'not_supported',
    connectionsCount: 'supported', // member rows only
    postsCount: 'not_supported',
    verified: 'not_supported',
    accountType: 'supported',
    website: 'empty_possible', // org rows only
  },
  engagement_new: {
    caption: 'supported',
    permalink: 'supported',
    mediaUrls: 'not_supported', // media URN decoration is a follow-up
    likes: 'supported',
    comments: 'supported',
    shares: 'supported',
    saves: 'not_supported',
    views: 'supported', // impressionCount
    duration: 'not_supported',
    privacyStatus: 'supported',
  },
  audience: {
    genderDistribution: 'not_supported',
    ageDistribution: 'not_supported',
    countryDistribution: 'not_supported',
    cityDistribution: 'not_supported',
    interests: 'not_supported',
    audienceActivity: 'not_supported',
    audienceActivityWeekly: 'not_supported',
  },
  comments: {
    list: 'not_supported',
    threaded: 'not_supported',
    likes: 'not_supported',
    pinned: 'not_supported',
  },
  engagement_deep: {
    perVideoMetrics: 'not_supported',
    trafficSources: 'not_supported',
    countries: 'not_supported',
    devices: 'not_supported',
    demographics: 'not_supported',
    retentionCurve: 'not_supported',
  },
  ads: {
    accessibleCustomers: 'not_supported',
    videoCampaigns: 'not_supported',
    revenue: 'not_supported',
  },
};
