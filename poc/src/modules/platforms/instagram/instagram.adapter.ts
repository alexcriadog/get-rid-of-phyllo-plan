import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError, AxiosInstance, AxiosResponse } from 'axios';
import { createHash } from 'node:crypto';
import { MongoService, MONGO_COLLECTIONS } from '@shared/database/mongo.service';
import {
  RateBucketService,
  RateLimitHint,
} from '@shared/redis/rate-bucket.service';
import { MetricsService } from '@shared/metrics/metrics.service';
import {
  AdapterFetchError,
  PlatformAdapter,
  PlatformAdapterContext,
  RateLimitedError,
  TokenRevokedError,
} from '../shared/platform-adapter.port';
import {
  AudienceData,
  ContentData,
  ContentMetrics,
  ContentType,
  DistributionBucket,
  FetchOpts,
  ProfileData,
  SupportMatrix,
} from '../shared/platform-types';

const GRAPH_VERSION = 'v19.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_PAGE_SIZE = 25;

// 200 calls per hour ~= 0.05555... tokens per ms.
const IG_REFILL_PER_MS = 200 / (60 * 60 * 1000);
const IG_CAPACITY = 200;

/** IG media type → canonical content type. */
const MEDIA_TYPE_MAP: Record<string, ContentType> = {
  IMAGE: 'image',
  VIDEO: 'video',
  CAROUSEL_ALBUM: 'carousel',
  REELS: 'reel',
};

interface GraphPaging {
  cursors?: { before?: string; after?: string };
  next?: string;
  previous?: string;
}

interface GraphListResponse<T> {
  data: T[];
  paging?: GraphPaging;
}

interface GraphInsightValue {
  value: number | Record<string, number>;
  end_time?: string;
}

interface GraphInsight {
  name: string;
  period: string;
  values: GraphInsightValue[];
  title?: string;
  description?: string;
  id?: string;
}

interface GraphMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  insights?: { data: GraphInsight[] };
}

interface CallGraphOpts {
  endpoint: string;
  params: Record<string, string | number | undefined>;
  accessToken: string;
  context: PlatformAdapterContext;
  accountId?: bigint;
}

@Injectable()
export class InstagramAdapter implements PlatformAdapter {
  readonly platform = 'instagram';
  private readonly logger = new Logger(InstagramAdapter.name);
  private readonly http: AxiosInstance;

  constructor(
    private readonly rateBucket: RateBucketService,
    private readonly mongo: MongoService,
    private readonly metrics: MetricsService,
  ) {
    this.http = axios.create({
      baseURL: GRAPH_BASE,
      timeout: DEFAULT_TIMEOUT_MS,
      validateStatus: () => true, // we inspect status ourselves
    });
  }

  rateLimitHints(context?: PlatformAdapterContext): RateLimitHint[] {
    const hints: RateLimitHint[] = [
      {
        scope: 'user_token',
        keyTemplate: 'rate:ig:user_token:{hash}',
        capacity: IG_CAPACITY,
        refillPerMs: IG_REFILL_PER_MS,
        costPerCall: 1,
        strategy: 'token-bucket',
      },
      {
        scope: 'app',
        keyTemplate: 'rate:ig:app',
        capacity: IG_CAPACITY,
        refillPerMs: IG_REFILL_PER_MS,
        costPerCall: 1,
        strategy: 'token-bucket',
      },
    ];

    // Only declare the page-scoped bucket when we know which page we're
    // hitting — otherwise interpolation would throw on {page_id}.
    if (context?.pageId) {
      hints.push({
        scope: 'page',
        keyTemplate: 'rate:ig:page:{page_id}',
        capacity: IG_CAPACITY,
        refillPerMs: IG_REFILL_PER_MS,
        costPerCall: 1,
        strategy: 'token-bucket',
      });
    }
    return hints;
  }

