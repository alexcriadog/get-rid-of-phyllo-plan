// YouTube engagement_deep fetcher.
//
// Per-video drill-down on top of the Analytics API. Resolves a target set
// of video IDs, then fires SEVEN batched analytics queries via
// `filters=video==id1,id2,...` (one HTTP call per dimension, regardless of
// how many videos). Pivots the responses into the canonical
// EngagementDeepSnapshot shape.
//
// Default window: 28 days. Override via metadata.engagementDeepDays.
// The Analytics API has a 24-72h freshness lag so we shift the end date
// back 1 day to avoid querying not-yet-finalized data.
//
// Quota cost per sync: 7 Analytics units (≈ negligible against the 10k/day
// Data API quota and the parallel Analytics QPS bucket).

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import { MongoService } from '@shared/database/mongo.service';
import type { EngagementDeepSnapshot } from '../../shared/platform-types';
import type {
  BoundYoutubeClient,
  YoutubeCallContext,
} from '../../shared/youtube-api/youtube-client';
import type {
  YoutubeAnalyticsReport,
} from '../../shared/youtube-api/youtube-types';
import { extractAccountId } from '../../shared/meta-graph';
import { buildYoutubeContext } from '../youtube.context';
import { YOUTUBE_API_CLIENT } from '../youtube.tokens';
import { rethrowCritical } from '../../shared/fetch-guards';
import { analyticsBundleToEngagementDeep } from '../mapper/engagement-deep.mapper';

const DEFAULT_WINDOW_DAYS = 28;
const RETENTION_WINDOW_DAYS = 90;
const MAX_VIDEOS_PER_SYNC = 50;

const METRICS_FULL = [
  'views',
  'estimatedMinutesWatched',
  'averageViewDuration',
  'averageViewPercentage',
  'likes',
  'dislikes',
  'comments',
  'shares',
  'subscribersGained',
  'subscribersLost',
  'videosAddedToPlaylists',
  'videosRemovedFromPlaylists',
  'engagedViews',
  'cardImpressions',
  'cardClicks',
  'cardClickRate',
  'cardTeaserImpressions',
  'cardTeaserClicks',
  'cardTeaserClickRate',
  'annotationImpressions',
  'annotationClicks',
  'annotationClickThroughRate',
].join(',');

@Injectable()
export class YoutubeEngagementDeepFetcher {
  private readonly logger = new Logger(YoutubeEngagementDeepFetcher.name);

