// LinkedIn support matrix.
//
// Five products:
//   - identity: /v2/me (+ connections + memberFollowersCount) for members;
//     /rest/organizations + networkSizes for orgs.
//   - audience: org accounts get follower demographics (country/industry/
//     seniority/function/companySize), page-view stats and org-level daily
//     engagement series; members get analytics aggregates + follower series
//     in accountInsights (LinkedIn exposes no member demographics).
//   - engagement_new: ORG posts only (+ per-reaction-type breakdown via
//     socialMetadata). Member posts are not listable — r_member_social is a
//     closed LinkedIn permission; member accounts return zero content items.
//   - comments: org post comment threads (actor URNs, no display names).
//   - mentions: posts by others that @-mention the org (notifications API).

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
    // empty_possible: media URLs resolve for image/article posts; present on
    // multi-image posts as media_urls (verified live 23/112 as of 2026-07).
    mediaUrls: 'empty_possible',
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
    countryDistribution: 'supported', // org rows only (follower geo)
    cityDistribution: 'not_supported',
    industryDistribution: 'supported', // org rows only
    seniorityDistribution: 'supported', // org rows only
    functionDistribution: 'supported', // org rows only
    companySizeDistribution: 'supported', // org rows only
    interests: 'not_supported',
    audienceActivity: 'not_supported',
    audienceActivityWeekly: 'not_supported',
  },
  comments: {
    list: 'supported', // org rows only
    threaded: 'supported',
    likes: 'supported',
    pinned: 'not_supported',
  },
  mentions: {
    list: 'supported', // org rows only — SHARE_MENTION notifications (60d)
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
