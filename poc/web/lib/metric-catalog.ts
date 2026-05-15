/**
 * Multi-platform metric catalog — single source of truth for the labels,
 * descriptions, and provenance metadata shown on every tile in the
 * dashboard and the support matrix. Phase F+ of the IG total-coverage
 * rollout, extended to FB / YT / TT / Threads.
 *
 * Adding a metric:
 *   1. Find the platform block below.
 *   2. Append a descriptor with `key` matching either the canonical
 *      `ContentMetrics` / `AccountInsightsData` field or the
 *      `metrics.extra` / support-matrix field name.
 *   3. Pass `metricKey="<key>" platform="<plat>"` to <MetricTile />.
 *
 * Lookup is `(platform, key) → MetricDescriptor | undefined`. When the
 * catalog has no entry for the pair, MetricTile falls back to a
 * label-only render with no tooltip.
 */

export type MetricSurface =
  | 'account'
  | 'feed'
  | 'reels'
  | 'story'
  | 'video'
  | 'carousel';

export interface MetricDescriptor {
  key: string;
  label: string;
  description: string;
  period: 'day' | 'week' | 'days_28' | 'lifetime' | 'total_value' | 'realtime';
  windowSummary: string;
  /** OAuth scope (or platform-specific equivalent) that unlocks this metric. */
  scope: string;
  /** Optional — when the metric was added or rebranded by the platform. */
  availableSince?: string;
  /** Where this metric makes sense (account-level, per-post type). */
  availableOn: MetricSurface[];
}

// ============================================================================
// INSTAGRAM
// ============================================================================

const IG_SCOPE_INSIGHTS = 'instagram_manage_insights';
const IG_SCOPE_BASIC = 'instagram_basic';

