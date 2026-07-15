// Twitch support matrix — declarative capability statement.
//
// Twitch ships TWO products today:
//   - identity: Helix /users + /channels + /channels/followers + /subscriptions
//     (paid-sub count + tier breakdown lives inside the ProfileData snapshot
//     because demographics aren't exposed by Helix).
//   - engagement_new: VODs (/videos?type=archive) and clips (/clips) with
//     view_count, duration, language, muted_segments, vod_offset, game.
//
// Notable gaps that show up as `not_supported`:
//   - audience demographics (age/gender/geo): Helix doesn't expose them. The
//     numeric audience signals we DO have (followers, subs) are surfaced in
//     `identity` instead.
//   - engagement_deep: no per-VOD Analytics API equivalent to YouTube.
//   - comments: chat is IRC / EventSub, no historical Helix endpoint.
//   - ads: schedule only (no revenue $) — intentionally not integrated.
//   - mentions, stories, ratings: concept doesn't exist on Twitch.

import type { SupportMatrix } from '../shared/platform-types';

export const TWITCH_SUPPORT_MATRIX: SupportMatrix = {
  profile: {
    username: 'supported',
    displayName: 'supported',
    biography: 'supported',
    avatarUrl: 'supported',
    profileUrl: 'supported',
    followersCount: 'supported',
    followingCount: 'not_supported',
    postsCount: 'not_supported',
    verified: 'not_supported',
    // empty_possible: broadcaster_type is "" for regular channels — only
    // affiliate/partner tiers carry a value.
    accountType: 'empty_possible',
    website: 'not_supported',
    category: 'not_supported',
    subscriberCount: 'supported',
    subscribersByTier: 'supported',
    bannerUrl: 'empty_possible',
    country: 'not_supported',
    publishedAt: 'supported',
    defaultLanguage: 'empty_possible',
  },
  engagement_new: {
    caption: 'supported',
    permalink: 'supported',
    mediaUrls: 'supported',
    likes: 'not_supported',
    comments: 'not_supported',
    shares: 'not_supported',
    saves: 'not_supported',
    views: 'supported',
    duration: 'supported',
    isLive: 'not_supported',
    privacyStatus: 'supported',
    defaultLanguage: 'supported',
    categoryId: 'supported',
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
