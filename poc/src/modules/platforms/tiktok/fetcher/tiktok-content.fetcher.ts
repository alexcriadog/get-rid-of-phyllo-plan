// TikTok content (videos) fetcher. v1.3.
//
// /business/video/list/ exposes a much wider field set than the public docs
// suggest — verified live 2026-04-29. We pull the full premium set in a
// single call: basic counters, deep insights (reach, watch time, completion
// rate), traffic sources, retention curve, per-post audience demographics,
// CTAs, and the official embed_url for in-UI playback.
//
// /business/video/get/ and /business/video/insights/ DO NOT EXIST for our
// BC organic token — but it doesn't matter, all those metrics are right
// here on the list endpoint.

import { Inject, Injectable } from '@nestjs/common';
import type { ContentData, FetchOpts } from '../../shared/platform-types';
import type { BoundTikTokClient, TikTokVideo } from '../../shared/tiktok-api';
import { extractAccountId } from '../../shared/tiktok-api';
import { videoToContent } from '../mapper/tiktok-video.mapper';
import { DEFAULT_PAGE_SIZE } from '../tiktok.constants';
import { buildTikTokContext } from '../tiktok.context';
import { TIKTOK_API_CLIENT } from '../tiktok.tokens';

const LIST_FIELDS = [
  // Core
  'item_id',
  'caption',
  'create_time',
  'thumbnail_url',
  'share_url',
  'embed_url',
  'media_type',
  'is_ad',
  'video_duration',
  // Basic counters
  'video_views',
  'likes',
  'comments',
  'shares',
  'favorites',
  // Deep insights
  'reach',
  'total_time_watched',
  'average_time_watched',
  'full_video_watched_rate',
  'impression_sources',
  'video_view_retention',
  'engagement_likes',
  // Per-post audience
  'audience_countries',
  'audience_cities',
  'audience_genders',
  'audience_types',
  // Profile lift
  'profile_views',
  'new_followers',
  // CTAs
  'website_clicks',
  'email_clicks',
  'phone_number_clicks',
  'address_clicks',
  'app_download_clicks',
  'lead_submissions',
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
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    const ctx = buildTikTokContext(accessToken, canonicalId, metadata);
    const accountId = extractAccountId(metadata);
    const limit = opts.limit ?? DEFAULT_PAGE_SIZE;
    const collected: ContentData[] = [];
    let cursor: number | undefined;

    // /business/video/list/ returns videos by create_time DESCENDING. So
    // once a single post falls below `opts.since`, every following post is
    // older too — we can stop paginating instead of walking the entire
    // history. Saves N pages × 1 call each on incremental syncs.
    let stopOnAge = false;
    while (collected.length < limit && !stopOnAge) {
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
        if (opts.since && ts && ts < opts.since) {
          stopOnAge = true;
          break;
        }
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
