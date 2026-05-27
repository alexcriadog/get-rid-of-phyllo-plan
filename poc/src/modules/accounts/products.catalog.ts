export type Platform =
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'threads'
  | 'youtube'
  | 'twitch';

/**
 * Products we create sync_jobs for on seed. Day 1 we just write these rows —
 * Day 2 the scheduler picks them up.
 */
export const PRODUCTS_BY_PLATFORM: Record<Platform, ReadonlyArray<string>> = {
  instagram: ['identity', 'audience', 'engagement_new', 'stories'],
  // Page Stories API is GA in v22 — see FacebookAdapter.fetchStories.
  // pages_read_user_content (May 2026 grant) unlocked `mentions` (/tagged),
  // user-identity in `comments`, and Page `ratings`. ads_read added `ads`.
  // public_pages monitor (PPCA) is NOT a per-account product — it's a
  // separate watchlist on `public_page_snapshots`.
  facebook: [
    'identity',
    'audience',
    'engagement_new',
    'stories',
    'mentions',
    'comments',
    'ratings',
    'ads',
  ],
  // TikTok BC v1.3: stories don't exist; mentions probe pending.
  tiktok: ['identity', 'audience', 'engagement_new', 'comments'],
  // Threads has no stories. /me/mentioned_threads is the mentions surface.
  threads: ['identity', 'audience', 'engagement_new', 'comments', 'mentions'],
  // YouTube: no stories, no mentions surface in the public API.
  // engagement_deep: per-video Analytics drill-down + retention curve.
  // ads: Google Ads campaigns (requires GOOGLE_ADS_DEVELOPER_TOKEN).
  youtube: [
    'identity',
    'audience',
    'engagement_new',
    'engagement_deep',
    'comments',
    'ads',
  ],
  // Twitch: VODs + clips only (no live tracking). Followers + subscriber
  // counts live inside the `identity` snapshot because Helix doesn't expose
  // demographic distributions. No engagement_deep (no Analytics API), no
  // comments (chat is real-time), no ads (no revenue $ via Helix), no
  // stories/mentions/ratings (concepts don't exist on Twitch).
  twitch: ['identity', 'engagement_new'],
};
