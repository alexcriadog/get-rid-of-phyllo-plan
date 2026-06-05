// YouTube comments fetcher.
//
// Strategy: pick top-N videos by views in the last `periodDays` (Analytics
// API, dimensions=video, sort=-views) then walk commentThreads.list per
// video (1 unit per page, 100 comments per page). Cap pages per video to
// keep quota cost predictable.
//
// 403 commentsDisabled is swallowed (the chokepoint maps it to
// AdapterFetchError; we re-inspect via isCommentsDisabled and skip).

import { Inject, Injectable, Logger } from '@nestjs/common';
import { AdapterFetchError } from '../../shared/platform-adapter.port';
import type { CommentData, FetchOpts } from '../../shared/platform-types';
import type {
  BoundYoutubeClient,
  YoutubeCallContext,
} from '../../shared/youtube-api/youtube-client';
import type { YoutubeCommentThread } from '../../shared/youtube-api/youtube-types';
import { isCommentsDisabled } from '../../shared/youtube-api/youtube-errors';
import { extractAccountId } from '../../shared/meta-graph';
import { buildYoutubeContext } from '../youtube.context';
import { commentThreadToComments } from '../mapper/comment-thread-to-comment.mapper';
import { rethrowCritical } from '../../shared/fetch-guards';
import { YOUTUBE_API_CLIENT } from '../youtube.tokens';

const DEFAULT_TOP_N = 20;
const MAX_COMMENT_PAGES_PER_VIDEO = 3;
const DEFAULT_PERIOD_DAYS = 30;

@Injectable()
export class YoutubeCommentsFetcher {
  private readonly logger = new Logger(YoutubeCommentsFetcher.name);

  constructor(
    @Inject(YOUTUBE_API_CLIENT)
    private readonly client: BoundYoutubeClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<CommentData[]> {
    const accountId = extractAccountId(metadata);
    const ctx = buildYoutubeContext(accessToken, canonicalId, metadata);
    const callCtx: YoutubeCallContext = { accessToken, context: ctx, accountId };
    const topN = opts.limit ?? DEFAULT_TOP_N;

    const videoIds = await this.topVideoIdsByViews(callCtx, topN);
    if (videoIds.length === 0) return [];

    const all: CommentData[] = [];
    for (const videoId of videoIds) {
      const perVideo = await this.collectForVideo(videoId, callCtx);
      all.push(...perVideo);
    }
    return all;
  }

  private async topVideoIdsByViews(
    callCtx: YoutubeCallContext,
    n: number,
  ): Promise<string[]> {
    try {
      const periodDays = DEFAULT_PERIOD_DAYS;
      const { startDate, endDate } = computeWindow(periodDays);
      const report = await this.client.analyticsQuery({
        ...callCtx,
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics: 'views',
        dimensions: 'video',
        sort: '-views',
        maxResults: n,
      });
      const headers = (report.columnHeaders ?? []).map((h) => h.name ?? '');
      const videoIdx = headers.indexOf('video');
      if (videoIdx === -1) return [];
      return (report.rows ?? [])
        .map((r) => String(r[videoIdx] ?? ''))
        .filter((v) => v.length > 0);
    } catch (err) {
      rethrowCritical(err);
      this.logger.warn(
        `topVideoIdsByViews failed; fallback to empty list: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }

  private async collectForVideo(
    videoId: string,
    callCtx: YoutubeCallContext,
  ): Promise<CommentData[]> {
    const out: CommentData[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_COMMENT_PAGES_PER_VIDEO; page++) {
      let body;
      try {
        body = await this.client.listCommentThreads({
          ...callCtx,
          videoId,
          maxResults: 100,
          order: 'time',
          pageToken,
        });
      } catch (err) {
        // Per-video 403s (commentsDisabled, forbidden on hidden comments,
        // private video, etc.) must not abort the whole comments product —
        // skip this video and continue. Token-revocation 403s never reach
        // here: youtube-errors maps those to TokenRevokedError, which we
        // re-throw so the worker can flip account.status correctly.
        if (err instanceof AdapterFetchError) {
          if (isCommentsDisabled(err.cause)) {
            this.logger.debug(`comments disabled for video=${videoId}; skipping`);
          } else {
            this.logger.warn(
              `comments fetch failed for video=${videoId}; skipping: ${err.message}`,
            );
          }
          return out;
        }
        throw err;
      }
      for (const thread of (body.items ?? []) as YoutubeCommentThread[]) {
        out.push(...commentThreadToComments(thread));
      }
      const next = body.nextPageToken;
      if (!next) break;
      pageToken = next;
    }
    return out;
  }
}

function computeWindow(periodDays: number): { startDate: string; endDate: string } {
  const now = new Date();
  const end = new Date(now.getTime() - 24 * 3_600_000);
  const start = new Date(end.getTime() - periodDays * 86_400_000);
  return {
    startDate: yyyymmdd(start),
    endDate: yyyymmdd(end),
  };
}

function yyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
