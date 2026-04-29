// TikTok comments fetcher. v1.3.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CommentData, FetchOpts } from '../../shared/platform-types';
import type {
  BoundTikTokClient,
  TikTokComment,
  TikTokVideo,
} from '../../shared/tiktok-api';
import { extractAccountId, extractTikTokError } from '../../shared/tiktok-api';
import { commentToCommentData } from '../mapper/tiktok-comment.mapper';
import {
  COMMENTS_MAX_PER_PAGE,
  COMMENTS_VIDEO_LOOKBACK,
  DEFAULT_COMMENTS_PER_VIDEO,
} from '../tiktok.constants';
import { buildTikTokContext } from '../tiktok.context';
import { TIKTOK_API_CLIENT } from '../tiktok.tokens';

interface VideoListLite { videos?: Pick<TikTokVideo, 'item_id'>[] }
interface CommentListData { comments?: TikTokComment[]; cursor?: number; has_more?: boolean }

@Injectable()
export class TikTokCommentsFetcher {
  private readonly logger = new Logger(TikTokCommentsFetcher.name);

  constructor(
    @Inject(TIKTOK_API_CLIENT) private readonly client: BoundTikTokClient,
  ) {}

  async fetch(
    accessToken: string,
    _canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<CommentData[]> {
    const ctx = buildTikTokContext(accessToken, metadata);
    const accountId = extractAccountId(metadata);
    const perVideo = opts.limit ?? DEFAULT_COMMENTS_PER_VIDEO;

    const list = await this.client.call<VideoListLite>({
      endpoint: '/business/video/list/',
      method: 'GET',
      fields: ['item_id'],
      query: { max_count: COMMENTS_VIDEO_LOOKBACK },
      accessToken,
      context: ctx,
      accountId,
    });

    const videoIds = (list.videos ?? []).map((v) => v.item_id);
    const out: CommentData[] = [];
    let failures = 0;
    let lastErr = '';

    for (const videoId of videoIds) {
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
        failures += 1;
        lastErr = extractTikTokError(err);
        this.logger.debug(`comment list failed video=${videoId}: ${lastErr}`);
      }
    }

    if (videoIds.length > 0 && failures === videoIds.length) {
      this.logger.warn(
        `all ${failures} comment calls failed for account=${accountId}; last_error=${lastErr}`,
      );
    }
    return out;
  }
}
