// TikTok content (videos) fetcher. v1.3.
//
// /business/video/list/ returns the basic counters (views/likes/comments/
// shares/duration). Per-video deep insights endpoints (/business/video/get/,
// /business/video/insights/) DO NOT EXIST in v1.3 with our current scopes
// — verified live 2026-04-29. So we ship just the list response.

import { Inject, Injectable } from '@nestjs/common';
import type { ContentData, FetchOpts } from '../../shared/platform-types';
import type { BoundTikTokClient, TikTokVideo } from '../../shared/tiktok-api';
import { extractAccountId } from '../../shared/tiktok-api';
import { videoToContent } from '../mapper/tiktok-video.mapper';
import { DEFAULT_PAGE_SIZE } from '../tiktok.constants';
import { buildTikTokContext } from '../tiktok.context';
import { TIKTOK_API_CLIENT } from '../tiktok.tokens';

const LIST_FIELDS = [
  'item_id',
  'caption',
  'create_time',
  'thumbnail_url',
  'share_url',
  'video_views',
  'likes',
  'comments',
  'shares',
  'video_duration',
];

interface VideoListData {
  videos?: TikTokVideo[];
  cursor?: number;
  has_more?: boolean;
}

@Injectable()
export class TikTokContentFetcher {
  constructor(
    @Inject(TIKTOK_API_CLIENT) private readonly client: BoundTikTokClient,
  ) {}

  async fetch(
    accessToken: string,
    _canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    const ctx = buildTikTokContext(accessToken, metadata);
    const accountId = extractAccountId(metadata);
    const limit = opts.limit ?? DEFAULT_PAGE_SIZE;
    const collected: ContentData[] = [];
    let cursor: number | undefined;

    while (collected.length < limit) {
      const data = await this.client.call<VideoListData>({
        endpoint: '/business/video/list/',
        method: 'GET',
        fields: LIST_FIELDS,
        query: {
          max_count: Math.min(limit - collected.length, DEFAULT_PAGE_SIZE),
          cursor,
        },
        accessToken,
        context: ctx,
        accountId,
      });

      for (const v of data.videos ?? []) {
        const tsRaw = v.create_time;
        const ts = tsRaw ? new Date(Number(tsRaw) * 1000) : null;
        if (opts.since && ts && ts < opts.since) continue;
        if (opts.until && ts && ts > opts.until) continue;
        collected.push(videoToContent(v));
        if (collected.length >= limit) break;
      }

      if (!data.has_more || data.cursor === undefined) break;
      cursor = data.cursor;
    }

    return collected;
  }
}