const IG_METRICS: MetricDescriptor[] = [
  // Account-level totals (PanelAccountInsights)
  { key: 'reach', label: 'Reach', description: 'Unique accounts that saw the content at least once. Repeat views by the same user are not counted.', period: 'days_28', windowSummary: 'Last 28 days', scope: IG_SCOPE_INSIGHTS, availableOn: ['account', 'feed', 'reels', 'story', 'carousel'] },
  { key: 'views', label: 'Views', description: 'Times the content was shown (includes repeats). Replaces the legacy "Impressions" metric — Meta retired it in v22 (Apr 2025).', period: 'days_28', windowSummary: 'Last 28 days', scope: IG_SCOPE_INSIGHTS, availableSince: 'Meta v22 (Apr 2025)', availableOn: ['account', 'feed', 'reels', 'video', 'carousel'] },
  { key: 'accountsEngaged', label: 'Accounts engaged', description: 'Unique accounts that reacted to your content (likes, comments, saves, shares, replies). One account counts once.', period: 'days_28', windowSummary: 'Last 28 days', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'totalInteractions', label: 'Total interactions', description: 'Sum of every interaction: likes, comments, saves, shares, replies. Same account can be counted multiple times.', period: 'days_28', windowSummary: 'Last 28 days', scope: IG_SCOPE_INSIGHTS, availableOn: ['account', 'feed', 'reels', 'story', 'video', 'carousel'] },
  { key: 'profileViews', label: 'Profile views', description: 'Times your profile page was loaded.', period: 'days_28', windowSummary: 'Last 28 days', scope: IG_SCOPE_INSIGHTS, availableOn: ['account', 'feed', 'story', 'video', 'carousel'] },
  { key: 'likes', label: 'Likes', description: 'Total likes received in the period.', period: 'days_28', windowSummary: 'Last 28 days', scope: IG_SCOPE_INSIGHTS, availableOn: ['account', 'feed', 'reels', 'video', 'carousel'] },
  { key: 'comments', label: 'Comments', description: 'Total comments received in the period.', period: 'days_28', windowSummary: 'Last 28 days', scope: IG_SCOPE_INSIGHTS, availableOn: ['account', 'feed', 'reels', 'video', 'carousel'] },
  { key: 'saves', label: 'Saves', description: 'Times a user saved the content to their collections. Strong signal of perceived value (worth coming back to).', period: 'days_28', windowSummary: 'Last 28 days', scope: IG_SCOPE_INSIGHTS, availableOn: ['account', 'feed', 'reels', 'video', 'carousel'] },
  { key: 'shares', label: 'Shares', description: 'Times the content was shared (to own feed, DM, another network). A share is an explicit recommendation.', period: 'days_28', windowSummary: 'Last 28 days', scope: IG_SCOPE_INSIGHTS, availableOn: ['account', 'feed', 'reels', 'story', 'video', 'carousel'] },
  { key: 'replies', label: 'Replies', description: 'Direct replies to Stories via DM. Story-only — the equivalent of comments for ephemeral content.', period: 'days_28', windowSummary: 'Last 28 days', scope: IG_SCOPE_INSIGHTS, availableOn: ['account', 'story'] },
  { key: 'websiteClicks', label: 'Website clicks', description: 'Clicks on the bio link that points to your external site.', period: 'days_28', windowSummary: 'Last 28 days', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'emailContacts', label: 'Email clicks', description: 'Clicks on the email button on the business profile.', period: 'days_28', windowSummary: 'Last 28 days', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'phoneCallClicks', label: 'Phone call clicks', description: 'Clicks on the call button on the business profile.', period: 'days_28', windowSummary: 'Last 28 days', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'textMessageClicks', label: 'Text message clicks', description: 'Clicks on the SMS button on the business profile.', period: 'days_28', windowSummary: 'Last 28 days', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'getDirectionsClicks', label: 'Get directions clicks', description: 'Clicks on the directions button on the business profile.', period: 'days_28', windowSummary: 'Last 28 days', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },

  // Account "Additional" extras
  { key: 'profile_links_taps_total', label: 'Profile CTA clicks (total)', description: 'Sum of clicks on any CTA button on the business profile. Replaces the individual metrics Meta retired in v22.', period: 'days_28', windowSummary: 'Last 28 days', scope: IG_SCOPE_INSIGHTS, availableSince: 'Meta v22 (Apr 2025)', availableOn: ['account'] },
  { key: 'profile_links_taps_call', label: 'Profile CTA: call', description: 'Sub-bucket of profile_links_taps: clicks on the call button.', period: 'days_28', windowSummary: 'Last 28 days', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'profile_links_taps_email', label: 'Profile CTA: email', description: 'Sub-bucket of profile_links_taps: clicks on the email button.', period: 'days_28', windowSummary: 'Last 28 days', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'profile_links_taps_text', label: 'Profile CTA: text', description: 'Sub-bucket of profile_links_taps: clicks on the SMS button.', period: 'days_28', windowSummary: 'Last 28 days', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'profile_links_taps_directions', label: 'Profile CTA: directions', description: 'Sub-bucket of profile_links_taps: clicks on the directions button.', period: 'days_28', windowSummary: 'Last 28 days', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'profile_links_taps_website', label: 'Profile CTA: website', description: 'Sub-bucket of profile_links_taps: clicks on the bio link.', period: 'days_28', windowSummary: 'Last 28 days', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },

  // Per-post insight metrics (legacy + Phase A)
  { key: 'follows', label: 'New followers', description: 'Accounts that started following you after seeing this content.', period: 'lifetime', windowSummary: 'Content lifetime', scope: IG_SCOPE_INSIGHTS, availableOn: ['feed', 'video', 'carousel', 'story'] },
  { key: 'profile_visits', label: 'Profile visits from post', description: 'Times a viewer opened your profile after seeing this content.', period: 'lifetime', windowSummary: 'Content lifetime', scope: IG_SCOPE_INSIGHTS, availableOn: ['feed', 'video', 'carousel', 'story'] },
  { key: 'profile_activity', label: 'Profile activity', description: 'Total interactions with profile CTAs after seeing the post.', period: 'lifetime', windowSummary: 'Content lifetime', scope: IG_SCOPE_INSIGHTS, availableOn: ['feed', 'story'] },
  { key: 'profile_activity__bio_link_clicked', label: 'Bio link clicks (post)', description: 'Sub-bucket: viewers who clicked the bio link after seeing this post.', period: 'lifetime', windowSummary: 'Content lifetime', scope: IG_SCOPE_INSIGHTS, availableOn: ['feed', 'story'] },
  { key: 'navigation', label: 'Navigation (Story)', description: 'Total navigation events during the story: tap forward, tap back, tap exit, swipe forward.', period: 'lifetime', windowSummary: 'Story lifetime', scope: IG_SCOPE_INSIGHTS, availableOn: ['story'] },
  { key: 'navigation__tap_forward', label: 'Tap forward (Story)', description: 'Viewers who advanced to the next segment by tapping the right side. Lower is better — content is retaining attention.', period: 'lifetime', windowSummary: 'Story lifetime', scope: IG_SCOPE_INSIGHTS, availableOn: ['story'] },
  { key: 'navigation__tap_back', label: 'Tap back (Story)', description: 'Viewers who went back to the previous segment. High = content is interesting (they want to re-watch).', period: 'lifetime', windowSummary: 'Story lifetime', scope: IG_SCOPE_INSIGHTS, availableOn: ['story'] },
  { key: 'navigation__tap_exit', label: 'Tap exit (Story)', description: 'Viewers who exited stories after this segment. High = content lost them.', period: 'lifetime', windowSummary: 'Story lifetime', scope: IG_SCOPE_INSIGHTS, availableOn: ['story'] },
  { key: 'navigation__swipe_forward', label: 'Swipe forward (Story)', description: 'Viewers who swiped to the next account, skipping your story entirely. High = no hook.', period: 'lifetime', windowSummary: 'Story lifetime', scope: IG_SCOPE_INSIGHTS, availableOn: ['story'] },

  // Per-post free fields (Phase B.2)
  { key: 'reposts', label: 'Reposts', description: 'Times the content was reposted (re-share that appears as a new publication). Different from "shares".', period: 'lifetime', windowSummary: 'Content lifetime', scope: IG_SCOPE_BASIC, availableSince: 'Phase B (probe-confirmed v22)', availableOn: ['feed', 'reels', 'story'] },
  { key: 'total_like_count', label: 'Total likes (cross-platform)', description: 'Likes counting IG + boosted/ad versions of the post.', period: 'lifetime', windowSummary: 'Content lifetime', scope: 'pages_read_engagement', availableOn: ['feed', 'reels'] },
  { key: 'total_comments_count', label: 'Total comments (cross-platform)', description: 'Comments counting IG + boosted/ad versions.', period: 'lifetime', windowSummary: 'Content lifetime', scope: 'pages_read_engagement', availableOn: ['feed', 'reels'] },
  { key: 'total_views_count', label: 'Total views (cross-platform)', description: 'Views counting IG + boosted/ad versions. Video content only.', period: 'lifetime', windowSummary: 'Content lifetime', scope: 'pages_read_engagement', availableOn: ['reels', 'video'] },

  // Reels-specific (Phase B.3)
  { key: 'ig_reels_avg_watch_time', label: 'Average watch time', description: 'Average time (milliseconds) each viewer spends watching the Reel. High = the content holds attention.', period: 'lifetime', windowSummary: 'Reel lifetime', scope: IG_SCOPE_INSIGHTS, availableSince: 'Phase B (probe-confirmed v22)', availableOn: ['reels'] },
  { key: 'ig_reels_video_view_total_time', label: 'Total watch time', description: 'Sum of time (milliseconds) the entire audience spent watching the Reel. Equivalent to "attention hours generated".', period: 'lifetime', windowSummary: 'Reel lifetime', scope: IG_SCOPE_INSIGHTS, availableSince: 'Phase B (probe-confirmed v22)', availableOn: ['reels'] },
  { key: 'reels_skip_rate', label: 'Skip rate', description: 'Percentage of viewers who skipped the Reel without watching to the end. Lower is better.', period: 'lifetime', windowSummary: 'Reel lifetime', scope: IG_SCOPE_INSIGHTS, availableSince: 'Phase B (probe-confirmed v22)', availableOn: ['reels'] },

  // Profile / support-matrix specific
  { key: 'username', label: 'Username', description: 'Unique handle of the profile (without @).', period: 'realtime', windowSummary: 'Current snapshot', scope: IG_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'displayName', label: 'Display name', description: 'Display name shown on the profile. Editable.', period: 'realtime', windowSummary: 'Current snapshot', scope: IG_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'biography', label: 'Bio', description: 'Profile bio text (up to 150 chars).', period: 'realtime', windowSummary: 'Current snapshot', scope: IG_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'avatarUrl', label: 'Avatar URL', description: 'Profile picture URL (Meta CDN).', period: 'realtime', windowSummary: 'Current snapshot', scope: IG_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'followersCount', label: 'Followers', description: 'Total accounts following the profile. ≥100 unlocks some demographics.', period: 'realtime', windowSummary: 'Current snapshot', scope: IG_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'followingCount', label: 'Following', description: 'Total accounts the profile follows.', period: 'realtime', windowSummary: 'Current snapshot', scope: IG_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'postsCount', label: 'Posts published', description: 'Total posts (carousels, videos, reels included).', period: 'realtime', windowSummary: 'Current snapshot', scope: IG_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'verified', label: 'Verified', description: 'Blue badge. Meta does not expose this for IG Business via Graph in v22.', period: 'realtime', windowSummary: 'Current snapshot', scope: IG_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'accountType', label: 'Account type', description: 'BUSINESS / CREATOR / PERSONAL. Meta rejects this when the account is not enrolled in Shopping.', period: 'realtime', windowSummary: 'Current snapshot', scope: IG_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'genderDistribution', label: 'Gender distribution', description: 'Percentage of followers by gender. Requires ≥100 followers.', period: 'lifetime', windowSummary: 'Lifetime snapshot', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'ageDistribution', label: 'Age distribution', description: 'Buckets (13-17, 18-24, 25-34, ...). Requires ≥100 followers.', period: 'lifetime', windowSummary: 'Lifetime snapshot', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'countryDistribution', label: 'Country distribution', description: 'Top countries of the audience. Requires ≥100 followers.', period: 'lifetime', windowSummary: 'Lifetime snapshot', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'cityDistribution', label: 'City distribution', description: 'Top cities. Requires ≥100 followers.', period: 'lifetime', windowSummary: 'Lifetime snapshot', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'interests', label: 'Interests', description: 'Audience interest categories. Not exposed by Meta for IG.', period: 'lifetime', windowSummary: 'Not available', scope: IG_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'caption', label: 'Caption', description: 'Post text (up to 2200 chars).', period: 'realtime', windowSummary: 'Post snapshot', scope: IG_SCOPE_BASIC, availableOn: ['feed', 'reels', 'video', 'carousel'] },
  { key: 'permalink', label: 'Permalink', description: 'Public URL of the post (instagram.com/p/…).', period: 'realtime', windowSummary: 'Post snapshot', scope: IG_SCOPE_BASIC, availableOn: ['feed', 'reels', 'story', 'video', 'carousel'] },
  { key: 'mediaUrls', label: 'Media URLs', description: 'URLs of post images/videos (CDN). For carousels, one entry per slide.', period: 'realtime', windowSummary: 'Post snapshot', scope: IG_SCOPE_BASIC, availableOn: ['feed', 'reels', 'story', 'video', 'carousel'] },
  { key: 'publishedAt', label: 'Published at', description: 'UTC timestamp of when the post was published.', period: 'realtime', windowSummary: 'Post snapshot', scope: IG_SCOPE_BASIC, availableOn: ['feed', 'reels', 'story', 'video', 'carousel'] },
];