  constructor(
    @Inject(YOUTUBE_API_CLIENT)
    private readonly client: BoundYoutubeClient,
    private readonly prisma: PrismaService,
    private readonly mongo: MongoService,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<EngagementDeepSnapshot> {
    const accountId = extractAccountId(metadata);
    const ctx = buildYoutubeContext(accessToken, canonicalId, metadata);
    const callCtx: YoutubeCallContext = { accessToken, context: ctx, accountId };

    const windowDays = pickPositiveNumber(
      metadata?.['engagementDeepDays'],
      DEFAULT_WINDOW_DAYS,
    );
    const { startDate, endDate } = computeWindow(windowDays);

    const videoIds = await this.resolveVideoIds(accountId, callCtx, metadata);
    if (videoIds.length === 0) {
      this.logger.debug(
        `engagement_deep: no video IDs resolved for canonicalId=${canonicalId}`,
      );
      return {
        periodDays: windowDays,
        items: [],
        retention: null,
        fetchedAt: new Date(),
      };
    }

    const filter = `video==${videoIds.join(',')}`;
    const baseArgs = {
      ...callCtx,
      ids: 'channel==MINE',
      startDate,
      endDate,
      filters: filter,
    } as const;

    const [
      metricsR,
      trafficR,
      countriesR,
      devicesR,
      demoR,
      sharingR,
    ] = await Promise.allSettled([
      this.client.analyticsQuery({
        ...baseArgs,
        metrics: METRICS_FULL,
        dimensions: 'video',
        maxResults: MAX_VIDEOS_PER_SYNC,
      }),
      this.client.analyticsQuery({
        ...baseArgs,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'video,insightTrafficSourceType',
        sort: '-views',
        maxResults: 200,
      }),
      this.client.analyticsQuery({
        ...baseArgs,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'video,country',
        sort: '-views',
        maxResults: 200,
      }),
      this.client.analyticsQuery({
        ...baseArgs,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'video,deviceType',
        sort: '-views',
        maxResults: 200,
      }),
      this.client.analyticsQuery({
        ...baseArgs,
        metrics: 'viewerPercentage',
        dimensions: 'video,ageGroup,gender',
        maxResults: 500,
      }),
      this.client.analyticsQuery({
        ...baseArgs,
        metrics: 'shares',
        dimensions: 'video,sharingService',
        sort: '-shares',
        maxResults: 200,
      }),
    ]);

    const errors: Array<{ bucket: string; message: string }> = [];
    const metricsReport = pick(metricsR, 'metrics', errors);
    const trafficReport = pick(trafficR, 'traffic', errors);
    const countriesReport = pick(countriesR, 'countries', errors);
    const devicesReport = pick(devicesR, 'devices', errors);
    const demoReport = pick(demoR, 'demographics', errors);
    const sharingReport = pick(sharingR, 'sharing', errors);

    // Pick the top-views video for the retention curve (cheap extra call).
    const topVideoId = this.topVideoId(metricsReport, videoIds);
    let retention: EngagementDeepSnapshot['retention'] = null;
    if (topVideoId) {
      try {
        const retentionR = await this.client.analyticsQuery({
          ...callCtx,
          ids: 'channel==MINE',
          startDate: shiftStart(endDate, RETENTION_WINDOW_DAYS),
          endDate,
          metrics: 'audienceWatchRatio,relativeRetentionPerformance',
          dimensions: 'elapsedVideoTimeRatio',
          filters: `video==${topVideoId};audienceType==ORGANIC`,
          sort: 'elapsedVideoTimeRatio',
        });
        retention = {
          contentId: topVideoId,
          periodDays: RETENTION_WINDOW_DAYS,
          points: (retentionR.rows ?? []).map((row) => ({
            elapsedRatio: Number(row[0] ?? 0),
            audienceWatchRatio: Number(row[1] ?? 0),
            relativeRetentionPerformance: Number(row[2] ?? 0),
          })),
        };
      } catch (err) {
        rethrowCritical(err);
        errors.push({
          bucket: 'retention',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const snapshot = analyticsBundleToEngagementDeep({
      videoIds,
      metricsReport,
      trafficReport,
      countriesReport,
      devicesReport,
      demoReport,
      sharingReport,
      retention,
      windowDays,
      errors,
    });

    if (errors.length > 0) {
      this.logger.debug(
        `engagement_deep: ${errors.length} bucket(s) failed: ${errors
          .map((e) => `${e.bucket}=${e.message}`)
          .join('; ')}`,
      );
    }
    return snapshot;
  }

  /**
   * Resolves the video IDs we'll batch-query analytics for. Priority:
   *   1. metadata.engagementDeepVideoIds (caller override).
   *   2. Most-recent N videos from Mongo `posts` collection.
   *   3. Falls back to empty — the worker logs and moves on. The first
   *      run after a fresh connect_tool seed will naturally repopulate
   *      once `engagement_new` has run at least once.
   */
  private async resolveVideoIds(
    accountId: bigint | undefined,
    callCtx: YoutubeCallContext,
    metadata?: Record<string, unknown>,
  ): Promise<string[]> {
    void callCtx;
    const override = metadata?.['engagementDeepVideoIds'];
    if (Array.isArray(override) && override.length > 0) {
      return override
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .slice(0, MAX_VIDEOS_PER_SYNC);
    }
    if (accountId == null) return [];

    // Read the recent content external ids from the canonical `contents`
    // collection (what canonical-write.service stores for engagement_new).
    const col = this.mongo.getCollection('contents');
    const cursor = col
      .find(
        { account_pk: accountId.toString() } as unknown as Prisma.JsonObject,
        { projection: { external_id: 1 } },
      )
      .sort({ published_at: -1, updated_at: -1 })
      .limit(MAX_VIDEOS_PER_SYNC);
    const docs = await cursor.toArray();
    const ids = docs
      .map((d) => (d as { external_id?: unknown }).external_id)
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    return ids;
  }

  private topVideoId(
    metricsReport: YoutubeAnalyticsReport | null,
    fallback: string[],
  ): string | null {
    if (metricsReport?.rows?.length) {
      const headers = (metricsReport.columnHeaders ?? []).map((h) => h.name);
      const videoIdx = headers.indexOf('video');
      const viewsIdx = headers.indexOf('views');
      if (videoIdx >= 0 && viewsIdx >= 0) {
        let best: { id: string; views: number } | null = null;
        for (const row of metricsReport.rows) {
          const id = String(row[videoIdx] ?? '');
          const v = Number(row[viewsIdx] ?? 0);
          if (id && (!best || v > best.views)) best = { id, views: v };
        }
        if (best) return best.id;
      }
    }
    return fallback[0] ?? null;
  }
}

function pick(
  result: PromiseSettledResult<YoutubeAnalyticsReport>,
  bucket: string,
  errors: Array<{ bucket: string; message: string }>,
): YoutubeAnalyticsReport | null {
  if (result.status === 'fulfilled') return result.value;
  // Rate-limit / revoked-token rejections must abort the sync — recording
  // them as a null bucket would blank stored per-video metrics.
  rethrowCritical(result.reason);
  errors.push({
    bucket,
    message:
      result.reason instanceof Error ? result.reason.message : String(result.reason),
  });
  return null;
}

function pickPositiveNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

function computeWindow(periodDays: number): {
  startDate: string;
  endDate: string;
} {
  const end = new Date(Date.now() - 24 * 3_600_000);
  const start = new Date(end.getTime() - periodDays * 86_400_000);
  return {
    startDate: yyyymmdd(start),
    endDate: yyyymmdd(end),
  };
}

function shiftStart(endDate: string, days: number): string {
  const end = new Date(`${endDate}T00:00:00Z`);
  const start = new Date(end.getTime() - days * 86_400_000);
  return yyyymmdd(start);
}

function yyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
