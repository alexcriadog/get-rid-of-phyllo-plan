// X (Twitter) support matrix — declarative capability statement.
//
// X is a LOGIN-ONLY platform: one product (identity), whose data is the
// snapshot GET /2/users/me returned during the OAuth callback. Everything
// the free X API tier can't sustain (posts, metrics, audience, comments)
// is `not_supported` here — that data reaches the consuming backend via
// scraping, outside this connector.
//
// Snapshot-backed profile fields (from user.fields at connect time):
//   username, name, description, profile_image_url, public_metrics
//   (followers/following/tweet counts), verified, created_at.
// They only change when the account reconnects — hence 'supported' but
// static between OAuths.

import type { SupportMatrix } from '../shared/platform-types';

export const TWITTER_SUPPORT_MATRIX: SupportMatrix = {
  profile: {
    username: 'supported',
    displayName: 'supported',
    biography: 'supported',
    avatarUrl: 'supported',
    profileUrl: 'supported',
    followersCount: 'supported',
    followingCount: 'supported',
    postsCount: 'supported',
    verified: 'supported',
    accountType: 'empty_possible',
    website: 'empty_possible',
    category: 'not_supported',
    subscriberCount: 'not_supported',
    subscribersByTier: 'not_supported',
    bannerUrl: 'not_supported',
    country: 'not_supported',
    publishedAt: 'supported',
    defaultLanguage: 'not_supported',
  },
  engagement_new: {
    caption: 'not_supported',
    permalink: 'not_supported',
    mediaUrls: 'not_supported',
    likes: 'not_supported',
    comments: 'not_supported',
    shares: 'not_supported',
    saves: 'not_supported',
    views: 'not_supported',
    duration: 'not_supported',
    isLive: 'not_supported',
    privacyStatus: 'not_supported',
    defaultLanguage: 'not_supported',
    categoryId: 'not_supported',
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
