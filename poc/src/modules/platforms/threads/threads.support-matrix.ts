// Threads support matrix — declarative capability statement.
//
// Source of truth: developers.facebook.com/docs/threads/threads-objects +
// /threads-insights. Follower demographics (country/city/age/gender) DO
// exist via metric=follower_demographics but only for profiles with 100+
// followers — below that Threads rejects the call (#801/4279032), so the
// distributions are declared empty_possible, not supported. The richest
// product is engagement_new (per-post views/likes/replies/reposts/quotes/
// shares/clicks via /{thread_id}/insights).

import type { SupportMatrix } from '../shared/platform-types';

export const THREADS_SUPPORT_MATRIX: SupportMatrix = {
  profile: {
    name: 'supported',                  // `name`
    username: 'supported',              // `username`
    biography: 'supported',             // `threads_biography`
    avatarUrl: 'supported',             // `threads_profile_picture_url`
    profileUrl: 'empty_possible',       // not in /me; reconstructed as https://www.threads.net/@<username>
    fanCount: 'not_supported',
    followersCount: 'supported',        // via /me/threads_insights metric=followers_count
    link: 'empty_possible',
    verified: 'supported',              // `is_verified`
  },
  audience: {
    // follower_demographics buckets — fetched with breakdown country/city/
    // age/gender, but Threads gates the metric behind 100+ followers, so
    // small accounts legitimately come back empty.
    countryDistribution: 'empty_possible',
    cityDistribution: 'empty_possible',
    genderDistribution: 'empty_possible',
    ageDistribution: 'empty_possible',
    interests: 'not_supported',
    // Lifetime account-level scalars — `views`, `likes`, `replies`, `reposts`,
    // `quotes`, `followers_count` via /me/threads_insights.
    views: 'supported',
    likes: 'supported',
    replies: 'supported',
    reposts: 'supported',
    quotes: 'supported',
    followers: 'supported',
  },
  engagement_new: {
    caption: 'supported',               // `text`
    permalink: 'supported',
    mediaUrls: 'supported',             // `media_url` / carousel children
    likes: 'supported',                 // /{id}/insights metric=likes
    comments: 'supported',              // metric=replies (Threads' "comments")
    shares: 'supported',                // metric=reposts
    saves: 'not_supported',
    quotes: 'supported',                // metric=quotes
    impressions: 'not_supported',       // Threads exposes views, not impressions
    reach: 'not_supported',
    views: 'supported',                 // metric=views
  },
  comments: {
    // Threads "replies" are the comments product. /{thread_id}/replies.
    list: 'supported',
    threaded: 'supported',
    likes: 'supported',
    pinned: 'not_supported',
  },
  mentions: {
    // /me/mentioned_threads — all threads from any author that @-mention us.
    list: 'supported',
    metrics: 'supported',
  },
};
