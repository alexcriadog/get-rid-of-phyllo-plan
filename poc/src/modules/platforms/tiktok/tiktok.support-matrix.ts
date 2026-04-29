// TikTok support matrix. Verified live against business-api.tiktok.com/v1.3
// on 2026-04-29. Field-level capabilities reflect what the API actually
// returns with the granted Business-tier account-holder OAuth scopes.

import type { SupportMatrix } from '../shared/platform-types';

export const TIKTOK_SUPPORT_MATRIX: SupportMatrix = {
  profile: {
    username: 'supported',
    displayName: 'supported',
    biography: 'supported',
    avatarUrl: 'supported',
    followersCount: 'supported',
    followingCount: 'supported',
    postsCount: 'not_supported',         // /business/get/ rejects video_count
    verified: 'supported',
    accountType: 'not_supported',
    likesCount: 'not_supported',         // /business/get/ rejects likes_count
  },
  audience: {
    countryDistribution: 'empty_possible',  // populated only when account ≥ 100 followers
    genderDistribution: 'empty_possible',
    ageDistribution: 'not_supported',       // /business/get/ rejects audience_age_groups
    cityDistribution: 'not_supported',
    interests: 'not_supported',
    accountInsights: 'supported',           // engaged_audience + followers_count daily series
  },
  engagement_new: {
    caption: 'supported',
    permalink: 'supported',
    mediaUrls: 'not_supported',             // /business/video/list/ rejects full_video_url
    thumbnailUrl: 'supported',
    likes: 'supported',
    comments: 'supported',
    shares: 'supported',
    saves: 'not_supported',
    impressions: 'not_supported',
    reach: 'not_supported',                 // /business/video/list/ rejects reach
    views: 'supported',                     // video_views
    videoDuration: 'supported',
    watchTime: 'not_supported',             // No /business/video/get/ endpoint in v1.3
    completionRate: 'not_supported',
    trafficSource: 'not_supported',
  },
  comments: {
    text: 'supported',
    publishedAt: 'supported',
    likeCount: 'supported',
    replyCount: 'supported',
    pinned: 'supported',
    likedByCreator: 'supported',
  },
  mentions: {
    // PROBE PENDING — /business/mention/list/ returns code=40006 "no schema found".
    // Endpoint exists at the path level but its expected request shape
    // differs from the standard pattern. To be probed when we have a video
    // that's actually been mentioned.
  },
  stories: {
    // TikTok has no story concept; the entire product is unsupported.
  },
};
