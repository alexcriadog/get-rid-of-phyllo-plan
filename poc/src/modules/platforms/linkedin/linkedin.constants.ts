// LinkedIn sync tuning. Dev tier: ~500 calls/app/day + 100/member/day.

/** Analytics lookback window for the audience product. */
export const ANALYTICS_PERIOD_DAYS = 30;
/** Posts page size (API max is 100; 50 keeps payloads sane). */
export const POSTS_PAGE_SIZE = 50;
/** Max pages of org posts per engagement sync. */
export const POSTS_MAX_PAGES = 2;
/** Share-statistics List(...) batch size per call. */
export const SHARE_STATS_BATCH = 20;
/** Metrics fetched as TOTAL (lifetime-in-window). Full 202605 set. */
export const MEMBER_METRICS_TOTAL = [
  'IMPRESSION',
  'REACTION',
  'COMMENT',
  'RESHARE',
  'MEMBERS_REACHED',
  'POST_SAVE',
  'POST_SEND',
  'LINK_CLICKS',
  'PREMIUM_CTA_CLICKS',
  'FOLLOWER_GAINED_FROM_CONTENT',
  'PROFILE_VIEW_FROM_CONTENT',
] as const;
/** Metrics fetched as DAILY series — only those with a canonical series
 * slot; DAILY is unsupported anyway for MEMBERS_REACHED / LINK_CLICKS /
 * FOLLOWER_GAINED_FROM_CONTENT / PROFILE_VIEW_FROM_CONTENT. */
export const MEMBER_METRICS_DAILY = [
  'IMPRESSION',
  'REACTION',
  'COMMENT',
  'RESHARE',
] as const;
/** socialMetadata BATCH_GET batch size (reaction breakdown per post). */
export const SOCIAL_METADATA_BATCH = 20;
/** Comments product: how many recent posts to thread per sync. */
export const COMMENTS_MAX_POSTS = 10;
/** Max comments fetched per post per sync. */
export const COMMENTS_PER_POST = 100;
/** Mentions product: max notifications + mentioning posts per sync. */
export const MENTIONS_MAX = 10;
