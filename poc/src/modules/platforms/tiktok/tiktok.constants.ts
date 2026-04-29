// TikTok local constants. F3.

/** TikTok caps `/business/video/list/` page size at 20. */
export const DEFAULT_PAGE_SIZE = 20;

/** TikTok caps `/business/comment/list/` `max_count` at 30 per page. */
export const COMMENTS_MAX_PER_PAGE = 30;

/** Caller-imposed cap for comments per video to bound work and quota burn. */
export const DEFAULT_COMMENTS_PER_VIDEO = COMMENTS_MAX_PER_PAGE;

/** How many of the most-recent videos to walk for `comments` syncs. */
export const COMMENTS_VIDEO_LOOKBACK = 10;
