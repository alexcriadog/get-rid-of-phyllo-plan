// Twitch content fetcher (engagement_new).
//
// Pipeline:
//   1. GET /videos?user_id=&type=archive&first=50 — past broadcasts (VODs).
//      Cost: 1 Helix point.
//   2. GET /clips?broadcaster_id=&started_at=&first=50 — clips of the last
//      `CLIP_WINDOW_DAYS` days. Cost: 1 point.
//   3. Merge, sort by publishedAt DESC, cap at opts.limit.
//
// We deliberately don't paginate further. The schedule (every 4h) plus a
// 50-item window covers the typical creator workflow — long-term archival
// is out of scope for v1.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ContentData, FetchOpts } from '../../shared/platform-types';
import type {
  BoundTwitchClient,
  TwitchCallContext,
} from '../../shared/twitch-api/twitch-client';
import { extractAccountId } from '../../shared/meta-graph';
import { buildTwitchContext } from '../twitch.context';
import { clipToContent, videoToContent } from '../mapper/twitch-content.mapper';
import { TWITCH_API_CLIENT } from '../twitch.tokens';

const DEFAULT_LIMIT = 50;
const CLIP_WINDOW_DAYS = 30;

@Injectable()
export class TwitchContentFetcher {
  private readonly logger = new Logger(TwitchContentFetcher.name);

  constructor(
    @Inject(TWITCH_API_CLIENT)
    private readonly client: BoundTwitchClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    const accountId = extractAccountId(metadata);
    const ctx = buildTwitchContext(accessToken, canonicalId, metadata);
    const callCtx: TwitchCallContext = { accessToken, context: ctx, accountId };
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const broadcasterId = resolveBroadcasterId(canonicalId, metadata);

    const vodsPromise = this.client
      .getVideos({
        ...callCtx,
        userId: broadcasterId,
        type: 'archive',
        first: Math.min(limit, 50),
      })
      .then((r) => r.data ?? [])
      .catch((err) => {
        this.logger.warn(
          `getVideos failed for ${broadcasterId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return [];
      });

    const startedAt = isoNDaysAgo(CLIP_WINDOW_DAYS);
    const clipsPromise = this.client
      .getClips({
        ...callCtx,
        broadcasterId,
        startedAt,
        first: Math.min(limit, 50),
      })
      .then((r) => r.data ?? [])
      .catch((err) => {
        this.logger.warn(
          `getClips failed for ${broadcasterId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return [];
      });

    const [vods, clips] = await Promise.all([vodsPromise, clipsPromise]);

    // Apply opts.since cutoff if the worker passed one (covers re-syncs that
    // only want recent items).
    const since = opts.since;
    const inWindow = (iso: string | null | undefined): boolean => {
      if (!since || !iso) return true;
      const ts = new Date(iso);
      return !Number.isNaN(ts.getTime()) && ts >= since;
    };

    const items: ContentData[] = [];
    for (const v of vods) {
      if (!inWindow(v.published_at ?? v.created_at)) continue;
      items.push(videoToContent(v));
    }
    for (const c of clips) {
      if (!inWindow(c.created_at)) continue;
      items.push(clipToContent(c));
    }

    items.sort((a, b) => {
      const aT = a.publishedAt?.getTime() ?? 0;
      const bT = b.publishedAt?.getTime() ?? 0;
      return bT - aT;
    });
    return items.slice(0, limit);
  }
}

function resolveBroadcasterId(
  canonicalId: string,
  metadata?: Record<string, unknown>,
): string {
  if (metadata && typeof metadata['broadcaster_id'] === 'string') {
    const bid = metadata['broadcaster_id'] as string;
    if (bid) return bid;
  }
  return canonicalId;
}

function isoNDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString();
}
