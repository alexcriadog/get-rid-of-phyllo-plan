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
const FB_REFILL_PER_MS = 200 / (60 * 60 * 1000);
const FB_CAPACITY = 200;

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

interface FacebookAttachment {
  media_type?: string;
  media?: { image?: { src?: string }; source?: string };
  subattachments?: { data: FacebookAttachment[] };
  type?: string;
  url?: string;
}

interface FacebookPost {
  id: string;
  message?: string;
  created_time?: string;
  permalink_url?: string;
  full_picture?: string;
  attachments?: { data: FacebookAttachment[] };
  insights?: { data: GraphInsight[] };
}

interface FacebookVideo {
  id: string;
  description?: string;
  source?: string;
  created_time?: string;
  permalink_url?: string;
  video_insights?: { data: GraphInsight[] };
}

interface CallGraphOpts {
  endpoint: string;
  params: Record<string, string | number | undefined>;
  accessToken: string;
  context: PlatformAdapterContext;
  accountId?: bigint;
}

/**
 * FacebookAdapter — Day 6 drop-in demo.
 *
 * Implements PlatformAdapter against the Meta Graph API for Facebook Pages.
 * No `fetchStories` — Pages don't expose a Stories resource at this tier.
 *
 * Shape is intentionally a near-clone of InstagramAdapter: same Graph base,
 * same callGraph chokepoint, same rate-bucket + api_call_log + raw-archive
 * pipeline. The differences are endpoint shapes and the audience parsing
 * logic (FB returns `F.18-24` style keys under page_fans_gender_age).
 */
