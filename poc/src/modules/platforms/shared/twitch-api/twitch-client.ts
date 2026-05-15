// TwitchClient — single chokepoint for Helix API + OAuth2 validate.
//
// Mirrors youtube-client.ts shape: bind(strategy) returns a BoundTwitchClient
// carrying the per-platform RateLimitStrategy. Each call:
//   1. Acquires the rate bucket (Helix uses a points system; one point per
//      Helix call for the endpoints we use).
//   2. Issues a single axios GET with `Client-Id` + `Authorization: Bearer`.
//   3. Times the call, archives raw response (Mongo), observes metrics,
//      maps errors to typed adapter exceptions.
//
// Token refresh is out of band — TwitchTokenRefreshService runs first when
// the adapter calls `freshToken()`.

import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError, type AxiosInstance } from 'axios';
import { MongoService } from '@shared/database/mongo.service';
import { RateBucketService } from '@shared/redis/rate-bucket.service';
import { MetricsService } from '@shared/metrics/metrics.service';
import { ConfigService } from '@nestjs/config';
import {
  PlatformAdapterContext,
  RateLimitedError,
} from '../platform-adapter.port';
import type { RateLimitStrategy } from '../meta-graph/rate-limit-strategy.port';
import { persistRaw } from '../meta-graph/graph-raw-archive';
import { mapTwitchError } from './twitch-errors';
import type {
  TwitchChannel,
  TwitchClip,
  TwitchFollowersResponse,
  TwitchGame,
  TwitchListResponse,
  TwitchSubscriptionsResponse,
  TwitchUser,
  TwitchValidateResponse,
  TwitchVideo,
} from './twitch-types';

const PLATFORM_NAME = 'twitch';
const HELIX_BASE = 'https://api.twitch.tv/helix';
const OAUTH_VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const REQUEST_TIMEOUT_MS = 15_000;

// Helix counts in "points" against the app token bucket; every documented
// endpoint we hit costs 1 point. Reserve the constant so a future expensive
// endpoint can override it without touching the call shape.
const COST_PER_CALL = 1;

export interface TwitchCallContext {
  accessToken: string;
  context: PlatformAdapterContext;
  accountId?: bigint;
}

export interface GetUsersArgs extends TwitchCallContext {
  /** Either ids OR logins; mutually exclusive at the API level. Empty array
   * means "the authenticated user". */
  ids?: string[];
  logins?: string[];
}

export interface GetChannelArgs extends TwitchCallContext {
  broadcasterId: string;
}

export interface GetFollowersArgs extends TwitchCallContext {
  broadcasterId: string;
  /** Helix follower endpoint requires moderator_id query param; for self-
   * access this is the broadcaster_id. */
  moderatorId: string;
  first?: number;
  after?: string;
}

export interface GetSubscriptionsArgs extends TwitchCallContext {
  broadcasterId: string;
  first?: number;
  after?: string;
}

export interface GetVideosArgs extends TwitchCallContext {
  userId: string;
  /** 'archive' for past broadcasts (VODs), 'highlight' for clipped, 'upload'
   * for manually uploaded. Defaults to 'archive'. */
  type?: 'all' | 'archive' | 'highlight' | 'upload';
  first?: number;
  after?: string;
}

export interface GetClipsArgs extends TwitchCallContext {
  broadcasterId: string;
  /** RFC 3339 timestamps. When both omitted Helix returns clips of all time. */
  startedAt?: string;
  endedAt?: string;
  first?: number;
  after?: string;
}

export interface GetGamesArgs extends TwitchCallContext {
  ids: string[];
}

@Injectable()
export class TwitchClient {
  constructor(
    private readonly rateBucket: RateBucketService,
    private readonly mongo: MongoService,
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  bind(strategy: RateLimitStrategy): BoundTwitchClient {
    const clientId = this.config.get<string>('TWITCH_CLIENT_ID');
    if (!clientId) {
      throw new Error(
        'TWITCH_CLIENT_ID is not configured. Helix calls require Client-Id header.',
      );
    }
    return new BoundTwitchClient(
      strategy,
      this.rateBucket,
      this.mongo,
      this.metrics,
      clientId,
    );
  }
}

export class BoundTwitchClient {
  private readonly logger = new Logger(`TwitchClient[${PLATFORM_NAME}]`);
  private readonly http: AxiosInstance;

  constructor(
    private readonly strategy: RateLimitStrategy,
    private readonly rateBucket: RateBucketService,
    private readonly mongo: MongoService,
    private readonly metrics: MetricsService,
    private readonly clientId: string,
  ) {
    this.http = axios.create({
      baseURL: HELIX_BASE,
      timeout: REQUEST_TIMEOUT_MS,
      // Disable axios's automatic proxy resolution. Some dev environments
      // (OrbStack, in particular) inject HTTPS_PROXY=http://...orb.internal:*
      // into every container — axios honors it and routes through the
      // proxy, but that local proxy does not implement HTTPS CONNECT
      // tunneling properly. Twitch's edge then returns "400 The plain HTTP
      // request was sent to HTTPS port", or the connection drops with
      // ECONNRESET ("socket hang up"). Bypassing the proxy here keeps Helix
      // calls direct over TLS.
      proxy: false,
    });
  }

