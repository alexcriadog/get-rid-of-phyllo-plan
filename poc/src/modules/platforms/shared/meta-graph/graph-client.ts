// GraphClient — single chokepoint for Meta-family Graph API requests.
// Phase B2 of the platform refactor. See docs/platform-refactor.md §6.2.
//
// Replaces the duplicated `callGraph` private methods that lived in the
// FB and IG adapters. Adapters obtain a `BoundGraphClient` via a per-platform
// factory provider (FACEBOOK_GRAPH_CLIENT / INSTAGRAM_GRAPH_CLIENT) and call
// `client.call({...})` from every fetch site.
//
// Intentional fixes landed here (vs the old per-adapter callGraph):
//   D1 — persistRaw runs BEFORE status throws, so 4xx/5xx error bodies are
//        archived for debugging (FB previously skipped them).
//   D4 — the persistRaw call always provides response.status; the archive
//        document always includes the `httpStatus` field.

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
import { withToken } from './graph-context';
import { parseUsageHeaders } from './graph-usage-headers';
import { persistRaw } from './graph-raw-archive';
import type { RateLimitStrategy } from './rate-limit-strategy.port';

const GRAPH_BASE = 'https://graph.facebook.com/v22.0';
const DEFAULT_TIMEOUT_MS = 30_000;

export interface GraphCallOpts {
  endpoint: string;
  params: Record<string, string | number | undefined>;
  accessToken: string;
  context: PlatformAdapterContext;
  accountId?: bigint;
}

@Injectable()
export class GraphClient {
  private readonly http: AxiosInstance;

  constructor(
    private readonly rateBucket: RateBucketService,
    private readonly mongo: MongoService,
    private readonly metrics: MetricsService,
  ) {
    this.http = axios.create({
      baseURL: GRAPH_BASE,
      timeout: DEFAULT_TIMEOUT_MS,
      // The chokepoint inspects status itself.
      validateStatus: () => true,
    });
  }

  /**
   * Bind this client to a specific platform + rate-limit strategy. Returns a
   * lightweight wrapper exposing `call<T>(opts)`. Adapters consume the bound
   * client via DI (FACEBOOK_GRAPH_CLIENT / INSTAGRAM_GRAPH_CLIENT tokens).
   */
  bind(platform: string, strategy: RateLimitStrategy): BoundGraphClient {
    return new BoundGraphClient(
      platform,
      strategy,
      this.http,
      this.rateBucket,
      this.mongo,
      this.metrics,
    );
  }
}

/**
 * Per-platform binding. Owns the platform name + rate-limit strategy so call
 * sites never repeat them.
 */
export class BoundGraphClient {
  private readonly logger: Logger;

  constructor(
    private readonly platform: string,
    private readonly strategy: RateLimitStrategy,
    private readonly http: AxiosInstance,
    private readonly rateBucket: RateBucketService,
    private readonly mongo: MongoService,
    private readonly metrics: MetricsService,
  ) {
    this.logger = new Logger(`GraphClient[${platform}]`);
  }

  /**
   * Single chokepoint for every Graph API request. Every call:
   *   1. Acquires declared rate buckets (else throws RateLimitedError).
   *   2. Records tokens before, times the request.
   *   3. Parses usage headers + records tokens after.
   *   4. Persists raw body to Mongo raw_platform_responses (BEFORE status throws — D1).
   *   5. Emits observability events (metrics + api_call_log via MySQL).
   *   6. Maps 401/403 → TokenRevokedError, 429 → RateLimitedError, other 4xx/5xx → AdapterFetchError.
   */
  async call<T>(opts: GraphCallOpts): Promise<T> {
    const hints = this.strategy.hints(opts.context);
    const acquireCtx: Record<string, string> = {};
    if (opts.context.tokenHash) acquireCtx['hash'] = opts.context.tokenHash;
    if (opts.context.pageId) acquireCtx['page_id'] = opts.context.pageId;

    const acquired = await this.rateBucket.acquire(hints, acquireCtx);
    if (!acquired.allowed) {
      this.metrics.incr('acquire_total', {
        scope: acquired.bucketKey,
        result: 'denied',
      });
      throw new RateLimitedError(
        this.platform,
        acquired.resetInMs,
        acquired.bucketKey,
      );
    }
    this.metrics.incr('acquire_total', {
      scope: acquired.bucketKey,
      result: 'allowed',
    });

    const bucketBefore = acquired.tokensRemaining;
    const started = Date.now();
    const params = withToken(opts.params, opts.accessToken);

    let response: AxiosResponse;
    try {
      response = await this.http.get(opts.endpoint, { params });
    } catch (err: unknown) {
      const durationMs = Date.now() - started;
      const axErr = err as AxiosError;
      this.metrics.observeApiCall({
        platform: this.platform,
        endpoint: opts.endpoint,
        method: 'GET',
        status: axErr.response?.status ?? 0,
        durationMs,
        bucketBefore,
        bucketAfter: null,
        usageHeader: null,
        accountId: opts.accountId ?? null,
        rateBucketKey: acquired.bucketKey,
      });
      throw new AdapterFetchError(
        this.platform,
        opts.endpoint,
        err,
        undefined,
        axErr.response?.data,
      );
    }

    const durationMs = Date.now() - started;
    const usageHeader = parseUsageHeaders(response);
    const bucketAfterState = await this.rateBucket.getState(acquired.bucketKey);
    const bucketAfter = bucketAfterState?.tokens ?? null;

    this.metrics.observeApiCall({
      platform: this.platform,
      endpoint: opts.endpoint,
      method: 'GET',
      status: response.status,
      durationMs,
      bucketBefore,
      bucketAfter,
      usageHeader,
      accountId: opts.accountId ?? null,
      rateBucketKey: acquired.bucketKey,
    });

    // Persist before status-based throws so error bodies (Meta error message
    // + code/subcode) are captured for debugging — D1 fix.
    await persistRaw(
      this.mongo,
      this.platform,
      response.data,
      opts.endpoint,
      opts.accountId ?? null,
      response.status,
    );

    if (response.status === 401 || response.status === 403) {
      throw new TokenRevokedError(this.platform, opts.endpoint);
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers['retry-after']) || 60;
      // Format `Platform 429 on <endpoint>` is part of the contract — the
      // worker matches /platform 429/i to distinguish vendor-side throttling
      // from local rate-bucket denial. Don't change.
      throw new RateLimitedError(
        this.platform,
        retryAfter * 1000,
        acquired.bucketKey,
        `Platform 429 on ${opts.endpoint}`,
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw new AdapterFetchError(
        this.platform,
        opts.endpoint,
        new Error(`HTTP ${response.status}`),
        `Graph API returned ${response.status} for ${opts.endpoint}`,
        response.data,
      );
    }

    return response.data as T;
  }
}
