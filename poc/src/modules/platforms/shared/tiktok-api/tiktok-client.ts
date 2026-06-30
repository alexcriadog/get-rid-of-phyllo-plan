// TikTokClient — single chokepoint for TikTok Business API v1.3.
// Verified against live probes 2026-04-29.
//
// Contract differences vs the Meta GraphClient:
//   - Auth via `Access-Token: <token>` header (not Bearer).
//   - HTTP 200 ≠ success; success means `body.code === 0`.
//   - Field lists go as JSON-array strings in the `fields` query param,
//     e.g. `fields=["display_name","username"]`.
//   - Most reads are GET; some endpoints accept POST with a JSON body.

import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError, AxiosInstance, AxiosResponse } from 'axios';
import { MongoService } from '@shared/database/mongo.service';
import { RateBucketService } from '@shared/redis/rate-bucket.service';
import { MetricsService } from '@shared/metrics/metrics.service';
import {
  AdapterFetchError,
  PlatformAdapterContext,
  RateLimitedError,
  TokenRevokedError,
} from '../platform-adapter.port';
import {
  extractTikTokError,
  isOk,
  isQuotaError,
  isTokenError,
} from './tiktok-errors';
import { persistRaw } from './tiktok-raw-archive';
import type { TikTokRateLimitStrategyPort } from './rate-limit-strategy.port';
import type { TikTokV13Envelope } from './tiktok-types';

const TIKTOK_BASE = 'https://business-api.tiktok.com/open_api/v1.3';
const DEFAULT_TIMEOUT_MS = 30_000;

export interface TikTokCallOpts {
  /** Path under /open_api/v1.3 — e.g. `/business/get/`. */
  endpoint: string;
  method?: 'GET' | 'POST';
  /** When set, serialised as `fields=["a","b",...]` query param. */
  fields?: string[];
  /** Body for POST calls. */
  body?: Record<string, unknown>;
  /** Extra query params (the chokepoint adds business_id when context.businessId set). */
  query?: Record<string, string | number | undefined>;
  accessToken: string;
  context: PlatformAdapterContext & { businessId: string };
  accountId?: bigint;
}

@Injectable()
export class TikTokClient {
  private readonly http: AxiosInstance;

  constructor(
    private readonly rateBucket: RateBucketService,
    private readonly mongo: MongoService,
    private readonly metrics: MetricsService,
  ) {
    this.http = axios.create({
      baseURL: TIKTOK_BASE,
      timeout: DEFAULT_TIMEOUT_MS,
      validateStatus: () => true,
    });
  }

  bind(strategy: TikTokRateLimitStrategyPort): BoundTikTokClient {
    return new BoundTikTokClient(
      strategy,
      this.http,
      this.rateBucket,
      this.mongo,
      this.metrics,
    );
  }
}

export class BoundTikTokClient {
  private readonly logger = new Logger('TikTokClient');

  constructor(
    private readonly strategy: TikTokRateLimitStrategyPort,
    private readonly http: AxiosInstance,
    private readonly rateBucket: RateBucketService,
    private readonly mongo: MongoService,
    private readonly metrics: MetricsService,
  ) {}

  async call<T>(opts: TikTokCallOpts): Promise<T> {
    const hints = this.strategy.hints({
      ...opts.context,
      businessId: opts.context.businessId,
    });
    const acquireCtx: Record<string, string> = {};
    if (opts.context.tokenHash) acquireCtx['hash'] = opts.context.tokenHash;
    if (opts.context.channelId) acquireCtx['channel_id'] = opts.context.channelId;
    if (opts.context.businessId) acquireCtx['business_id'] = opts.context.businessId;

    const acquired = await this.rateBucket.acquire(hints, acquireCtx);
    if (!acquired.allowed) {
      this.metrics.incr('acquire_total', {
        scope: acquired.bucketKey,
        result: 'denied',
      });
      throw new RateLimitedError('tiktok', acquired.resetInMs, acquired.bucketKey);
    }
    this.metrics.incr('acquire_total', {
      scope: acquired.bucketKey,
      result: 'allowed',
    });

    const bucketBefore = acquired.tokensRemaining;
    const started = Date.now();
    const method = opts.method ?? 'GET';
    const params = this.buildQuery(opts);

    let response: AxiosResponse;
    try {
      response = await this.http.request({
        url: opts.endpoint,
        method,
        params,
        data: method === 'POST' ? (opts.body ?? {}) : undefined,
        headers: {
          'Access-Token': opts.accessToken,
          'Content-Type': 'application/json',
        },
      });
    } catch (err: unknown) {
      const durationMs = Date.now() - started;
      const axErr = err as AxiosError;
      this.metrics.observeApiCall({
        platform: 'tiktok',
        endpoint: opts.endpoint,
        method,
        status: axErr.response?.status ?? 0,
        durationMs,
        bucketBefore,
        bucketAfter: null,
        usageHeader: null,
        accountId: opts.accountId ?? null,
        rateBucketKey: acquired.bucketKey,
      });
      throw new AdapterFetchError(
        'tiktok',
        opts.endpoint,
        err,
        undefined,
        axErr.response?.data,
      );
    }

    const durationMs = Date.now() - started;
    const bucketAfterState = await this.rateBucket.getState(acquired.bucketKey);
    const bucketAfter = bucketAfterState?.tokens ?? null;

    this.metrics.observeApiCall({
      platform: 'tiktok',
      endpoint: opts.endpoint,
      method,
      status: response.status,
      durationMs,
      bucketBefore,
      bucketAfter,
      usageHeader: null,
      accountId: opts.accountId ?? null,
      rateBucketKey: acquired.bucketKey,
    });

    const body = response.data as Partial<TikTokV13Envelope<T>> | undefined;
    const tikTokCode = typeof body?.code === 'number' ? body.code : null;

    await persistRaw(
      this.mongo,
      body,
      opts.endpoint,
      opts.accountId ?? null,
      response.status,
      tikTokCode,
    );

    if (response.status === 429) {
      const retryAfter = Number(response.headers['retry-after']) || 60;
      throw new RateLimitedError(
        'tiktok',
        retryAfter * 1000,
        acquired.bucketKey,
        `Platform 429 on ${opts.endpoint}`,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new TokenRevokedError('tiktok', opts.endpoint);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new AdapterFetchError(
        'tiktok',
        opts.endpoint,
        new Error(`HTTP ${response.status}`),
        `TikTok API returned ${response.status} for ${opts.endpoint}`,
        body,
      );
    }

    if (!isOk(tikTokCode ?? undefined)) {
      const errMsg = extractTikTokError({ body });
      if (isTokenError(tikTokCode ?? undefined)) {
        throw new TokenRevokedError('tiktok', opts.endpoint);
      }
      if (isQuotaError(tikTokCode ?? undefined)) {
        throw new RateLimitedError(
          'tiktok',
          60 * 60 * 1000,
          acquired.bucketKey,
          `Platform quota on ${opts.endpoint}`,
        );
      }
      throw new AdapterFetchError(
        'tiktok',
        opts.endpoint,
        new Error(errMsg),
        `TikTok app-level error: ${errMsg}`,
        body,
      );
    }

    return (body as TikTokV13Envelope<T>).data;
  }

  private buildQuery(opts: TikTokCallOpts): Record<string, string | number> | undefined {
    const out: Record<string, string | number> = {};
    out['business_id'] = opts.context.businessId;
    if (opts.fields && opts.fields.length > 0) {
      out['fields'] = JSON.stringify(opts.fields);
    }
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v === undefined) continue;
        out[k] = v;
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
}