  async getUsers(args: GetUsersArgs): Promise<TwitchListResponse<TwitchUser>> {
    const params: Record<string, string | string[]> = {};
    if (args.ids?.length) params['id'] = args.ids;
    if (args.logins?.length) params['login'] = args.logins;
    return this.helixGet('/users', args, params);
  }

  async getChannel(
    args: GetChannelArgs,
  ): Promise<TwitchListResponse<TwitchChannel>> {
    return this.helixGet('/channels', args, {
      broadcaster_id: args.broadcasterId,
    });
  }

  async getFollowers(args: GetFollowersArgs): Promise<TwitchFollowersResponse> {
    const params: Record<string, string | number> = {
      broadcaster_id: args.broadcasterId,
      moderator_id: args.moderatorId,
      first: args.first ?? 1,
    };
    if (args.after) params['after'] = args.after;
    return this.helixGet('/channels/followers', args, params);
  }

  async getSubscriptions(
    args: GetSubscriptionsArgs,
  ): Promise<TwitchSubscriptionsResponse> {
    const params: Record<string, string | number> = {
      broadcaster_id: args.broadcasterId,
      first: args.first ?? 100,
    };
    if (args.after) params['after'] = args.after;
    return this.helixGet('/subscriptions', args, params);
  }

  async getVideos(args: GetVideosArgs): Promise<TwitchListResponse<TwitchVideo>> {
    const params: Record<string, string | number> = {
      user_id: args.userId,
      type: args.type ?? 'archive',
      first: args.first ?? 50,
    };
    if (args.after) params['after'] = args.after;
    return this.helixGet('/videos', args, params);
  }

  async getClips(args: GetClipsArgs): Promise<TwitchListResponse<TwitchClip>> {
    const params: Record<string, string | number> = {
      broadcaster_id: args.broadcasterId,
      first: args.first ?? 50,
    };
    if (args.startedAt) params['started_at'] = args.startedAt;
    if (args.endedAt) params['ended_at'] = args.endedAt;
    if (args.after) params['after'] = args.after;
    return this.helixGet('/clips', args, params);
  }

  async getGames(args: GetGamesArgs): Promise<TwitchListResponse<TwitchGame>> {
    if (args.ids.length === 0) return { data: [] };
    return this.helixGet('/games', args, { id: args.ids });
  }

  /**
   * Twitch requires app + user tokens to be validated at least once per hour.
   * The validate endpoint also returns the canonical user_id / login the
   * token was issued for — useful for connect-tool discovery.
   */
  async validateToken(accessToken: string): Promise<TwitchValidateResponse> {
    try {
      const res = await axios.get<TwitchValidateResponse>(OAUTH_VALIDATE_URL, {
        headers: { Authorization: `OAuth ${accessToken}` },
        timeout: REQUEST_TIMEOUT_MS,
        proxy: false,
      });
      return res.data;
    } catch (err) {
      throw mapTwitchError(PLATFORM_NAME, '/oauth2/validate', err, 'oauth_validate');
    }
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private async helixGet<T>(
    endpoint: string,
    args: TwitchCallContext,
    params: Record<string, string | string[] | number>,
  ): Promise<T> {
    const acquired = await this.acquire(args.context, COST_PER_CALL);
    const started = Date.now();
    try {
      const res = await this.http.get<T>(endpoint, {
        params,
        paramsSerializer: { indexes: null },
        headers: {
          'Client-Id': this.clientId,
          Authorization: `Bearer ${args.accessToken}`,
        },
      });
      await this.observeAndPersist(
        endpoint,
        args.accountId,
        acquired.bucketKey,
        acquired.tokensRemaining,
        res.status,
        Date.now() - started,
        res.data,
      );
      return res.data;
    } catch (err: unknown) {
      const ax = err as AxiosError;
      const status = ax.response?.status ?? 0;
      await this.observeAndPersist(
        endpoint,
        args.accountId,
        acquired.bucketKey,
        acquired.tokensRemaining,
        status,
        Date.now() - started,
        ax.response?.data ?? { error: messageOf(err) },
      );
      throw mapTwitchError(PLATFORM_NAME, endpoint, err, acquired.bucketKey);
    }
  }

  private async acquire(
    context: PlatformAdapterContext,
    cost: number,
  ): Promise<{ bucketKey: string; tokensRemaining: number }> {
    const hints = this.strategy.hints(context).map((h) => ({
      ...h,
      costPerCall: cost,
    }));
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
    return {
      bucketKey: acquired.bucketKey,
      tokensRemaining: acquired.tokensRemaining,
    };
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
    await persistRaw(
      this.mongo,
      PLATFORM_NAME,
      body,
      endpoint,
      accountId ?? null,
      status,
    );
  }
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : JSON.stringify(err);
}
