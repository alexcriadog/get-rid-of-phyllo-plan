// Facebook support matrix — declarative capability statement. Phase C.
// Lifted verbatim from FacebookAdapter.supportMatrix().

import type { SupportMatrix } from '../shared/platform-types';

export const FACEBOOK_SUPPORT_MATRIX: SupportMatrix = {
  profile: {
    name: 'supported',
    about: 'supported',
    category: 'supported',
    picture: 'supported',
    fan_count: 'supported',
    followers_count: 'supported',
    link: 'supported',
    verified: 'not_supported',
  },
  audience: {
    // Country + city via the modern page_follows_country / _city metrics
    // (replaced the deprecated page_fans_* family in 2024). Gender/age never
    // got a replacement — Meta sunsetted them with no successor.
    countryDistribution: 'supported',
    cityDistribution: 'supported',
    genderDistribution: 'not_supported',
    ageDistribution: 'not_supported',
    interests: 'not_supported',
  },
  engagement_new: {
    caption: 'supported',
    permalink: 'supported',
    mediaUrls: 'supported',
    likes: 'supported',
    comments: 'supported',
    shares: 'supported',
    saves: 'not_supported',
    impressions: 'supported',
    reach: 'supported',
    views: 'supported',
  },
  stories: {
    // Page Stories API — GA in v22. Story object: {post_id, status,
    // creation_time, media_type, media_id, url}. Per-story insights via
    // GET /{post_id}/insights (no metric param) returns the 9 metrics.
    // `views` is empty_possible because Meta seems to populate
    // `story_media_view` mostly for video stories.
    permalink: 'supported',
    publishedAt: 'supported',
    mediaUrls: 'supported',
    likes: 'supported',
    shares: 'supported',
    impressions: 'supported',
    reach: 'supported',
    views: 'empty_possible',
    replies: 'supported',
  },
  // pages_read_user_content (May 2026 grant) — third-party tagged posts.
  mentions: {
    caption: 'supported',
    permalink: 'supported',
    mediaUrls: 'supported',
    ownerHandle: 'supported',
    publishedAt: 'supported',
    likes: 'supported',
    comments: 'supported',
  },
  // pages_read_user_content — user identity on post comments.
  comments: {
    text: 'supported',
    authorDisplayName: 'supported',
    authorHandle: 'supported',
    publishedAt: 'supported',
    likes: 'supported',
    parentCommentId: 'supported',
  },
  // pages_read_user_content — Page reviews (CA-only admin pull).
  ratings: {
    rating: 'supported',
    recommendation_type: 'supported',
    review_text: 'supported',
    reviewer_name: 'supported',
    publishedAt: 'supported',
  },
  // ads_read (May 2026 grant) — CA-only admin pull, returns empty when
  // the ad account has no historical campaigns.
  ads: {
    spend: 'empty_possible',
    impressions: 'empty_possible',
    reach: 'empty_possible',
    clicks: 'empty_possible',
    ctr: 'empty_possible',
    cpm: 'empty_possible',
    campaignBreakdown: 'empty_possible',
  },
  // Page Public Content Access — read-only third-party Page metadata + posts.
  public_pages: {
    name: 'supported',
    fan_count: 'supported',
    followers_count: 'supported',
    about: 'supported',
    category: 'supported',
    recent_posts: 'supported',
  },
};
