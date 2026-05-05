// YouTube content fetcher.
//
// Pipeline:
//   1. Resolve uploads playlist ID from account.metadata; fall back to
//      channels.list (1 unit) if missing.
//   2. Paginate playlistItems.list (1 unit/page, 50/page) until limit or
//      since-window cutoff.
//   3. Batch video IDs in chunks of 50 → videos.list (1 unit/batch) for
//      stats + contentDetails + status + liveStreamingDetails.
//   4. Map each video → ContentData.
//
// Cost for a 1k-video channel with no cache miss: ~41 units.

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import type { ContentData, FetchOpts } from '../../shared/platform-types';
import type {
  BoundYoutubeClient,
  YoutubeCallContext,
} from '../../shared/youtube-api/youtube-client';
import { extractAccountId } from '../../shared/meta-graph';
import { buildYoutubeContext } from '../youtube.context';
import { videoToContent } from '../mapper/video-to-content.mapper';
import { YOUTUBE_API_CLIENT } from '../youtube.tokens';

const VIDEO_PARTS = [
  'snippet',
  'statistics',
  'contentDetails',
  'status',
  'liveStreamingDetails',
];
const VIDEOS_BATCH = 50;
const DEFAULT_LIMIT = 50;

@Injectable()
export class YoutubeContentFetcher {
  private readonly logger = new Logger(YoutubeContentFetcher.name);

  constructor(
    @Inject(YOUTUBE_API_CLIENT)
    private readonly client: BoundYoutubeClient,
    private readonly prisma: PrismaService,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    const accountId = extractAccountId(metadata);
    const ctx = buildYoutubeContext(accessToken, canonicalId, metadata);
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const callCtx: YoutubeCallContext = { accessToken, context: ctx, accountId };

    const uploadsPlaylistId = await this.resolveUploadsPlaylistId(
      accountId,
      callCtx,
      metadata,
    );
    if (!uploadsPlaylistId) {
      this.logger.warn(
        `no uploads playlist id resolved for canonicalId=${canonicalId}; returning empty`,
      );
      return [];
    }

    const videoIds = await this.collectVideoIds(uploadsPlaylistId, limit, opts, callCtx);
    if (videoIds.length === 0) return [];

    const enriched: ContentData[] = [];
    for (let i = 0; i < videoIds.length; i += VIDEOS_BATCH) {
      const slice = videoIds.slice(i, i + VIDEOS_BATCH);
      const body = await this.client.listVideos({
        ...callCtx,
        ids: slice,
        parts: VIDEO_PARTS,
      });
      for (const v of body.items ?? []) {
        enriched.push(videoToContent(v));
      }
    }

    enriched.sort((a, b) => {
      const aT = a.publishedAt?.getTime() ?? 0;
      const bT = b.publishedAt?.getTime() ?? 0;
      return bT - aT;
    });
    return enriched.slice(0, limit);
  }

  private async resolveUploadsPlaylistId(
    accountId: bigint | undefined,
    callCtx: YoutubeCallContext,
    metadata?: Record<string, unknown>,
  ): Promise<string | null> {
    const fromMeta =
      metadata && typeof metadata['uploads_playlist_id'] === 'string'
        ? (metadata['uploads_playlist_id'] as string)
        : null;
    if (fromMeta) return fromMeta;

    if (accountId != null) {
      const acc = await this.prisma.account.findUnique({
        where: { id: accountId },
        select: { metadata: true },
      });
      const m = acc?.metadata as Prisma.JsonObject | null;
      if (m && typeof m['uploads_playlist_id'] === 'string') {
        return m['uploads_playlist_id'] as string;
      }
    }

    const body = await this.client.listChannels({
      ...callCtx,
      parts: ['contentDetails'],
      mine: true,
    });
    const uploads =
      body.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null;
    if (accountId != null && uploads) {
      await this.persistUploads(accountId, uploads).catch((err) => {
        this.logger.debug(
          `cache uploads_playlist_id failed: ${err instanceof Error ? err.message : err}`,
        );
      });
    }
    return uploads;
  }

  private async collectVideoIds(
    uploadsPlaylistId: string,
    limit: number,
    opts: FetchOpts,
    callCtx: YoutubeCallContext,
  ): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    while (ids.length < limit) {
      const body = await this.client.listPlaylistItems({
        ...callCtx,
        playlistId: uploadsPlaylistId,
        maxResults: 50,
        pageToken,
      });
      const items = body.items ?? [];
      let stoppedEarly = false;
      for (const it of items) {
        const id = it.contentDetails?.videoId ?? it.snippet?.resourceId?.videoId;
        const publishedAt =
          it.contentDetails?.videoPublishedAt ?? it.snippet?.publishedAt;
        if (opts.since && publishedAt) {
          const ts = new Date(publishedAt);
          if (!Number.isNaN(ts.getTime()) && ts < opts.since) {
            stoppedEarly = true;
            break;
          }
        }
        if (id) ids.push(id);
        if (ids.length >= limit) break;
      }
      const next = body.nextPageToken;
      if (!next || stoppedEarly || ids.length >= limit) break;
      pageToken = next;
    }
    return ids;
  }

  private async persistUploads(
    accountId: bigint,
    uploadsPlaylistId: string,
  ): Promise<void> {
    const acc = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { metadata: true },
    });
    const existing =
      acc?.metadata && typeof acc.metadata === 'object'
        ? (acc.metadata as Prisma.JsonObject)
        : {};
    if (existing['uploads_playlist_id'] === uploadsPlaylistId) return;
    await this.prisma.account.update({
      where: { id: accountId },
      data: {
        metadata: {
          ...existing,
          uploads_playlist_id: uploadsPlaylistId,
        } as Prisma.InputJsonValue,
      },
    });
  }
}
