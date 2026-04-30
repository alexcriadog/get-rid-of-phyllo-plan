// Threads support matrix — declarative capability statement.
//
// Source of truth: developers.facebook.com/docs/threads/threads-objects +
// /threads-insights. The Threads public API exposes far less than IG/FB
// Graph: no demographic distributions on the audience product, no per-post
// retention curves, no city/country breakdowns. The richest product is
// engagement_new (per-post views/likes/replies/reposts/quotes via
// /{thread_id}/insights).

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
    // Threads insights are scalar lifetime counters — no distribution buckets
    // exposed publicly. Country/gender/age have no API surface today.
    countryDistribution: 'not_supported',
    cityDistribution: 'not_supported',
    genderDistribution: 'not_supported',
    ageDistribution: 'not_supported',
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