// ============================================================================
// FACEBOOK
// ============================================================================

const FB_SCOPE_INSIGHTS = 'read_insights';
const FB_SCOPE_ENGAGEMENT = 'pages_read_engagement';
const FB_SCOPE_USER_CONTENT = 'pages_read_user_content';
const FB_SCOPE_ADS = 'ads_read';

const FB_METRICS: MetricDescriptor[] = [
  { key: 'name', label: 'Page name', description: 'Public name of the Page.', period: 'realtime', windowSummary: 'Current snapshot', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['account'] },
  { key: 'about', label: 'About', description: 'Descriptive text on the Page profile.', period: 'realtime', windowSummary: 'Current snapshot', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['account'] },
  { key: 'category', label: 'Category', description: 'Page category (business, brand, public figure, etc.).', period: 'realtime', windowSummary: 'Current snapshot', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['account'] },
  { key: 'picture', label: 'Profile picture', description: 'CDN URL of the Page picture. Periodic refresh required.', period: 'realtime', windowSummary: 'Current snapshot', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['account'] },
  { key: 'fan_count', label: 'Fans (legacy)', description: 'Total accounts that liked the Page (legacy). Meta deprecated fan_count in 2024 — use followers_count.', period: 'realtime', windowSummary: 'Current snapshot', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['account'] },
  { key: 'followers_count', label: 'Followers', description: 'Total Page followers (modern metric replacing fan_count).', period: 'realtime', windowSummary: 'Current snapshot', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['account'] },
  { key: 'link', label: 'Page URL', description: 'Canonical public URL.', period: 'realtime', windowSummary: 'Current snapshot', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['account'] },
  { key: 'verified', label: 'Verified', description: 'Page verification status.', period: 'realtime', windowSummary: 'Current snapshot', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['account'] },
  { key: 'genderDistribution', label: 'Gender distribution', description: 'Meta retired page_fans_gender_age in 2024 with no public replacement.', period: 'lifetime', windowSummary: 'Not available', scope: FB_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'ageDistribution', label: 'Age distribution', description: 'Meta retired page_fans_gender_age in 2024 with no public replacement.', period: 'lifetime', windowSummary: 'Not available', scope: FB_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'countryDistribution', label: 'Country distribution', description: 'Top follower countries via page_follows_country (replaced page_fans_country in 2024).', period: 'lifetime', windowSummary: 'Lifetime snapshot', scope: FB_SCOPE_INSIGHTS, availableSince: 'Meta v22 (2024 rebrand)', availableOn: ['account'] },
  { key: 'cityDistribution', label: 'City distribution', description: 'Top cities via page_follows_city.', period: 'lifetime', windowSummary: 'Lifetime snapshot', scope: FB_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'interests', label: 'Interests', description: 'Not available for FB Pages.', period: 'lifetime', windowSummary: 'Not available', scope: FB_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'caption', label: 'Post text', description: 'Post message (mentions, links, hashtags).', period: 'realtime', windowSummary: 'Post snapshot', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['feed', 'video', 'story'] },
  { key: 'permalink', label: 'Permalink', description: 'Public URL of the post (facebook.com/<page>/posts/…).', period: 'realtime', windowSummary: 'Post snapshot', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['feed', 'video', 'story'] },
  { key: 'mediaUrls', label: 'Media URLs', description: 'URLs of post images/videos.', period: 'realtime', windowSummary: 'Post snapshot', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['feed', 'video', 'story'] },
  { key: 'likes', label: 'Likes', description: 'Positive reactions (like + love + care + …) via post_reactions_by_type_total.', period: 'lifetime', windowSummary: 'Post lifetime', scope: FB_SCOPE_INSIGHTS, availableOn: ['feed', 'video', 'story'] },
  { key: 'comments', label: 'Comments', description: 'Total comments (replies included).', period: 'lifetime', windowSummary: 'Post lifetime', scope: FB_SCOPE_INSIGHTS, availableOn: ['feed', 'video', 'story'] },
  { key: 'shares', label: 'Shares', description: 'Times the post was shared. Strong virality signal.', period: 'lifetime', windowSummary: 'Post lifetime', scope: FB_SCOPE_INSIGHTS, availableOn: ['feed', 'video', 'story'] },
  { key: 'saves', label: 'Saves', description: 'Not available for FB Pages.', period: 'lifetime', windowSummary: 'Not available', scope: FB_SCOPE_INSIGHTS, availableOn: ['feed'] },
  { key: 'impressions', label: 'Impressions', description: 'Meta retired post_impressions on Nov 15, 2025. Only available for paid ads via Ads API.', period: 'lifetime', windowSummary: 'Post lifetime', scope: FB_SCOPE_INSIGHTS, availableSince: 'Retired Nov 2025', availableOn: ['feed', 'story'] },
  { key: 'reach', label: 'Reach', description: 'Unique users who saw the post. post_total_media_view_unique replaces post_impressions_unique (retired Jun 2025).', period: 'lifetime', windowSummary: 'Post lifetime', scope: FB_SCOPE_INSIGHTS, availableSince: 'Meta v22 (Jun 2025)', availableOn: ['feed', 'video', 'story'] },
  { key: 'views', label: 'Views', description: 'Times the post was shown (replaces "Impressions"). post_media_view.', period: 'lifetime', windowSummary: 'Post lifetime', scope: FB_SCOPE_INSIGHTS, availableSince: 'Meta v22 (Nov 2025)', availableOn: ['feed', 'video', 'story'] },
  { key: 'replies', label: 'Replies (Story)', description: 'Story replies via pages_fb_story_replies.', period: 'lifetime', windowSummary: 'Story lifetime', scope: FB_SCOPE_INSIGHTS, availableOn: ['story'] },
  { key: 'ownerHandle', label: 'Author', description: 'Handle of the mentioned post author (when from another Page).', period: 'realtime', windowSummary: 'Post snapshot', scope: FB_SCOPE_USER_CONTENT, availableOn: ['feed'] },
  { key: 'text', label: 'Text', description: 'Comment body.', period: 'realtime', windowSummary: 'Comment snapshot', scope: FB_SCOPE_USER_CONTENT, availableOn: ['feed'] },
  { key: 'authorDisplayName', label: 'Author name', description: 'Public name of who commented.', period: 'realtime', windowSummary: 'Comment snapshot', scope: FB_SCOPE_USER_CONTENT, availableOn: ['feed'] },
  { key: 'authorHandle', label: 'Author handle', description: 'Username of who commented.', period: 'realtime', windowSummary: 'Comment snapshot', scope: FB_SCOPE_USER_CONTENT, availableOn: ['feed'] },
  { key: 'parentCommentId', label: 'Parent comment ID', description: 'If a reply, ID of the parent comment. Lets us reconstruct threads.', period: 'realtime', windowSummary: 'Comment snapshot', scope: FB_SCOPE_USER_CONTENT, availableOn: ['feed'] },
  { key: 'rating', label: 'Rating', description: 'Star or numeric (1-5) rating the reviewer gave the Page.', period: 'realtime', windowSummary: 'Review snapshot', scope: FB_SCOPE_USER_CONTENT, availableOn: ['account'] },
  { key: 'recommendation_type', label: 'Recommendation type', description: 'positive / negative — whether the reviewer recommends the Page.', period: 'realtime', windowSummary: 'Review snapshot', scope: FB_SCOPE_USER_CONTENT, availableOn: ['account'] },
  { key: 'review_text', label: 'Review text', description: 'Text written by the reviewer.', period: 'realtime', windowSummary: 'Review snapshot', scope: FB_SCOPE_USER_CONTENT, availableOn: ['account'] },
  { key: 'reviewer_name', label: 'Reviewer name', description: 'Public name of who wrote the review.', period: 'realtime', windowSummary: 'Review snapshot', scope: FB_SCOPE_USER_CONTENT, availableOn: ['account'] },
  { key: 'spend', label: 'Spend', description: 'Total ad spend (€/$ — currency depends on the ad account).', period: 'lifetime', windowSummary: 'Ad set lifetime', scope: FB_SCOPE_ADS, availableOn: ['account'] },
  { key: 'clicks', label: 'Clicks', description: 'Total clicks on the ad.', period: 'lifetime', windowSummary: 'Ad set lifetime', scope: FB_SCOPE_ADS, availableOn: ['account'] },
  { key: 'ctr', label: 'CTR', description: 'Click-through rate: clicks / impressions × 100. Creative relevance signal.', period: 'lifetime', windowSummary: 'Ad set lifetime', scope: FB_SCOPE_ADS, availableOn: ['account'] },
  { key: 'cpm', label: 'CPM', description: 'Cost per thousand impressions. Standard spend efficiency metric.', period: 'lifetime', windowSummary: 'Ad set lifetime', scope: FB_SCOPE_ADS, availableOn: ['account'] },
  { key: 'campaignBreakdown', label: 'Campaign breakdown', description: 'Metrics grouped by campaign_id.', period: 'lifetime', windowSummary: 'Ad account lifetime', scope: FB_SCOPE_ADS, availableOn: ['account'] },
  { key: 'recent_posts', label: 'Recent posts', description: 'Latest posts from a third-party Page accessible via Page Public Content Access.', period: 'realtime', windowSummary: 'Last N posts', scope: 'PPCA', availableOn: ['account'] },
  { key: 'publishedAt', label: 'Published at', description: 'UTC timestamp of when the post was published.', period: 'realtime', windowSummary: 'Post snapshot', scope: FB_SCOPE_ENGAGEMENT, availableOn: ['feed', 'video', 'story'] },
];

