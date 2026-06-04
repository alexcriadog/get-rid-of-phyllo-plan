// LinkedIn sync tuning. Dev tier: ~500 calls/app/day + 100/member/day.

/** Analytics lookback window for the audience product. */
export const ANALYTICS_PERIOD_DAYS = 30;
/** Posts page size (API max is 100; 50 keeps payloads sane). */
export const POSTS_PAGE_SIZE = 50;
/** Max pages of org posts per engagement sync. */
export const POSTS_MAX_PAGES = 2;
/** Share-statistics List(...) batch size per call. */
export const SHARE_STATS_BATCH = 20;
/** Metrics fetched as TOTAL (lifetime-in-window). */
export const MEMBER_METRICS_TOTAL = [
  'IMPRESSION',
  'REACTION',
  'COMMENT',
  'RESHARE',
  'MEMBERS_REACHED',
] as const;
/** Metrics fetched as DAILY series (DAILY unsupported for MEMBERS_REACHED). */
export const MEMBER_METRICS_DAILY = [
  'IMPRESSION',
  'REACTION',
  'COMMENT',
  'RESHARE',
] as const;