  supportMatrix(): SupportMatrix {
    return {
      profile: {
        username: 'supported',
        displayName: 'supported',
        biography: 'supported',
        avatarUrl: 'supported',
        followersCount: 'supported',
        followingCount: 'supported',
        postsCount: 'supported',
        verified: 'not_supported',
        accountType: 'empty_possible',
      },
      audience: {
        genderDistribution: 'supported',
        ageDistribution: 'supported',
        countryDistribution: 'supported',
        cityDistribution: 'supported',
        interests: 'not_supported',
      },
      engagement_new: {
        caption: 'supported',
        permalink: 'supported',
        mediaUrls: 'supported',
        likes: 'supported',
        comments: 'supported',
        saves: 'supported',
        shares: 'empty_possible',
        impressions: 'supported',
        reach: 'supported',
      },
      stories: {
        permalink: 'supported',
        mediaUrls: 'supported',
        publishedAt: 'supported',
      },
    };
  }

  async fetchProfile(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ProfileData> {
    const body = await this.callGraph<Record<string, unknown>>({
      endpoint: `/${canonicalId}`,
      params: {
        fields:
          'username,name,biography,profile_picture_url,followers_count,follows_count,media_count',
      },
      accessToken,
      context: this.context(accessToken, metadata),
      accountId: this.accountIdFromMeta(metadata),
    });

    return {
      username: (body.username as string) ?? null,
      displayName: (body.name as string) ?? null,
      biography: (body.biography as string) ?? null,
      avatarUrl: (body.profile_picture_url as string) ?? null,
      profileUrl: body.username
        ? `https://instagram.com/${body.username as string}`
        : null,
      followersCount: this.asNumber(body.followers_count),
      followingCount: this.asNumber(body.follows_count),
      postsCount: this.asNumber(body.media_count),
      verified: null,
      accountType: null,
      fetchedAt: new Date(),
    };
  }

  async fetchAudience(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AudienceData> {
    const body = await this.callGraph<{ data?: GraphInsight[] }>({
      endpoint: `/${canonicalId}/insights`,
      params: {
        metric: 'audience_gender_age,audience_country,audience_city',
        period: 'lifetime',
      },
      accessToken,
      context: this.context(accessToken, metadata),
      accountId: this.accountIdFromMeta(metadata),
    });

    const data = body.data ?? [];
    const gender: DistributionBucket[] = [];
    const age: DistributionBucket[] = [];
    const country: DistributionBucket[] = [];
    const city: DistributionBucket[] = [];

    for (const insight of data) {
      const values = insight.values ?? [];
      const first = values[0]?.value;
      if (!first || typeof first !== 'object') continue;

      const entries = Object.entries(first as Record<string, number>);
      if (insight.name === 'audience_gender_age') {
        this.splitGenderAge(entries, gender, age);
      } else if (insight.name === 'audience_country') {
        for (const [label, value] of entries) {
          country.push({ label, value, unit: 'count' });
        }
      } else if (insight.name === 'audience_city') {
        for (const [label, value] of entries) {
          city.push({ label, value, unit: 'count' });
        }
      }
    }

    return {
      genderDistribution: gender,
      ageDistribution: age,
      countryDistribution: country,
      cityDistribution: city,
      fetchedAt: new Date(),
    };
  }

  async fetchContents(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    const limit = opts.limit ?? DEFAULT_PAGE_SIZE;
    const ctx = this.context(accessToken, metadata);
    const accountId = this.accountIdFromMeta(metadata);
    const collected: ContentData[] = [];

    let nextEndpoint = `/${canonicalId}/media`;
    let nextParams: Record<string, string | number | undefined> = {
      fields:
        'id,caption,media_type,media_url,permalink,timestamp,thumbnail_url,insights.metric(impressions,reach,likes,comments,saves,shares)',
      limit: Math.min(limit, DEFAULT_PAGE_SIZE),
    };

    while (collected.length < limit && nextEndpoint) {
      const body = await this.callGraph<GraphListResponse<GraphMedia>>({
        endpoint: nextEndpoint,
        params: nextParams,
        accessToken,
        context: ctx,
        accountId,
      });

      for (const media of body.data ?? []) {
        if (opts.since && media.timestamp) {
          const ts = new Date(media.timestamp);
          if (ts < opts.since) continue;
        }
        if (opts.until && media.timestamp) {
          const ts = new Date(media.timestamp);
          if (ts > opts.until) continue;
        }
        collected.push(this.mediaToContent(media));
        if (collected.length >= limit) break;
      }

      const nextUrl = body.paging?.next;
      if (!nextUrl || collected.length >= limit) break;

      const parsed = this.parseNextUrl(nextUrl);
      nextEndpoint = parsed.endpoint;
      nextParams = parsed.params;
    }

    return collected;
  }

  async fetchStories(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    const body = await this.callGraph<GraphListResponse<GraphMedia>>({
      endpoint: `/${canonicalId}/stories`,
      params: {
        fields: 'id,media_type,media_url,permalink,timestamp',
      },
      accessToken,
      context: this.context(accessToken, metadata),
      accountId: this.accountIdFromMeta(metadata),
    });

    const out: ContentData[] = [];
    for (const media of body.data ?? []) {
      out.push({ ...this.mediaToContent(media), contentType: 'story' });
    }
    return out;
  }

  /**
   * Single chokepoint for Graph API requests. Every call:
   *   1. Acquires declared rate buckets (else throws RateLimitedError).
   *   2. Records tokens before, times the request.
   *   3. Parses usage headers + records tokens after.
   *   4. Persists raw body to Mongo raw_platform_responses.
   *   5. Emits observability events (metrics + api_call_log via MySQL).
   *   6. Maps 401/403 → TokenRevokedError, 429 → RateLimitedError.
   */
  private async callGraph<T>(opts: CallGraphOpts): Promise<T> {
    const hints = this.rateLimitHints(opts.context);
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
    const params = this.withToken(opts.params, opts.accessToken);

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
      throw new AdapterFetchError(this.platform, opts.endpoint, err);
    }

    const durationMs = Date.now() - started;
    const usageHeader = this.parseUsageHeaders(response);
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

    if (response.status === 401 || response.status === 403) {
      throw new TokenRevokedError(this.platform, opts.endpoint);
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers['retry-after']) || 60;
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
      );
    }