// ============================================================================
// YOUTUBE
// ============================================================================

const YT_SCOPE_DATA = 'youtube.readonly';
const YT_SCOPE_ANALYTICS = 'yt-analytics.readonly';
const YT_SCOPE_MONETARY = 'yt-analytics-monetary.readonly';

const YT_METRICS: MetricDescriptor[] = [
  { key: 'username', label: 'Username (handle)', description: 'YouTube handle (form @creatorname).', period: 'realtime', windowSummary: 'Current snapshot', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'displayName', label: 'Channel name', description: 'Public displayed channel name.', period: 'realtime', windowSummary: 'Current snapshot', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'biography', label: 'Description', description: 'Channel bio ("About" section).', period: 'realtime', windowSummary: 'Current snapshot', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'avatarUrl', label: 'Avatar URL', description: 'Channel picture URL.', period: 'realtime', windowSummary: 'Current snapshot', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'profileUrl', label: 'Channel URL', description: 'Canonical public URL (youtube.com/@handle).', period: 'realtime', windowSummary: 'Current snapshot', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'followersCount', label: 'Subscribers', description: 'Total subscribers. YouTube rounds publicly, but the API returns the exact number to the owner.', period: 'realtime', windowSummary: 'Current snapshot', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'followingCount', label: 'Following', description: 'YouTube does not expose this metric via the Data API.', period: 'realtime', windowSummary: 'Not available', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'postsCount', label: 'Videos published', description: 'Total channel videos (includes channel-owned unlisted).', period: 'realtime', windowSummary: 'Current snapshot', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'verified', label: 'Verified', description: 'YouTube does not explicitly expose this flag via the Data API.', period: 'realtime', windowSummary: 'Not available', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'accountType', label: 'Channel type', description: 'Channel type (creator, brand, etc.). YouTube does not standardize this well.', period: 'realtime', windowSummary: 'Current snapshot', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'website', label: 'Website', description: 'YouTube does not expose a canonical channel website.', period: 'realtime', windowSummary: 'Not available', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'category', label: 'Category', description: 'Topical category (partially exposed via topicDetails).', period: 'realtime', windowSummary: 'Current snapshot', scope: YT_SCOPE_DATA, availableOn: ['account'] },
  { key: 'genderDistribution', label: 'Gender distribution', description: 'Via Analytics API metric=viewerPercentage dimensions=ageGroup,gender. Requires ≥30 days of activity.', period: 'days_28', windowSummary: 'Last 28 days', scope: YT_SCOPE_ANALYTICS, availableOn: ['account'] },
  { key: 'ageDistribution', label: 'Age distribution', description: 'Age buckets (13-17, 18-24, 25-34, 35-44, 45-54, 55-64, 65+).', period: 'days_28', windowSummary: 'Last 28 days', scope: YT_SCOPE_ANALYTICS, availableOn: ['account'] },
  { key: 'countryDistribution', label: 'Country distribution', description: 'Top countries by views via Analytics API dimensions=country.', period: 'days_28', windowSummary: 'Last 28 days', scope: YT_SCOPE_ANALYTICS, availableOn: ['account'] },
  { key: 'cityDistribution', label: 'City distribution', description: 'Only available in Reporting API (bulk export), not in Analytics API.', period: 'days_28', windowSummary: 'Not available', scope: YT_SCOPE_ANALYTICS, availableOn: ['account'] },
  { key: 'interests', label: 'Interests', description: 'YouTube does not expose interest clusters via public API.', period: 'lifetime', windowSummary: 'Not available', scope: YT_SCOPE_ANALYTICS, availableOn: ['account'] },
  { key: 'views', label: 'Views', description: 'Total channel or video views.', period: 'days_28', windowSummary: 'Last 28 days (account) / lifetime (video)', scope: YT_SCOPE_DATA, availableOn: ['account', 'video'] },
  { key: 'likes', label: 'Likes', description: 'Total likes. Google publicly retired dislikes in 2021 — only accessible to the channel owner.', period: 'lifetime', windowSummary: 'Video lifetime', scope: YT_SCOPE_DATA, availableOn: ['account', 'video'] },
  { key: 'comments', label: 'Comments', description: 'Total comments (replies included).', period: 'lifetime', windowSummary: 'Video lifetime', scope: YT_SCOPE_DATA, availableOn: ['account', 'video'] },
  { key: 'shares', label: 'Shares', description: 'Times the video was shared off YouTube. Via Analytics API.', period: 'days_28', windowSummary: 'Last 28 days', scope: YT_SCOPE_ANALYTICS, availableOn: ['account', 'video'] },
  { key: 'audienceActivity', label: 'Hourly activity', description: 'YouTube does not expose a heatmap of when viewers are online.', period: 'lifetime', windowSummary: 'Not available', scope: YT_SCOPE_ANALYTICS, availableOn: ['account'] },
  { key: 'audienceActivityWeekly', label: 'Weekly activity', description: 'YouTube does not expose a 7×24 heatmap.', period: 'lifetime', windowSummary: 'Not available', scope: YT_SCOPE_ANALYTICS, availableOn: ['account'] },
  { key: 'revenue', label: 'Revenue', description: 'Monetization revenue (ads + memberships + Super Chat). Owner-only.', period: 'days_28', windowSummary: 'Last 28 days', scope: YT_SCOPE_MONETARY, availableOn: ['account'] },
  { key: 'cpm', label: 'CPM', description: 'Advertiser cost per thousand impressions — gross revenue / 1000 ad impressions.', period: 'days_28', windowSummary: 'Last 28 days', scope: YT_SCOPE_MONETARY, availableOn: ['account'] },
  { key: 'monetizedPlaybacks', label: 'Monetized playbacks', description: 'Times an ad was served during a playback.', period: 'days_28', windowSummary: 'Last 28 days', scope: YT_SCOPE_MONETARY, availableOn: ['account'] },
  { key: 'adImpressions', label: 'Ad impressions', description: 'Total ads served on channel videos.', period: 'days_28', windowSummary: 'Last 28 days', scope: YT_SCOPE_MONETARY, availableOn: ['account'] },
  { key: 'caption', label: 'Title', description: 'Video title (up to 100 chars).', period: 'realtime', windowSummary: 'Video snapshot', scope: YT_SCOPE_DATA, availableOn: ['video'] },
  { key: 'permalink', label: 'Video URL', description: 'Public URL (youtube.com/watch?v=…).', period: 'realtime', windowSummary: 'Video snapshot', scope: YT_SCOPE_DATA, availableOn: ['video'] },
  { key: 'mediaUrls', label: 'File URL', description: 'YouTube does not expose download links — requires yt-dlp.', period: 'realtime', windowSummary: 'Not available', scope: YT_SCOPE_DATA, availableOn: ['video'] },
  { key: 'duration', label: 'Duration', description: 'Video length (ISO 8601).', period: 'realtime', windowSummary: 'Video snapshot', scope: YT_SCOPE_DATA, availableOn: ['video'] },
  { key: 'isLive', label: 'Is live', description: 'Whether the video is in live broadcasting or finished.', period: 'realtime', windowSummary: 'Video snapshot', scope: YT_SCOPE_DATA, availableOn: ['video'] },
  { key: 'privacyStatus', label: 'Privacy', description: 'public / unlisted / private.', period: 'realtime', windowSummary: 'Video snapshot', scope: YT_SCOPE_DATA, availableOn: ['video'] },
  { key: 'madeForKids', label: 'Made for kids', description: 'COPPA legal flag — affects features (comments, ads, …).', period: 'realtime', windowSummary: 'Video snapshot', scope: YT_SCOPE_DATA, availableOn: ['video'] },
  { key: 'saves', label: 'Saves', description: 'YouTube does not expose saves / playlist adds via API.', period: 'lifetime', windowSummary: 'Not available', scope: YT_SCOPE_ANALYTICS, availableOn: ['video'] },
  { key: 'impressions', label: 'Impressions', description: 'Card impressions via Analytics API metric=cardImpressions.', period: 'days_28', windowSummary: 'Not exposed today', scope: YT_SCOPE_ANALYTICS, availableOn: ['video'] },
  { key: 'reach', label: 'Reach', description: 'YouTube does not expose "reach" as a named metric.', period: 'lifetime', windowSummary: 'Not available', scope: YT_SCOPE_ANALYTICS, availableOn: ['video'] },
  { key: 'list', label: 'Comment list', description: 'Top-level comment threads on the video. Paginated via nextPageToken.', period: 'realtime', windowSummary: 'Current snapshot', scope: YT_SCOPE_DATA, availableOn: ['video'] },
  { key: 'threaded', label: 'Threading', description: 'YouTube supports nested replies — typing a reply to a child comment actually attaches it to the top-level parent.', period: 'realtime', windowSummary: 'Current snapshot', scope: YT_SCOPE_DATA, availableOn: ['video'] },
  { key: 'pinned', label: 'Pinned comment', description: 'YouTube has the feature but the API does not publicly expose it.', period: 'realtime', windowSummary: 'Not available', scope: YT_SCOPE_DATA, availableOn: ['video'] },
];

