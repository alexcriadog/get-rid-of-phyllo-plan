// YoutubeClient — single chokepoint for YouTube Data API v3 + Analytics API v2.
//
// Mirrors threads-api/threads-client.ts in shape: bind(strategy) returns a
// BoundYoutubeClient that carries the per-platform RateLimitStrategy. Each
// call:
//   1. Acquires the rate bucket (cost varies per endpoint — Data API v3
//      counts in "units" against a 10 000/day project quota).
//   2. Builds a fresh OAuth2Client per call (cheap; just holds the access
//      token — refresh is handled out of band by YoutubeTokenRefreshService
//      which the adapter calls before each fetch).
//   3. Times the call, persists raw response in Mongo (success or error),
//      observes metrics, maps errors to typed adapter exceptions.

import { Injectable, Logger } from '@nestjs/common';
import { google, youtube_v3, youtubeAnalytics_v2 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { MongoService } from '@shared/database/mongo.service';
import { RateBucketService } from '@shared/redis/rate-bucket.service';
import { MetricsService } from '@shared/metrics/metrics.service';
import {
  PlatformAdapterContext,
  RateLimitedError,
} from '../platform-adapter.port';
import type { RateLimitStrategy } from '../meta-graph/rate-limit-strategy.port';
import { persistRaw } from '../meta-graph/graph-raw-archive';
import { mapYoutubeError } from './youtube-errors';
import type {
  YoutubeAnalyticsReport,
  YoutubeChannel,
  YoutubeCommentThread,
  YoutubeListResponse,
  YoutubePlaylistItem,
  YoutubeVideo,
} from './youtube-types';

const PLATFORM_NAME = 'youtube';

const COST_CHANNELS_LIST = 1;
const COST_PLAYLIST_ITEMS_LIST = 1;
const COST_VIDEOS_LIST = 1;
const COST_COMMENT_THREADS_LIST = 1;
const COST_ANALYTICS_QUERY = 1;

const VIDEOS_LIST_BATCH_MAX = 50;
const QUOTA_FLOOR_UNITS = 50;

export interface YoutubeCallContext {
  accessToken: string;
  context: PlatformAdapterContext;
  accountId?: bigint;
}

export interface ListChannelsArgs extends YoutubeCallContext {
  parts: string[];
  mine?: boolean;
  ids?: string[];
}

export interface ListPlaylistItemsArgs extends YoutubeCallContext {
  playlistId: string;
  pageToken?: string;
  maxResults?: number;
}

export interface ListVideosArgs extends YoutubeCallContext {
  ids: string[];
  parts: string[];
}

export interface ListCommentThreadsArgs extends YoutubeCallContext {
  videoId?: string;
  allThreadsRelatedToChannelId?: string;
  pageToken?: string;
  maxResults?: number;
  order?: 'time' | 'relevance';
}

export interface AnalyticsQueryArgs extends YoutubeCallContext {
  ids: string;
  startDate: string;
  endDate: string;
  metrics: string;
  dimensions?: string;
  filters?: string;
  sort?: string;
  maxResults?: number;
  startIndex?: number;
  currency?: string;
}

@Injectable()
export class YoutubeClient {
  constructor(
    private readonly rateBucket: RateBucketService,
    private readonly mongo: MongoService,
    private readonly metrics: MetricsService,
  ) {}

  bind(strategy: RateLimitStrategy): BoundYoutubeClient {
    return new BoundYoutubeClient(
      strategy,
      this.rateBucket,
      this.mongo,
      this.metrics,
    );
  }
}

export class BoundYoutubeClient {
  private readonly logger = new Logger(`YoutubeClient[${PLATFORM_NAME}]`);

  constructor(
    private readonly strategy: RateLimitStrategy,
    private readonly rateBucket: RateBucketService,
    private readonly mongo: MongoService,
    private readonly metrics: MetricsService,
  ) {}

  // ---------------- Data API v3 ----------------

  async listChannels(
    args: ListChannelsArgs,
  ): Promise<YoutubeListResponse<YoutubeChannel>> {
    const params: youtube_v3.Params$Resource$Channels$List = {
      part: args.parts,
      mine: args.mine,
      id: args.ids,
    };
    return this.dataCall('/channels', COST_CHANNELS_LIST, args, async (yt) => {
      const res = await yt.channels.list(params);
      return res.data as YoutubeListResponse<YoutubeChannel>;
    });
  }

  async listPlaylistItems(
    args: ListPlaylistItemsArgs,
  ): Promise<YoutubeListResponse<YoutubePlaylistItem>> {
    const params: youtube_v3.Params$Resource$Playlistitems$List = {
      part: ['snippet', 'contentDetails'],
      playlistId: args.playlistId,
      maxResults: args.maxResults ?? 50,
      pageToken: args.pageToken,
    };
    return this.dataCall(
      '/playlistItems',
      COST_PLAYLIST_ITEMS_LIST,
      args,
      async (yt) => {
        const res = await yt.playlistItems.list(params);
        return res.data as YoutubeListResponse<YoutubePlaylistItem>;
      },
    );
  }

  async listVideos(
    args: ListVideosArgs,
  ): Promise<YoutubeListResponse<YoutubeVideo>> {
    if (args.ids.length === 0) return { items: [] };
    if (args.ids.length > VIDEOS_LIST_BATCH_MAX) {
      throw new Error(
        `listVideos: max ${VIDEOS_LIST_BATCH_MAX} IDs per call, got ${args.ids.length} — caller must batch.`,
      );
    }
    const params: youtube_v3.Params$Resource$Videos$List = {
      part: args.parts,
      id: args.ids,
      maxResults: VIDEOS_LIST_BATCH_MAX,
    };
    return this.dataCall('/videos', COST_VIDEOS_LIST, args, async (yt) => {
      const res = await yt.videos.list(params);
      return res.data as YoutubeListResponse<YoutubeVideo>;
    });
  }

  async listCommentThreads(
    args: ListCommentThreadsArgs,
  ): Promise<YoutubeListResponse<YoutubeCommentThread>> {
    const params: youtube_v3.Params$Resource$Commentthreads$List = {
      part: ['snippet', 'replies'],
      videoId: args.videoId,
      allThreadsRelatedToChannelId: args.allThreadsRelatedToChannelId,
      maxResults: args.maxResults ?? 100,
      order: args.order ?? 'time',
      pageToken: args.pageToken,
      textFormat: 'plainText',
    };
    return this.dataCall(
      '/commentThreads',
      COST_COMMENT_THREADS_LIST,
      args,
      async (yt) => {
        const res = await yt.commentThreads.list(params);
        return res.data as YoutubeListResponse<YoutubeCommentThread>;
      },
    );
  }

  // ---------------- Analytics API v2 ----------------

  async analyticsQuery(args: AnalyticsQueryArgs): Promise<YoutubeAnalyticsReport> {
    const endpoint = '/analytics/reports';
    const acquired = await this.acquire(args.context, COST_ANALYTICS_QUERY);

    const oauth = this.buildOAuth(args.accessToken);
    const ya = google.youtubeAnalytics({ version: 'v2', auth: oauth });
    const params: youtubeAnalytics_v2.Params$Resource$Reports$Query = {
      ids: args.ids,
      startDate: args.startDate,
      endDate: args.endDate,
      metrics: args.metrics,
      dimensions: args.dimensions,
      filters: args.filters,
      sort: args.sort,
      maxResults: args.maxResults,
      startIndex: args.startIndex,
      currency: args.currency,
    };

    const started = Date.now();
    try {
      const res = await ya.reports.query(params);
      const data = res.data as YoutubeAnalyticsReport;
      await this.observeAndPersist(
        endpoint,
        args.accountId,
        acquired.bucketKey,
        acquired.tokensRemaining,
        200,
        Date.now() - started,
        data,
      );
      return data;
    } catch (err: unknown) {
      const status = pickStatus(err) ?? 0;
      await this.observeAndPersist(
        endpoint,
        args.accountId,
        acquired.bucketKey,
        acquired.tokensRemaining,
        status,
        Date.now() - started,
        pickBody(err) ?? { error: messageOf(err) },
      );
      throw mapYoutubeError(PLATFORM_NAME, endpoint, err, acquired.bucketKey);
    }
  }

  // ---------------- internals ----------------

  private async dataCall<T>(
    endpoint: string,
    cost: number,
    args: YoutubeCallContext,
    invoke: (yt: youtube_v3.Youtube) => Promise<T>,
  ): Promise<T> {
    const acquired = await this.acquire(args.context, cost);
    if (acquired.tokensRemaining < QUOTA_FLOOR_UNITS) {
      this.logger.warn(
        `Data API quota approaching floor (${acquired.tokensRemaining} units left)`,
      );
    }
    const oauth = this.buildOAuth(args.accessToken);
    const yt = google.youtube({ version: 'v3', auth: oauth });
    const started = Date.now();
    try {
      const data = await invoke(yt);
      await this.observeAndPersist(
        endpoint,
        args.accountId,
        acquired.bucketKey,
        acquired.tokensRemaining,
        200,
        Date.now() - started,
        data,
      );
      return data;
    } catch (err: unknown) {
      const status = pickStatus(err) ?? 0;
      await this.observeAndPersist(
        endpoint,
        args.accountId,
        acquired.bucketKey,
        acquired.tokensRemaining,
        status,
        Date.now() - started,
        pickBody(err) ?? { error: messageOf(err) },
      );
      throw mapYoutubeError(PLATFORM_NAME, endpoint, err, acquired.bucketKey);
    }
  }

  private buildOAuth(accessToken: string): OAuth2Client {
    const client = new OAuth2Client();
    client.setCredentials({ access_token: accessToken });
    return client;
  }

  private async acquire(
    context: PlatformAdapterContext,
    cost: number,
  ): Promise<{ bucketKey: string; tokensRemaining: number }> {
    const hints = this.strategy.hints(context).map((h) =>
      h.scope === 'daily_quota' ? { ...h, costPerCall: cost } : h,
    );
    const acquireCtx: Record<string, string> = {};
    if (context.tokenHash) acquireCtx['hash'] = context.tokenHash;
    if (context.channelId) acquireCtx['channel_id'] = context.channelId;
    const acquired = await this.rateBucket.acquire(hints, acquireCtx);
    if (!acquired.allowed) {
      this.metrics.incr('acquire_total', {
        scope: acquired.bucketKey,
        result: 'denied',
      });
      throw new RateLimitedError(
        PLATFORM_NAME,
        acquired.resetInMs,
        acquired.bucketKey,
      );
    }
    this.metrics.incr('acquire_total', {
      scope: acquired.bucketKey,
      result: 'allowed',
    });
    return { bucketKey: acquired.bucketKey, tokensRemaining: acquired.tokensRemaining };
  }

  private async observeAndPersist(
    endpoint: string,
    accountId: bigint | undefined,
    bucketKey: string,
    bucketBefore: number,
    status: number,
    durationMs: number,
    body: unknown,
  ): Promise<void> {
    const bucketAfterState = await this.rateBucket.getState(bucketKey);
    const bucketAfter = bucketAfterState?.tokens ?? null;
    this.metrics.observeApiCall({
      platform: PLATFORM_NAME,
      endpoint,
      method: 'GET',
      status,
      durationMs,
      bucketBefore,
      bucketAfter,
      usageHeader: null,
      accountId: accountId ?? null,
      rateBucketKey: bucketKey,
    });
    await persistRaw(this.mongo, PLATFORM_NAME, body, endpoint, accountId ?? null, status);
  }
}

function pickStatus(err: unknown): number | undefined {
  const e = err as { response?: { status?: number } };
  return e?.response?.status;
}

function pickBody(err: unknown): unknown {
  const e = err as { response?: { data?: unknown } };
  return e?.response?.data;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : JSON.stringify(err);
}
