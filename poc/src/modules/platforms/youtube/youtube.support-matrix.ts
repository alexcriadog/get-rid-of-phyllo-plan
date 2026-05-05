// YouTube support matrix — declarative capability statement.
//
// Profile data comes from Data API v3 channels.list. Audience demographics,
// time series, geo, traffic sources, devices and monetization come from
// Analytics API v2 reports.query. Comments come from commentThreads.list.
//
// Notable gaps:
//  - cityDistribution: Analytics API only exposes country and province.
//    City-level data is Reporting-API-only.
//  - dislikes: removed from public Data API in 2021; still returned to the
//    channel owner via Analytics API metric=dislikes.
//  - audienceActivityWeekly: YouTube doesn't expose a 7×24 follower-online
//    heatmap. We could approximate via per-day series but it's not the same.

import type { SupportMatrix } from '../shared/platform-types';

export const YOUTUBE_SUPPORT_MATRIX: SupportMatrix = {
  profile: {
    username: 'supported',
    displayName: 'supported',
    biography: 'supported',
    avatarUrl: 'supported',
    profileUrl: 'supported',
    followersCount: 'supported',
    followingCount: 'not_supported',
    postsCount: 'supported',
    verified: 'not_supported',
    accountType: 'empty_possible',
    website: 'not_supported',
    category: 'empty_possible',
  },
  audience: {
    genderDistribution: 'supported',
    ageDistribution: 'supported',
    countryDistribution: 'supported',
    cityDistribution: 'not_supported',
    interests: 'not_supported',
    views: 'supported',
    likes: 'supported',
    comments: 'supported',
    shares: 'supported',
    audienceActivity: 'not_supported',
    audienceActivityWeekly: 'not_supported',
    revenue: 'empty_possible',
    cpm: 'empty_possible',
    monetizedPlaybacks: 'empty_possible',
    adImpressions: 'empty_possible',
  },
  engagement_new: {
    caption: 'supported',
    permalink: 'supported',
    mediaUrls: 'supported',
    likes: 'supported',
    comments: 'supported',
    shares: 'not_supported',
    saves: 'not_supported',
    impressions: 'not_supported',
    reach: 'not_supported',
    views: 'supported',
    duration: 'supported',
    isLive: 'supported',
    privacyStatus: 'supported',
    madeForKids: 'supported',
  },
  comments: {
    list: 'supported',
    threaded: 'supported',
    likes: 'supported',
    pinned: 'not_supported',
  },
};