// ============================================================================
// TIKTOK
// ============================================================================

const TT_SCOPE_BASIC = 'user.info.basic';
const TT_SCOPE_INSIGHTS = 'video.insights';
const TT_SCOPE_BIZ = 'business.basic';

const TT_METRICS: MetricDescriptor[] = [
  { key: 'username', label: 'Username', description: 'TikTok handle (without @). Stable.', period: 'realtime', windowSummary: 'Current snapshot', scope: TT_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'displayName', label: 'Display name', description: 'Profile display name.', period: 'realtime', windowSummary: 'Current snapshot', scope: TT_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'biography', label: 'Bio', description: 'Profile bio text.', period: 'realtime', windowSummary: 'Current snapshot', scope: TT_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'avatarUrl', label: 'Avatar URL', description: 'Profile picture URL. TikTok CDN.', period: 'realtime', windowSummary: 'Current snapshot', scope: TT_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'followersCount', label: 'Followers', description: 'Total profile followers.', period: 'realtime', windowSummary: 'Current snapshot', scope: TT_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'followingCount', label: 'Following', description: 'Total accounts the profile follows.', period: 'realtime', windowSummary: 'Current snapshot', scope: TT_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'postsCount', label: 'Videos published', description: 'Total profile videos (lifetime).', period: 'realtime', windowSummary: 'Current snapshot', scope: TT_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'verified', label: 'Verified', description: 'TikTok verification badge.', period: 'realtime', windowSummary: 'Current snapshot', scope: TT_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'accountType', label: 'Account type', description: 'business | null. TikTok distinguishes Business vs Personal/Creator.', period: 'realtime', windowSummary: 'Current snapshot', scope: TT_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'likesCount', label: 'Total likes', description: 'Sum of likes across all profile videos (lifetime).', period: 'lifetime', windowSummary: 'Lifetime total', scope: TT_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'countryDistribution', label: 'Country distribution', description: 'Top audience countries. Only populated when the account has ≥100 followers.', period: 'days_28', windowSummary: 'Last 28 days', scope: TT_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'cityDistribution', label: 'City distribution', description: 'Top cities. Same ≥100 follower threshold.', period: 'days_28', windowSummary: 'Last 28 days', scope: TT_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'genderDistribution', label: 'Gender distribution', description: 'Follower gender buckets. ≥100 followers required.', period: 'days_28', windowSummary: 'Last 28 days', scope: TT_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'ageDistribution', label: 'Age distribution', description: 'Age buckets. ≥100 followers.', period: 'days_28', windowSummary: 'Last 28 days', scope: TT_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'interests', label: 'Interests', description: 'TikTok does not expose interest clusters via API.', period: 'lifetime', windowSummary: 'Not available', scope: TT_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'accountInsights', label: 'Daily insights', description: 'Daily series of followers, video_views, profile_views, likes, comments, shares, CTAs + 24h heatmap + lifetime aggregates.', period: 'days_28', windowSummary: 'Last 28 days', scope: TT_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'caption', label: 'Caption', description: 'Video text (up to 2200 chars on Business accounts).', period: 'realtime', windowSummary: 'Video snapshot', scope: TT_SCOPE_BIZ, availableOn: ['video'] },
  { key: 'permalink', label: 'Permalink', description: 'Public URL (tiktok.com/@user/video/…).', period: 'realtime', windowSummary: 'Video snapshot', scope: TT_SCOPE_BIZ, availableOn: ['video'] },
  { key: 'mediaUrls', label: 'Downloadable MP4', description: 'TikTok v1.3 does NOT expose a downloadable MP4 via API.', period: 'realtime', windowSummary: 'Not available', scope: TT_SCOPE_BIZ, availableOn: ['video'] },
  { key: 'thumbnailUrl', label: 'Thumbnail URL', description: 'Video cover image.', period: 'realtime', windowSummary: 'Video snapshot', scope: TT_SCOPE_BIZ, availableOn: ['video'] },
  { key: 'embedUrl', label: 'Player URL', description: 'Official embeddable player URL.', period: 'realtime', windowSummary: 'Video snapshot', scope: TT_SCOPE_BIZ, availableOn: ['video'] },
  { key: 'likes', label: 'Likes', description: 'Total likes on the video.', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'comments', label: 'Comments', description: 'Total comments.', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'shares', label: 'Shares', description: 'Times the video was shared (to another app, link, etc.).', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'saves', label: 'Favorites', description: 'Times saved to the user\'s favorites. TikTok calls this "favorites".', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'reach', label: 'Reach', description: 'Unique video viewers.', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'views', label: 'Views', description: 'Total video plays (counts repeats).', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'videoDuration', label: 'Video duration', description: 'Video length in seconds.', period: 'realtime', windowSummary: 'Video snapshot', scope: TT_SCOPE_BIZ, availableOn: ['video'] },
  { key: 'watchTime', label: 'Watch time', description: 'total_time_watched + average_time_watched. Key retention indicator.', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'completionRate', label: 'Completion rate', description: 'Percentage of viewers who watched the full video (full_video_watched_rate).', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'trafficSource', label: 'Traffic source', description: 'Distribution of how viewers arrived (For You, Following, Profile, Search, …).', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'retentionCurve', label: 'Retention curve', description: 'Percentage of viewers watching at each second. Useful for spotting drop-offs.', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'likesTimeline', label: 'Likes timeline', description: 'engagement_likes per second. Pinpoints when the audience reacted.', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'audienceCountries', label: 'Audience countries', description: 'Top countries of the video viewers.', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'audienceCities', label: 'Audience cities', description: 'Top cities of the video viewers.', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'audienceGenders', label: 'Audience gender', description: 'Gender distribution of the viewers.', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'audienceTypes', label: 'Audience types', description: 'Type buckets (followers / non-followers, etc.) per TikTok.', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'profileViewsFromPost', label: 'Profile visits from post', description: 'Times a viewer opened the profile after watching the video.', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'newFollowersFromPost', label: 'New followers from post', description: 'Accounts that started following after watching the video.', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'emailClicks', label: 'Email clicks', description: 'Clicks on the Business profile email button.', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'phoneNumberClicks', label: 'Phone clicks', description: 'Clicks on the Business profile phone button.', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'addressClicks', label: 'Address clicks', description: 'Clicks on the physical address of the Business profile.', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'appDownloadClicks', label: 'App download clicks', description: 'Clicks on App Store / Play Store profile links.', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'leadSubmissions', label: 'Lead form submissions', description: 'Times a viewer filled in a lead form attached to the video.', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'websiteClicks', label: 'Website clicks', description: 'Clicks on the profile link to the external site.', period: 'lifetime', windowSummary: 'Video lifetime', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'impressions', label: 'Impressions', description: 'TikTok exposes reach (unique viewers) but NOT impressions. Equivalent metric: views.', period: 'lifetime', windowSummary: 'Not available', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'text', label: 'Text', description: 'Comment body.', period: 'realtime', windowSummary: 'Comment snapshot', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'publishedAt', label: 'Published at', description: 'UTC timestamp of the comment or video.', period: 'realtime', windowSummary: 'Snapshot', scope: TT_SCOPE_BIZ, availableOn: ['video'] },
  { key: 'likeCount', label: 'Comment likes', description: 'Times other users liked the comment.', period: 'realtime', windowSummary: 'Comment snapshot', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'replyCount', label: 'Replies', description: 'Number of nested replies.', period: 'realtime', windowSummary: 'Comment snapshot', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'pinned', label: 'Pinned', description: 'Whether the comment is pinned by the creator.', period: 'realtime', windowSummary: 'Comment snapshot', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
  { key: 'likedByCreator', label: 'Liked by creator', description: 'Whether the comment has the creator\'s heart.', period: 'realtime', windowSummary: 'Comment snapshot', scope: TT_SCOPE_INSIGHTS, availableOn: ['video'] },
];

// ============================================================================
// THREADS
// ============================================================================

const THR_SCOPE_BASIC = 'threads_basic';
const THR_SCOPE_INSIGHTS = 'threads_manage_insights';

const THR_METRICS: MetricDescriptor[] = [
  { key: 'name', label: 'Name', description: 'Public profile name.', period: 'realtime', windowSummary: 'Current snapshot', scope: THR_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'username', label: 'Username', description: 'Handle (without @). Shared with Instagram on linked accounts.', period: 'realtime', windowSummary: 'Current snapshot', scope: THR_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'biography', label: 'Bio', description: 'threads_biography — bio text.', period: 'realtime', windowSummary: 'Current snapshot', scope: THR_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'avatarUrl', label: 'Avatar URL', description: 'threads_profile_picture_url.', period: 'realtime', windowSummary: 'Current snapshot', scope: THR_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'profileUrl', label: 'Profile URL', description: 'Reconstructed as threads.net/@<username>.', period: 'realtime', windowSummary: 'Current snapshot', scope: THR_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'fanCount', label: 'Fans', description: 'Threads has no "fans" metric — uses followers_count.', period: 'realtime', windowSummary: 'Not available', scope: THR_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'followersCount', label: 'Followers', description: 'Total followers. Via /me/threads_insights metric=followers_count.', period: 'realtime', windowSummary: 'Current snapshot', scope: THR_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'link', label: 'Link', description: 'External profile link.', period: 'realtime', windowSummary: 'Current snapshot', scope: THR_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'verified', label: 'Verified', description: 'is_verified — Meta Verified badge.', period: 'realtime', windowSummary: 'Current snapshot', scope: THR_SCOPE_BASIC, availableOn: ['account'] },
  { key: 'countryDistribution', label: 'Country distribution', description: 'Threads does not expose demographic breakdowns via public API.', period: 'lifetime', windowSummary: 'Not available', scope: THR_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'cityDistribution', label: 'City distribution', description: 'Not available.', period: 'lifetime', windowSummary: 'Not available', scope: THR_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'genderDistribution', label: 'Gender distribution', description: 'Not available.', period: 'lifetime', windowSummary: 'Not available', scope: THR_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'ageDistribution', label: 'Age distribution', description: 'Not available.', period: 'lifetime', windowSummary: 'Not available', scope: THR_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'interests', label: 'Interests', description: 'Not available.', period: 'lifetime', windowSummary: 'Not available', scope: THR_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'views', label: 'Views', description: 'Total views on profile threads. Via /me/threads_insights.', period: 'lifetime', windowSummary: 'Lifetime', scope: THR_SCOPE_INSIGHTS, availableOn: ['account', 'feed'] },
  { key: 'likes', label: 'Likes', description: 'Total likes on profile threads. Lifetime scalar.', period: 'lifetime', windowSummary: 'Lifetime', scope: THR_SCOPE_INSIGHTS, availableOn: ['account', 'feed'] },
  { key: 'replies', label: 'Replies', description: 'Total replies (the "comments" concept on Threads).', period: 'lifetime', windowSummary: 'Lifetime', scope: THR_SCOPE_INSIGHTS, availableOn: ['account', 'feed'] },
  { key: 'reposts', label: 'Reposts', description: 'Total reposts of the profile.', period: 'lifetime', windowSummary: 'Lifetime', scope: THR_SCOPE_INSIGHTS, availableOn: ['account', 'feed'] },
  { key: 'quotes', label: 'Quotes', description: 'Total threads that quoted profile content.', period: 'lifetime', windowSummary: 'Lifetime', scope: THR_SCOPE_INSIGHTS, availableOn: ['account', 'feed'] },
  { key: 'followers', label: 'Followers (timeline)', description: 'Follower time series. Via /me/threads_insights with since/until.', period: 'lifetime', windowSummary: 'Lifetime', scope: THR_SCOPE_INSIGHTS, availableOn: ['account'] },
  { key: 'caption', label: 'Text', description: 'Thread text (`text`). Up to 500 characters.', period: 'realtime', windowSummary: 'Thread snapshot', scope: THR_SCOPE_BASIC, availableOn: ['feed'] },
  { key: 'permalink', label: 'Permalink', description: 'Thread URL (threads.net/@user/post/…).', period: 'realtime', windowSummary: 'Thread snapshot', scope: THR_SCOPE_BASIC, availableOn: ['feed'] },
  { key: 'mediaUrls', label: 'Media URLs', description: 'media_url + carousel children.', period: 'realtime', windowSummary: 'Thread snapshot', scope: THR_SCOPE_BASIC, availableOn: ['feed'] },
  { key: 'comments', label: 'Comments (replies)', description: 'metric=replies. Threads calls these "replies".', period: 'lifetime', windowSummary: 'Thread lifetime', scope: THR_SCOPE_INSIGHTS, availableOn: ['feed'] },
  { key: 'shares', label: 'Shares (reposts)', description: 'metric=reposts. Threads does not separate share-as-link from share-as-repost.', period: 'lifetime', windowSummary: 'Thread lifetime', scope: THR_SCOPE_INSIGHTS, availableOn: ['feed'] },
  { key: 'saves', label: 'Saves', description: 'Threads does not expose saves via API.', period: 'lifetime', windowSummary: 'Not available', scope: THR_SCOPE_INSIGHTS, availableOn: ['feed'] },
  { key: 'impressions', label: 'Impressions', description: 'Threads exposes views, not impressions.', period: 'lifetime', windowSummary: 'Not available', scope: THR_SCOPE_INSIGHTS, availableOn: ['feed'] },
  { key: 'reach', label: 'Reach', description: 'Threads does not expose reach as a named metric.', period: 'lifetime', windowSummary: 'Not available', scope: THR_SCOPE_INSIGHTS, availableOn: ['feed'] },
  { key: 'list', label: 'Reply list', description: 'Threads exposes replies via /{thread_id}/replies. Paginated.', period: 'realtime', windowSummary: 'Current snapshot', scope: THR_SCOPE_INSIGHTS, availableOn: ['feed'] },
  { key: 'threaded', label: 'Threading', description: 'Threads supports nested replies.', period: 'realtime', windowSummary: 'Current snapshot', scope: THR_SCOPE_INSIGHTS, availableOn: ['feed'] },
  { key: 'pinned', label: 'Pinned comment', description: 'Threads has the feature but the API does not expose it.', period: 'realtime', windowSummary: 'Not available', scope: THR_SCOPE_INSIGHTS, availableOn: ['feed'] },
  { key: 'metrics', label: 'Mention metrics', description: 'Metrics associated with the thread that mentioned you.', period: 'lifetime', windowSummary: 'Thread lifetime', scope: THR_SCOPE_INSIGHTS, availableOn: ['feed'] },
];

// ============================================================================
// TWITCH
// ============================================================================

const TW_SCOPE_USER = 'user:read:email';
const TW_SCOPE_FOLLOWERS = 'moderator:read:followers';
const TW_SCOPE_SUBS = 'channel:read:subscriptions';

const TW_METRICS: MetricDescriptor[] = [
  // Profile (identity product)
  { key: 'username', label: 'Login', description: 'Twitch login (URL slug, always lowercase).', period: 'realtime', windowSummary: 'Current snapshot', scope: TW_SCOPE_USER, availableOn: ['account'] },
  { key: 'displayName', label: 'Display name', description: 'Case-preserved display name shown on the channel page.', period: 'realtime', windowSummary: 'Current snapshot', scope: TW_SCOPE_USER, availableOn: ['account'] },
  { key: 'biography', label: 'Description', description: 'Channel description text shown on the About panel.', period: 'realtime', windowSummary: 'Current snapshot', scope: TW_SCOPE_USER, availableOn: ['account'] },
  { key: 'avatarUrl', label: 'Avatar URL', description: 'profile_image_url from /helix/users.', period: 'realtime', windowSummary: 'Current snapshot', scope: TW_SCOPE_USER, availableOn: ['account'] },
  { key: 'profileUrl', label: 'Profile URL', description: 'Reconstructed as twitch.tv/<login>.', period: 'realtime', windowSummary: 'Current snapshot', scope: TW_SCOPE_USER, availableOn: ['account'] },
  { key: 'bannerUrl', label: 'Offline image', description: 'offline_image_url — banner shown when the channel is offline.', period: 'realtime', windowSummary: 'Current snapshot', scope: TW_SCOPE_USER, availableOn: ['account'] },
  { key: 'accountType', label: 'Broadcaster type', description: 'broadcaster_type — empty (regular), "affiliate" (monetizable) or "partner" (Twitch revenue share).', period: 'realtime', windowSummary: 'Current snapshot', scope: TW_SCOPE_USER, availableOn: ['account'] },
  { key: 'publishedAt', label: 'Channel created', description: 'Account creation timestamp from /helix/users.', period: 'realtime', windowSummary: 'Current snapshot', scope: TW_SCOPE_USER, availableOn: ['account'] },
  { key: 'defaultLanguage', label: 'Broadcaster language', description: 'broadcaster_language from /helix/channels — ISO 639-1.', period: 'realtime', windowSummary: 'Current snapshot', scope: TW_SCOPE_USER, availableOn: ['account'] },
  { key: 'followersCount', label: 'Followers', description: 'Total followers via /helix/channels/followers?first=1 → .total.', period: 'realtime', windowSummary: 'Current snapshot', scope: TW_SCOPE_FOLLOWERS, availableOn: ['account'] },
  { key: 'subscriberCount', label: 'Paid subscribers', description: 'Total paid subscribers (all tiers + gifts) via /helix/subscriptions aggregation. Distinct from free followers.', period: 'realtime', windowSummary: 'Current snapshot', scope: TW_SCOPE_SUBS, availableOn: ['account'] },
  { key: 'subscribersByTier', label: 'Subs by tier', description: 'Tier breakdown: tier1 ($4.99), tier2 ($9.99), tier3 ($24.99), gifts (gifted-by-others count).', period: 'realtime', windowSummary: 'Current snapshot', scope: TW_SCOPE_SUBS, availableOn: ['account'] },

  // Engagement_new (VODs + clips)
  { key: 'caption', label: 'Title', description: 'VOD or clip title.', period: 'realtime', windowSummary: 'Content snapshot', scope: TW_SCOPE_USER, availableOn: ['video'] },
  { key: 'permalink', label: 'Permalink', description: 'twitch.tv/videos/<id> for VOD, clips.twitch.tv/<slug> for clip.', period: 'realtime', windowSummary: 'Content snapshot', scope: TW_SCOPE_USER, availableOn: ['video'] },
  { key: 'mediaUrls', label: 'Thumbnail', description: 'thumbnail_url from Helix.', period: 'realtime', windowSummary: 'Content snapshot', scope: TW_SCOPE_USER, availableOn: ['video'] },
  { key: 'views', label: 'Views', description: 'view_count from /helix/videos or /helix/clips. For VODs, views accumulate after the live stream ends.', period: 'realtime', windowSummary: 'Content snapshot', scope: TW_SCOPE_USER, availableOn: ['video'] },
  { key: 'duration', label: 'Duration', description: 'Helix-format string ("3h12m4s") for VODs, integer seconds for clips.', period: 'realtime', windowSummary: 'Content snapshot', scope: TW_SCOPE_USER, availableOn: ['video'] },
  { key: 'mutedSegmentsTotalSeconds', label: 'Muted segments', description: 'Total seconds of audio muted by DMCA on the VOD. Higher = more music-rights friction.', period: 'realtime', windowSummary: 'VOD snapshot', scope: TW_SCOPE_USER, availableOn: ['video'] },
  { key: 'vodOffsetSeconds', label: 'VOD offset (clip)', description: 'Seconds offset into the source VOD where the clip starts. Lets the UI jump from clip → exact VOD timecode.', period: 'realtime', windowSummary: 'Clip snapshot', scope: TW_SCOPE_USER, availableOn: ['video'] },
  { key: 'privacyStatus', label: 'Viewable', description: 'VOD privacy: "public" or "private".', period: 'realtime', windowSummary: 'VOD snapshot', scope: TW_SCOPE_USER, availableOn: ['video'] },
  { key: 'categoryId', label: 'Game (clip)', description: 'game_id for clips — links to the game/category at clip creation time. VODs do not carry per-VOD game data.', period: 'realtime', windowSummary: 'Clip snapshot', scope: TW_SCOPE_USER, availableOn: ['video'] },

  // Explicit "not available" entries so the support matrix shows them as
  // gaps. Helps operators understand why the product surface is thinner
  // than YouTube/IG/FB.
  { key: 'genderDistribution', label: 'Gender distribution', description: 'Twitch does not expose audience demographics via Helix.', period: 'lifetime', windowSummary: 'Not available', scope: TW_SCOPE_USER, availableOn: ['account'] },
  { key: 'ageDistribution', label: 'Age distribution', description: 'Twitch does not expose audience demographics via Helix.', period: 'lifetime', windowSummary: 'Not available', scope: TW_SCOPE_USER, availableOn: ['account'] },
  { key: 'countryDistribution', label: 'Country distribution', description: 'Twitch does not expose audience geography via Helix.', period: 'lifetime', windowSummary: 'Not available', scope: TW_SCOPE_USER, availableOn: ['account'] },
  { key: 'cityDistribution', label: 'City distribution', description: 'Twitch does not expose audience geography via Helix.', period: 'lifetime', windowSummary: 'Not available', scope: TW_SCOPE_USER, availableOn: ['account'] },
  { key: 'likes', label: 'Likes', description: 'Twitch has no "likes" concept on VODs or clips.', period: 'lifetime', windowSummary: 'Not available', scope: TW_SCOPE_USER, availableOn: ['video'] },
  { key: 'comments', label: 'Comments', description: 'Twitch chat is real-time IRC. Helix does not expose historical chat for VODs.', period: 'lifetime', windowSummary: 'Not available', scope: TW_SCOPE_USER, availableOn: ['video'] },
  { key: 'shares', label: 'Shares', description: 'Twitch does not expose share counts.', period: 'lifetime', windowSummary: 'Not available', scope: TW_SCOPE_USER, availableOn: ['video'] },
  { key: 'retentionCurve', label: 'Retention curve', description: 'Twitch does not expose per-VOD audience retention (YouTube-only). Creator Dashboard shows it, but no public API.', period: 'lifetime', windowSummary: 'Not available', scope: TW_SCOPE_USER, availableOn: ['video'] },
  { key: 'revenue', label: 'Revenue ($)', description: 'Twitch does not expose creator revenue via Helix. Ad revenue, sub payouts and bits payouts only visible in Creator Dashboard.', period: 'lifetime', windowSummary: 'Not available', scope: TW_SCOPE_USER, availableOn: ['account'] },
];

// ============================================================================
// LOOKUP
// ============================================================================

const CATALOGS: Record<string, MetricDescriptor[]> = {
  instagram: IG_METRICS,
  facebook: FB_METRICS,
  youtube: YT_METRICS,
  tiktok: TT_METRICS,
  threads: THR_METRICS,
  twitch: TW_METRICS,
};

const BY_PLATFORM: Record<string, Map<string, MetricDescriptor>> =
  Object.fromEntries(
    Object.entries(CATALOGS).map(([plat, list]) => [
      plat,
      new Map(list.map((m) => [m.key, m])),
    ]),
  );

/**
 * Lookup descriptor for a (platform, key) pair. Returns `undefined` when the
 * platform isn't in the catalog or the key isn't catalogued — callers should
 * fall back to a label-only render in that case.
 */
export function lookupMetric(
  platform: string | undefined,
  key: string,
): MetricDescriptor | undefined {
  if (!platform) return undefined;
  return BY_PLATFORM[platform]?.get(key);
}

/** Re-exported for callers that want to enumerate a platform's catalog. */
export const PLATFORM_METRICS = CATALOGS;
