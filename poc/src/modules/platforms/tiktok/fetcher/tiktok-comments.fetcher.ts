// TikTok comments fetcher. v1.3.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CommentData, FetchOpts } from '../../shared/platform-types';
import type {
  BoundTikTokClient,
  TikTokComment,
  TikTokVideo,
} from '../../shared/tiktok-api';
import { extractAccountId, extractTikTokError } from '../../shared/tiktok-api';
import { rethrowCritical } from '../../shared/fetch-guards';
import { commentToCommentData } from '../mapper/tiktok-comment.mapper';
import {
  COMMENTS_MAX_PER_PAGE,
  COMMENTS_VIDEO_LOOKBACK,
  DEFAULT_COMMENTS_PER_VIDEO,
  DEFAULT_PAGE_SIZE,
} from '../tiktok.constants';
import { buildTikTokContext } from '../tiktok.context';
import { TIKTOK_API_CLIENT } from '../tiktok.tokens';

interface VideoListLite {
  videos?: Pick<TikTokVideo, 'item_id' | 'comments'>[];
  cursor?: number;
  has_more?: boolean;
}
interface CommentListData { comments?: TikTokComment[]; cursor?: number; has_more?: boolean }

@Injectable()
export class TikTokCommentsFetcher {
  private readonly logger = new Logger(TikTokCommentsFetcher.name);

  constructor(
    @Inject(TIKTOK_API_CLIENT) private readonly client: BoundTikTokClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<CommentData[]> {
    const ctx = buildTikTokContext(accessToken, canonicalId, metadata);
    const accountId = extractAccountId(metadata);
    const perVideo = opts.limit ?? DEFAULT_COMMENTS_PER_VIDEO;

    // Pull the `comments` count alongside the id so we can skip videos
    // with 0 comments — burning a /business/comment/list/ call per empty
    // video is what made the post "Super Halftime Show" get missed last
    // time (it was at chronological position #11 with the previous
    // lookback of 10).
    //
    // Pagination: TikTok caps `/business/video/list/` `max_count` at 20
    // per page (40002 otherwise), so we cursor-paginate until we have
    // COMMENTS_VIDEO_LOOKBACK videos or the feed runs out.
    const scanned: { item_id: string; comments: number }[] = [];
    let cursor: number | undefined;
    while (scanned.length < COMMENTS_VIDEO_LOOKBACK) {
      const remaining = COMMENTS_VIDEO_LOOKBACK - scanned.length;
      const data = await this.client.call<VideoListLite>({
        endpoint: '/business/video/list/',
        method: 'GET',
        fields: ['item_id', 'comments'],
        query: {
          max_count: Math.min(remaining, DEFAULT_PAGE_SIZE),
          cursor,
        },
        accessToken,
        context: ctx,
        accountId,
      });
      for (const v of data.videos ?? []) {
        if (typeof v.item_id === 'string' && typeof v.comments === 'number') {
          scanned.push({ item_id: v.item_id, comments: v.comments });
          if (scanned.length >= COMMENTS_VIDEO_LOOKBACK) break;
        }
      }
      if (!data.has_more || data.cursor === undefined) break;
      cursor = data.cursor;
    }

    const candidates = scanned.filter((v) => v.comments > 0);
    const totalScanned = scanned.length;
    if (candidates.length === 0) {
      this.logger.debug(
        `no videos with comments in last ${totalScanned} for account=${accountId}`,
      );
      return [];
    }
    this.logger.debug(
      `account=${accountId} commented videos=${candidates.length}/${totalScanned}; fetching threads`,
    );

    const out: CommentData[] = [];
    let failures = 0;
    let lastErr = '';

    for (const v of candidates) {
      const videoId = v.item_id;
      try {
        const data = await this.client.call<CommentListData>({
          endpoint: '/business/comment/list/',
          method: 'GET',
          query: {
            video_id: videoId,
            max_count: Math.min(perVideo, COMMENTS_MAX_PER_PAGE),
          },
          accessToken,
          context: ctx,
          accountId,
        });
        for (const c of data.comments ?? []) {
          out.push(commentToCommentData(c, videoId));
        }
      } catch (err) {
        rethrowCritical(err);
        failures += 1;
        lastErr = extractTikTokError(err);
        this.logger.debug(`comment list failed video=${videoId}: ${lastErr}`);
      }
    }

    if (candidates.length > 0 && failures === candidates.length) {
      this.logger.warn(
        `all ${failures} comment calls failed for account=${accountId}; last_error=${lastErr}`,
      );
    }
    return out;
  }
}
