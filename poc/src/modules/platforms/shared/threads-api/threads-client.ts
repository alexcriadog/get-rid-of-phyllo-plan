// ThreadsClient — single chokepoint for Threads Graph API requests.
// Mirrors meta-graph/graph-client.ts but points at graph.threads.net/v1.0.
//
// Threads is technically separate from Meta's Graph API (different host,
// different scope strings, different rate limits) so we keep its own client
// alongside MetaGraphClient — composition over inheritance per
// docs/platform-refactor.md §2. The shared helpers (withToken, persistRaw,
// extractMetaError, RateLimitStrategy port) are reused as-is because the
// envelope shape is identical.

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
import { withToken } from '../meta-graph/graph-context';
import { persistRaw } from '../meta-graph/graph-raw-archive';
import { parseUsageHeaders } from '../meta-graph/graph-usage-headers';
import { isTokenDeadGraphBody } from '../meta-graph/graph-errors';
import { BucTelemetryService } from '../meta-graph/buc-telemetry.service';
import type { RateLimitStrategy } from '../meta-graph/rate-limit-strategy.port';

const THREADS_BASE = 'https://graph.threads.net/v1.0';
const DEFAULT_TIMEOUT_MS = 30_000;
const PLATFORM_NAME = 'threads';

export interface ThreadsCallOpts {
  endpoint: string;
  params: Record<string, string | number | undefined>;
  accessToken: string;
  context: PlatformAdapterContext;
  accountId?: bigint;
}

@Injectable()
export class ThreadsClient {
  private readonly http: AxiosInstance;

  constructor(
    private readonly rateBucket: RateBucketService,
    private readonly mongo: MongoService,
    private readonly metrics: MetricsService,
    private readonly telemetry: BucTelemetryService,
  ) {
    this.http = axios.create({
      baseURL: THREADS_BASE,
      timeout: DEFAULT_TIMEOUT_MS,
      validateStatus: () => true,
    });
  }

  /**
   * Bind to a per-account/per-app rate-limit strategy and return a usable
   * call surface. Adapters consume the bound client via DI (THREADS_API_CLIENT
   * token).
   */
  bind(strategy: RateLimitStrategy): BoundThreadsClient {
    return new BoundThreadsClient(
      strategy,
      this.http,
      this.rateBucket,
      this.mongo,
      this.metrics,
      this.telemetry,
    );
  }
}

/**
 * Per-binding wrapper. Owns the strategy so call sites never repeat it.
 */
export class BoundThreadsClient {
  private readonly logger = new Logger(`ThreadsClient[${PLATFORM_NAME}]`);

  constructor(
    private readonly strategy: RateLimitStrategy,
    private readonly http: AxiosInstance,
    private readonly rateBucket: RateBucketService,
    private readonly mongo: MongoService,
    private readonly metrics: MetricsService,
    private readonly telemetry: BucTelemetryService,
  ) {}

  /**
   * Single chokepoint for every Threads API request. Same six steps as
   * GraphClient.call: acquire bucket, time the request, parse usage headers,
   * persist raw before throwing, emit metrics, map status to typed errors.
   */
  async call<T>(opts: ThreadsCallOpts): Promise<T> {
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
        PLATFORM_NAME,
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
        platform: PLATFORM_NAME,
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
        PLATFORM_NAME,
        opts.endpoint,
        err,
        undefined,
        axErr.response?.data,
      );
    }

    const durationMs = Date.now() - started;
    const usageHeader = parseUsageHeaders(response);
    // Phase 1 of the rate-limit mirror: passively record the asset/app
    // bucket state Meta just reported. No gating yet — see
    // BucTelemetryService for context.
    await this.telemetry.observe(usageHeader);
    const bucketAfterState = await this.rateBucket.getState(acquired.bucketKey);
    const bucketAfter = bucketAfterState?.tokens ?? null;

    this.metrics.observeApiCall({
      platform: PLATFORM_NAME,
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

    await persistRaw(
      this.mongo,
      PLATFORM_NAME,
      response.data,
      opts.endpoint,
      opts.accountId ?? null,
      response.status,
    );

    if (response.status === 401 || response.status === 403) {
      throw new TokenRevokedError(PLATFORM_NAME, opts.endpoint);
    }
    // Graph returns expired/invalid tokens as 400 with OAuthException code 190
    // (or one of the documented subcodes). Without this branch the worker
    // would treat a dead token as a generic AdapterFetchError, bump
    // failure_count, and auto-pause after 5 attempts instead of marking the
    // account needs_reauth so the user knows to reconnect.
    if (response.status === 400 && isTokenDeadGraphBody(response.data)) {
      throw new TokenRevokedError(PLATFORM_NAME, opts.endpoint);
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers['retry-after']) || 60;
      throw new RateLimitedError(
        PLATFORM_NAME,
        retryAfter * 1000,
        acquired.bucketKey,
        `Platform 429 on ${opts.endpoint}`,
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw new AdapterFetchError(
        PLATFORM_NAME,
        opts.endpoint,
        new Error(`HTTP ${response.status}`),
        `Threads API returned ${response.status} for ${opts.endpoint}`,
        response.data,
      );
    }

    return response.data as T;
  }
}
