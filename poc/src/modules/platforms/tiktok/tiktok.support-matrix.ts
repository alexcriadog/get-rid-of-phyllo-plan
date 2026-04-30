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
    postsCount: 'supported',             // videos_count (lifetime)
    verified: 'supported',
    accountType: 'supported',            // is_business_account → 'business' | null
    likesCount: 'supported',             // total_likes (lifetime)
  },
  audience: {
    countryDistribution: 'empty_possible',  // populated only when account ≥ 100 followers
    cityDistribution: 'empty_possible',
    genderDistribution: 'empty_possible',
    ageDistribution: 'empty_possible',
    interests: 'not_supported',
    accountInsights: 'supported',           // daily series: followers, video_views,
                                            // unique_video_views, profile_views, likes,
                                            // comments, shares, engaged_audience, CTAs;
                                            // plus 24h audience_activity heatmap and
                                            // lifetime aggregates (total_likes, videos_count).
  },
  engagement_new: {
    caption: 'supported',
    permalink: 'supported',
    mediaUrls: 'not_supported',             // v1.3 doesn't expose downloadable MP4
    thumbnailUrl: 'supported',
    embedUrl: 'supported',                  // official TikTok player URL
    likes: 'supported',
    comments: 'supported',
    shares: 'supported',
    saves: 'supported',                     // favorites
    impressions: 'not_supported',           // TikTok exposes reach but not impressions
    reach: 'supported',                     // unique viewers per video
    views: 'supported',                     // video_views
    videoDuration: 'supported',
    watchTime: 'supported',                 // total_time_watched + average_time_watched
    completionRate: 'supported',            // full_video_watched_rate
    trafficSource: 'supported',             // impression_sources
    retentionCurve: 'supported',            // video_view_retention per second
    likesTimeline: 'supported',             // engagement_likes per second
    audienceCountries: 'empty_possible',    // gated by per-video viewer threshold
    audienceCities: 'empty_possible',
    audienceGenders: 'empty_possible',
    audienceTypes: 'empty_possible',
    profileViewsFromPost: 'supported',
    newFollowersFromPost: 'supported',
    websiteClicks: 'supported',
    emailClicks: 'supported',
    phoneNumberClicks: 'supported',
    addressClicks: 'supported',
    appDownloadClicks: 'supported',
    leadSubmissions: 'supported',
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
