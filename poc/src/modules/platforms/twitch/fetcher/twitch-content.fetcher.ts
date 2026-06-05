// Twitch content fetcher (engagement_new).
//
// Pipeline:
//   1. GET /videos?user_id=&type=archive&first=50 — past broadcasts (VODs).
//      Cost: 1 Helix point. Note: Twitch only returns archived VODs when
//      the broadcaster has "Store past broadcasts" enabled in stream
//      settings — otherwise this returns an empty array even when the
//      channel streams regularly.
//   2. GET /clips?broadcaster_id=&first=50 — top clips. When opts.since is
//      provided we pass `started_at` so the worker can do incremental
//      syncs; otherwise we omit it and Twitch returns the channel's
//      all-time top clips sorted by view count (DESC). Cost: 1 point.
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
import { rethrowCritical } from '../../shared/fetch-guards';
import { buildTwitchContext } from '../twitch.context';
import { clipToContent, videoToContent } from '../mapper/twitch-content.mapper';
import { TWITCH_API_CLIENT } from '../twitch.tokens';

const DEFAULT_LIMIT = 50;

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
        rethrowCritical(err);
        this.logger.warn(
          `getVideos failed for ${broadcasterId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return [];
      });

    // Only pass `started_at` when the worker asked for an incremental
    // window. For a full sync (opts.since undefined), letting Twitch
    // return top-by-views clips of all time means small streamers with
    // sparse recent activity still see their best clips.
    //
    // Twitch's /clips endpoint REQUIRES `ended_at` whenever `started_at`
    // is provided — without it the response silently comes back with
    // `data: []` even when matching clips exist (we hit this in prod
    // before adding the explicit ended_at). When started_at is omitted,
    // ended_at must also be omitted and Twitch returns top-by-views
    // clips of all time.
    const startedAt = opts.since ? opts.since.toISOString() : undefined;
    const endedAt = startedAt ? new Date().toISOString() : undefined;
    const clipsPromise = this.client
      .getClips({
        ...callCtx,
        broadcasterId,
        startedAt,
        endedAt,
        first: Math.min(limit, 50),
      })
      .then((r) => r.data ?? [])
      .catch((err) => {
        rethrowCritical(err);
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