    await this.persistRaw(
      response.data,
      opts.endpoint,
      opts.accountId ?? null,
    );

    return response.data as T;
  }

  private async persistRaw(
    body: unknown,
    endpoint: string,
    accountId: bigint | null,
  ): Promise<void> {
    try {
      const serialized = JSON.stringify(body);
      const hash = createHash('sha256').update(serialized).digest('hex');
      const col = this.mongo.getCollection(MONGO_COLLECTIONS.rawPlatformResponses);
      await col.insertOne({
        accountId: accountId ? accountId.toString() : null,
        platform: this.platform,
        endpoint,
        s3uri_stub: null,
        contentHash: hash,
        sizeBytes: Buffer.byteLength(serialized, 'utf8'),
        fetchedAt: new Date(),
        body,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`raw_platform_responses write failed: ${msg}`);
    }
  }

  private parseUsageHeaders(
    response: AxiosResponse,
  ): Record<string, unknown> | null {
    const headers = response.headers;
    const out: Record<string, unknown> = {};

    const appUsage = headers['x-app-usage'];
    if (typeof appUsage === 'string') {
      out['x-app-usage'] = this.safeJson(appUsage);
    }
    const buc = headers['x-business-use-case-usage'];
    if (typeof buc === 'string') {
      out['x-business-use-case-usage'] = this.safeJson(buc);
    }
    const pageUsage = headers['x-page-usage'];
    if (typeof pageUsage === 'string') {
      out['x-page-usage'] = this.safeJson(pageUsage);
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  private safeJson(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  private context(
    accessToken: string,
    metadata?: Record<string, unknown>,
  ): PlatformAdapterContext {
    return {
      tokenHash: this.tokenHash(accessToken),
      pageId:
        metadata && typeof metadata['page_id'] === 'string'
          ? (metadata['page_id'] as string)
          : undefined,
    };
  }

  private tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex').slice(0, 16);
  }

  private withToken(
    params: Record<string, string | number | undefined>,
    token: string,
  ): Record<string, string | number> {
    const out: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      out[k] = v;
    }
    out['access_token'] = token;
    return out;
  }

  private accountIdFromMeta(metadata?: Record<string, unknown>): bigint | undefined {
    const raw = metadata?.['accountId'] ?? metadata?.['account_id'];
    if (typeof raw === 'bigint') return raw;
    if (typeof raw === 'string' && /^\d+$/.test(raw)) return BigInt(raw);
    if (typeof raw === 'number' && Number.isFinite(raw)) return BigInt(raw);
    return undefined;
  }

  private asNumber(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return null;
  }

  private splitGenderAge(
    entries: ReadonlyArray<[string, number]>,
    gender: DistributionBucket[],
    age: DistributionBucket[],
  ): void {
    const genderTotals: Record<string, number> = {};
    const ageTotals: Record<string, number> = {};

    for (const [label, value] of entries) {
      const parts = label.split('.');
      if (parts.length !== 2) {
        gender.push({ label, value, unit: 'count' });
        continue;
      }
      const [g, a] = parts;
      genderTotals[g] = (genderTotals[g] ?? 0) + value;
      ageTotals[a] = (ageTotals[a] ?? 0) + value;
    }

    for (const [label, value] of Object.entries(genderTotals)) {
      gender.push({ label, value, unit: 'count' });
    }
    for (const [label, value] of Object.entries(ageTotals)) {
      age.push({ label, value, unit: 'count' });
    }
  }

  private mediaToContent(media: GraphMedia): ContentData {
    const metrics = this.extractMetrics(media);
    const type = MEDIA_TYPE_MAP[media.media_type ?? ''] ?? 'other';
    const serialized = JSON.stringify(media);
    const hash = createHash('sha256').update(serialized).digest('hex');

    return {
      platformContentId: media.id,
      contentType: type,
      caption: media.caption ?? null,
      permalink: media.permalink ?? null,
      mediaUrls: media.media_url ? [media.media_url] : [],
      thumbnailUrl: media.thumbnail_url ?? null,
      metrics,
      publishedAt: media.timestamp ? new Date(media.timestamp) : null,
      fetchedAt: new Date(),
      rawResponse: {
        collection: MONGO_COLLECTIONS.rawPlatformResponses,
        contentHash: hash,
      },
    };
  }

  private extractMetrics(media: GraphMedia): ContentMetrics {
    const out: ContentMetrics = {};
    for (const insight of media.insights?.data ?? []) {
      const first = insight.values?.[0]?.value;
      if (typeof first !== 'number') continue;
      switch (insight.name) {
        case 'impressions':
          out.impressions = first;
          break;
        case 'reach':
          out.reach = first;
          break;
        case 'likes':
          out.likes = first;
          break;
        case 'comments':
          out.comments = first;
          break;
        case 'saves':
          out.saves = first;
          break;
        case 'shares':
          out.shares = first;
          break;
        default: {
          const extra = out.extra ?? {};
          extra[insight.name] = first;
          out.extra = extra;
        }
      }
    }
    return out;
  }

  /**
   * Meta's paging.next URL already includes query parameters. Extract the
   * path + params so we can reuse our axios instance rather than hitting
   * the absolute URL directly — keeps timeouts and metrics consistent.
   */
  private parseNextUrl(absoluteUrl: string): {
    endpoint: string;
    params: Record<string, string | number | undefined>;
  } {
    try {
      const u = new URL(absoluteUrl);
      let endpoint = u.pathname;
      const versionPrefix = `/${GRAPH_VERSION}`;
      if (endpoint.startsWith(versionPrefix)) {
        endpoint = endpoint.slice(versionPrefix.length) || '/';
      }
      const params: Record<string, string | number | undefined> = {};
      for (const [k, v] of u.searchParams.entries()) {
        if (k === 'access_token') continue;
        params[k] = v;
      }
      return { endpoint, params };
    } catch {
      return { endpoint: '', params: {} };
    }
  }
}