@Injectable()
export class FacebookAdapter implements PlatformAdapter {
  readonly platform = 'facebook';
  private readonly logger = new Logger(FacebookAdapter.name);
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
        scope: 'app',
        keyTemplate: 'rate:fb:app',
        capacity: FB_CAPACITY,
        refillPerMs: FB_REFILL_PER_MS,
        costPerCall: 1,
        strategy: 'token-bucket',
      },
    ];

    // Only declare the page-scoped bucket when we know which page we're
    // hitting — otherwise {page_id} interpolation would throw.
    if (context?.pageId) {
      hints.unshift({
        scope: 'page',
        keyTemplate: 'rate:fb:page:{page_id}',
        capacity: FB_CAPACITY,
        refillPerMs: FB_REFILL_PER_MS,
        costPerCall: 1,
        strategy: 'token-bucket',
      });
    }
    return hints;
  }

  supportMatrix(): SupportMatrix {
    return {
      profile: {
        name: 'supported',
        about: 'supported',
        category: 'supported',
        picture: 'supported',
        fan_count: 'supported',
        followers_count: 'supported',
        link: 'supported',
        verified: 'not_supported',
      },
      audience: {
        genderDistribution: 'supported',
        ageDistribution: 'supported',
        countryDistribution: 'supported',
        cityDistribution: 'empty_possible',
        interests: 'not_supported',
      },
      engagement_new: {
        caption: 'supported',
        permalink: 'supported',
        mediaUrls: 'supported',
        likes: 'supported',
        comments: 'supported',
        shares: 'supported',
        saves: 'not_supported',
        impressions: 'supported',
        reach: 'supported',
        views: 'supported',
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
          'name,about,category,picture,fan_count,followers_count,link',
      },
      accessToken,
      context: this.context(accessToken, canonicalId, metadata),
      accountId: this.accountIdFromMeta(metadata),
    });

    const picture = this.extractPictureUrl(body.picture);
    const fanCount = this.asNumber(body.fan_count);
    const followersCount = this.asNumber(body.followers_count);

    return {
      username: (body.name as string) ?? null,
      displayName: (body.name as string) ?? null,
      biography: (body.about as string) ?? null,
      avatarUrl: picture,
      profileUrl: (body.link as string) ?? null,
      // FB Pages expose both `fan_count` (likes) and `followers_count`.
      // followers_count is the closer analogue to IG followers — prefer it
      // but fall back to fan_count when missing.
      followersCount: followersCount ?? fanCount,
      followingCount: null,
      postsCount: null,
      verified: null,
      accountType: (body.category as string) ?? null,
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
        metric: 'page_fans_country,page_fans_gender_age',
        period: 'lifetime',
      },
      accessToken,
      context: this.context(accessToken, canonicalId, metadata),
      accountId: this.accountIdFromMeta(metadata),
    });

    const data = body.data ?? [];
    const gender: DistributionBucket[] = [];
    const age: DistributionBucket[] = [];
    const country: DistributionBucket[] = [];

    for (const insight of data) {
      const values = insight.values ?? [];
      // Prefer the latest sample for lifetime metrics (values can grow).
      const first = values[values.length - 1]?.value ?? values[0]?.value;
      if (!first || typeof first !== 'object') continue;

      const entries = Object.entries(first as Record<string, number>);
      if (insight.name === 'page_fans_gender_age') {
        this.splitGenderAge(entries, gender, age);
      } else if (insight.name === 'page_fans_country') {
        for (const [label, value] of entries) {
          country.push({ label, value, unit: 'count' });
        }
      }
    }

    return {
      genderDistribution: gender,
      ageDistribution: age,
      countryDistribution: country,
      cityDistribution: [],
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
    const ctx = this.context(accessToken, canonicalId, metadata);
    const accountId = this.accountIdFromMeta(metadata);
    const perSourceLimit = Math.min(limit, DEFAULT_PAGE_SIZE);

    // Posts and videos are fetched in parallel — /posts covers text/photo
    // posts, /videos covers native video uploads. Merge + sort + trim.
    const [posts, videos] = await Promise.all([
      this.fetchPosts(accessToken, canonicalId, perSourceLimit, ctx, accountId, opts),
      this.fetchVideos(accessToken, canonicalId, perSourceLimit, ctx, accountId, opts),
    ]);

    const merged = [...posts, ...videos];
    merged.sort((a, b) => {
      const aTs = a.publishedAt ? a.publishedAt.getTime() : 0;
      const bTs = b.publishedAt ? b.publishedAt.getTime() : 0;
      return bTs - aTs;
    });

    return merged.slice(0, limit);
  }

  private async fetchPosts(
    accessToken: string,
    canonicalId: string,
    limit: number,
    ctx: PlatformAdapterContext,
    accountId: bigint | undefined,
    opts: FetchOpts,
  ): Promise<ContentData[]> {
    const collected: ContentData[] = [];
    let nextEndpoint = `/${canonicalId}/posts`;
    let nextParams: Record<string, string | number | undefined> = {
      fields:
        'id,message,created_time,permalink_url,full_picture,attachments,insights.metric(post_impressions,post_reactions_by_type_total)',
      limit: Math.min(limit, DEFAULT_PAGE_SIZE),
    };

    while (collected.length < limit && nextEndpoint) {
      const body = await this.callGraph<GraphListResponse<FacebookPost>>({
        endpoint: nextEndpoint,
        params: nextParams,
        accessToken,
        context: ctx,
        accountId,
      });

      for (const post of body.data ?? []) {
        if (!this.withinTimeWindow(post.created_time, opts)) continue;
        collected.push(this.postToContent(post));
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

  private async fetchVideos(
    accessToken: string,
    canonicalId: string,
    limit: number,
    ctx: PlatformAdapterContext,
    accountId: bigint | undefined,
    opts: FetchOpts,
  ): Promise<ContentData[]> {
    const collected: ContentData[] = [];
    let nextEndpoint = `/${canonicalId}/videos`;
    let nextParams: Record<string, string | number | undefined> = {
      fields:
        'id,description,source,created_time,permalink_url,video_insights.metric(total_video_views)',
      limit: Math.min(limit, DEFAULT_PAGE_SIZE),
    };

    while (collected.length < limit && nextEndpoint) {
      const body = await this.callGraph<GraphListResponse<FacebookVideo>>({
        endpoint: nextEndpoint,
        params: nextParams,
        accessToken,
        context: ctx,
        accountId,
      });

      for (const video of body.data ?? []) {
        if (!this.withinTimeWindow(video.created_time, opts)) continue;
        collected.push(this.videoToContent(video));
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
    const pageUsage = headers['x-page-usage'];
    if (typeof pageUsage === 'string') {
      out['x-page-usage'] = this.safeJson(pageUsage);
    }
    const buc = headers['x-business-use-case-usage'];
    if (typeof buc === 'string') {
      out['x-business-use-case-usage'] = this.safeJson(buc);
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
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): PlatformAdapterContext {
    // For FB, canonicalId IS the page id — but metadata may override it
    // if the operator seeded the account differently.
    const metaPageId =
      metadata && typeof metadata['page_id'] === 'string'
        ? (metadata['page_id'] as string)
        : undefined;

    return {
      tokenHash: this.tokenHash(accessToken),
      pageId: metaPageId ?? canonicalId,
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

  private withinTimeWindow(
    createdTime: string | undefined,
    opts: FetchOpts,
  ): boolean {
    if (!createdTime) return true;
    const ts = new Date(createdTime);
    if (Number.isNaN(ts.getTime())) return true;
    if (opts.since && ts < opts.since) return false;
    if (opts.until && ts > opts.until) return false;
    return true;
  }

  /**
   * `page_fans_gender_age` returns a map like:
   *   { 'F.18-24': 123, 'M.25-34': 456, 'U.65+': 7 }
   * Aggregate into two separate distributions: gender totals and age totals.
   * Unknown gender prefix ('U') still contributes to age totals.
   */
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

  private extractPictureUrl(picture: unknown): string | null {
    if (!picture || typeof picture !== 'object') return null;
    const data = (picture as { data?: { url?: string } }).data;
    if (data && typeof data.url === 'string') return data.url;
    return null;
  }

  private postToContent(post: FacebookPost): ContentData {
    const metrics = this.extractPostMetrics(post);
    const mediaUrls = this.extractMediaUrls(post);
    const contentType = this.detectPostContentType(post);
    const serialized = JSON.stringify(post);
    const hash = createHash('sha256').update(serialized).digest('hex');

    return {
      platformContentId: post.id,
      contentType,
      caption: post.message ?? null,
      permalink: post.permalink_url ?? null,
      mediaUrls,
      thumbnailUrl: post.full_picture ?? null,
      metrics,
      publishedAt: post.created_time ? new Date(post.created_time) : null,
      fetchedAt: new Date(),
      rawResponse: {
        collection: MONGO_COLLECTIONS.rawPlatformResponses,
        contentHash: hash,
      },
    };
  }

  private videoToContent(video: FacebookVideo): ContentData {
    const metrics = this.extractVideoMetrics(video);
    const mediaUrls = video.source ? [video.source] : [];
    const serialized = JSON.stringify(video);
    const hash = createHash('sha256').update(serialized).digest('hex');

    return {
      platformContentId: video.id,
      contentType: 'video',
      caption: video.description ?? null,
      permalink: video.permalink_url ?? null,
      mediaUrls,
      thumbnailUrl: null,
      metrics,
      publishedAt: video.created_time ? new Date(video.created_time) : null,
      fetchedAt: new Date(),
      rawResponse: {
        collection: MONGO_COLLECTIONS.rawPlatformResponses,
        contentHash: hash,
      },
    };
  }

  private detectPostContentType(post: FacebookPost): ContentType {
    const first = post.attachments?.data?.[0];
    if (!first) return post.full_picture ? 'image' : 'other';
    const mediaType = (first.media_type ?? first.type ?? '').toLowerCase();
    if (mediaType.includes('video')) return 'video';
    if (mediaType.includes('album')) return 'carousel';
    if (mediaType.includes('photo') || mediaType.includes('image')) return 'image';
    return post.full_picture ? 'image' : 'other';
  }

  private extractMediaUrls(post: FacebookPost): string[] {
    const urls: string[] = [];
    const attachments = post.attachments?.data ?? [];
    for (const a of attachments) {
      const src = a.media?.source ?? a.media?.image?.src ?? a.url;
      if (typeof src === 'string' && src.length > 0) {
        urls.push(src);
      }
      for (const sub of a.subattachments?.data ?? []) {
        const subSrc = sub.media?.source ?? sub.media?.image?.src ?? sub.url;
        if (typeof subSrc === 'string' && subSrc.length > 0) {
          urls.push(subSrc);
        }
      }
    }
    if (urls.length === 0 && post.full_picture) {
      urls.push(post.full_picture);
    }
    return urls;
  }

  private extractPostMetrics(post: FacebookPost): ContentMetrics {
    const out: ContentMetrics = {};
    for (const insight of post.insights?.data ?? []) {
      const first = insight.values?.[0]?.value;
      if (insight.name === 'post_impressions' && typeof first === 'number') {
        out.impressions = first;
        out.reach = out.reach ?? first;
      } else if (
        insight.name === 'post_reactions_by_type_total' &&
        first !== null &&
        typeof first === 'object'
      ) {
        const reactions = first as Record<string, number>;
        const total = Object.values(reactions).reduce(
          (sum, v) => (typeof v === 'number' ? sum + v : sum),
          0,
        );
        out.likes = total;
        const extra = out.extra ?? {};
        for (const [k, v] of Object.entries(reactions)) {
          if (typeof v === 'number') extra[`reaction_${k}`] = v;
        }
        out.extra = extra;
      } else if (typeof first === 'number') {
        const extra = out.extra ?? {};
        extra[insight.name] = first;
        out.extra = extra;
      }
    }
    return out;
  }

  private extractVideoMetrics(video: FacebookVideo): ContentMetrics {
    const out: ContentMetrics = {};
    for (const insight of video.video_insights?.data ?? []) {
      const first = insight.values?.[0]?.value;
      if (typeof first !== 'number') continue;
      if (insight.name === 'total_video_views') {
        out.views = first;
      } else {
        const extra = out.extra ?? {};
        extra[insight.name] = first;
        out.extra = extra;
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
