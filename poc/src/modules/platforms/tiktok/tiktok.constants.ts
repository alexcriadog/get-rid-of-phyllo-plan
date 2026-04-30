// TikTok local constants. F3.

/** TikTok caps `/business/video/list/` page size at 20. */
export const DEFAULT_PAGE_SIZE = 20;

/** TikTok caps `/business/comment/list/` `max_count` at 30 per page. */
export const COMMENTS_MAX_PER_PAGE = 30;

/** Caller-imposed cap for comments per video to bound work and quota burn. */
export const DEFAULT_COMMENTS_PER_VIDEO = COMMENTS_MAX_PER_PAGE;

/**
 * How many of the most-recent videos to scan when looking for comments.
 *
 * 50 covers the typical "comment lands days/weeks after the post" pattern
 * (e.g. Camaleonic's Super Bowl post got its first comment one position
 * past the previous lookback of 10). The scan only does ONE list call —
 * actual comment_list calls are skipped for videos whose `comments` count
 * is 0, so the per-sync cost stays close to "1 call + N-with-comments".
 */
export const COMMENTS_VIDEO_LOOKBACK = 50;
