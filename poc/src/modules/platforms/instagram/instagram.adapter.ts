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
  AccountInsightsData,
  AudienceData,
  ContentChild,
  ContentData,
  ContentMetrics,
  ContentType,
  DemographicDistributions,
  DistributionBucket,
  FetchOpts,
  ProfileData,
  SupportMatrix,
} from '../shared/platform-types';

const GRAPH_VERSION = 'v22.0';
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
  // v22 `follower_demographics` response shape.
  total_value?: {
    breakdowns?: Array<{
      dimension_keys: string[];
      results: Array<{ dimension_values: string[]; value: number }>;
    }>;
  };
}

interface GraphMediaChild {
  id: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
}

interface GraphMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
  is_shared_to_feed?: boolean;
  is_comment_enabled?: boolean;
  alt_text?: string | null;
  media_product_type?: string;
  shortcode?: string;
  owner?: { id: string; username?: string };
  collaborators?: { data?: Array<{ id: string; username?: string }> };
  children?: { data: GraphMediaChild[] };
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
    // IG Business /<ig_user_id> — safe field set. `account_type` and
    // `shopping_review_status` return 400 for any account not enrolled
    // in IG Shopping, and one bad field invalidates the whole call —
    // so we skip them. `website` is universally available.
    const body = await this.callGraph<Record<string, unknown>>({
      endpoint: `/${canonicalId}`,
      params: {
        fields:
          'id,username,name,biography,profile_picture_url,followers_count,follows_count,media_count,website',
      },
      accessToken,
      context: this.context(accessToken, metadata),
      accountId: this.accountIdFromMeta(metadata),
    });

    const username = (body.username as string) ?? null;
    return {
      username,
      displayName: (body.name as string) ?? null,
      biography: (body.biography as string) ?? null,
      avatarUrl: (body.profile_picture_url as string) ?? null,
      profileUrl: username ? `https://instagram.com/${username}` : null,
      followersCount: this.asNumber(body.followers_count),
      followingCount: this.asNumber(body.follows_count),
      postsCount: this.asNumber(body.media_count),
      verified: null,
      accountType: null,
      website: (body.website as string) ?? null,
      fetchedAt: new Date(),
    };
  }

  async fetchAudience(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AudienceData> {
    const context = this.context(accessToken, metadata);
    const accountId = this.accountIdFromMeta(metadata);

    // 1. Follower demographics (4 per-breakdown calls).
    const follower = await this.fetchDemographics(
      'follower_demographics',
      accessToken,
      canonicalId,
      context,
      accountId,
    );

    // 2. Reached-audience demographics (4 more per-breakdown calls).
    const reached = await this.fetchDemographics(
      'reached_audience_demographics',
      accessToken,
      canonicalId,
      context,
      accountId,
    );

    // 3. Engaged-audience demographics (4 more).
    const engaged = await this.fetchDemographics(
      'engaged_audience_demographics',
      accessToken,
      canonicalId,
      context,
      accountId,
    );

    // 4. Account-level daily totals + follower-count time series (2 calls).
    const accountInsights = await this.fetchAccountInsights(
      accessToken,
      canonicalId,
      context,
      accountId,
    );

    return {
      genderDistribution: follower.genderDistribution ?? [],
      ageDistribution: follower.ageDistribution ?? [],
      countryDistribution: follower.countryDistribution ?? [],
      cityDistribution: follower.cityDistribution ?? [],
      reachedDemographics: reached,
      engagedDemographics: engaged,
      accountInsights,
      fetchedAt: new Date(),
    };
  }

  private async fetchDemographics(
    metric: string,
    accessToken: string,
    canonicalId: string,
    context: ReturnType<InstagramAdapter['context']>,
    accountId: bigint | undefined,
  ): Promise<DemographicDistributions> {
    const breakdowns: Array<'age' | 'gender' | 'country' | 'city'> = [
      'age',
      'gender',
      'country',
      'city',
    ];
    const out: DemographicDistributions = {};
    const errors: NonNullable<DemographicDistributions['errors']> = [];
    // `follower_demographics` is lifetime-snapshot and rejects `timeframe`.
    // `reached_audience_demographics` and `engaged_audience_demographics`
    // are derived over a window and REQUIRE `timeframe` (Graph error #100
    // otherwise). v20+ retired last_14_days / last_30_days / last_90_days;
    // current valid values are `this_week`, `this_month`, `prev_month`.
    const needsTimeframe = metric !== 'follower_demographics';
    for (const breakdown of breakdowns) {
      try {
        const body = await this.callGraph<{ data?: GraphInsight[] }>({
          endpoint: `/${canonicalId}/insights`,
          params: {
            metric,
            period: 'lifetime',
            metric_type: 'total_value',
            breakdown,
            ...(needsTimeframe ? { timeframe: 'this_month' } : {}),
          },
          accessToken,
          context,
          accountId,
        });
        const buckets = this.parseFollowerDemographics(body.data ?? []);
        if (breakdown === 'age') out.ageDistribution = buckets;
        else if (breakdown === 'gender') out.genderDistribution = buckets;
        else if (breakdown === 'country') out.countryDistribution = buckets;
        else if (breakdown === 'city') out.cityDistribution = buckets;
      } catch (err) {
        const detail = this.extractGraphError(err);
        this.logger.debug(
          `${metric} breakdown=${breakdown} failed: ${detail.message}`,
        );
        errors.push({ breakdown, ...detail });
      }
    }
    if (errors.length > 0) out.errors = errors;
    return out;
  }

  private extractGraphError(err: unknown): {
    message: string;
    code?: number;
    subcode?: number;
  } {
    const graphErr = this.graphErrorFromBody(
      (err as { body?: unknown } | null)?.body,
    );
    if (graphErr) return graphErr;
    if (err instanceof Error) return { message: err.message };
    return { message: String(err) };
  }

  private graphErrorFromBody(body: unknown):
    | { message: string; code?: number; subcode?: number }
    | null {
    if (!body || typeof body !== 'object') return null;
    const errObj = (body as { error?: unknown }).error;
    if (!errObj || typeof errObj !== 'object') return null;
    const e = errObj as {
      message?: unknown;
      code?: unknown;
      error_subcode?: unknown;
    };
    return {
      message: typeof e.message === 'string' ? e.message : 'Graph API error',
      code: typeof e.code === 'number' ? e.code : undefined,
      subcode: typeof e.error_subcode === 'number' ? e.error_subcode : undefined,
    };
  }

  /**
   * Account-level insights — daily totals for reach/engagement/profile
   * actions over the last 28 days, plus the follower_count time series.
   * Returns a partial shape; missing metrics (e.g. because a CTA isn't
   * configured) are simply absent.
   */
  private async fetchAccountInsights(
    accessToken: string,
    canonicalId: string,
    context: ReturnType<InstagramAdapter['context']>,
    accountId: bigint | undefined,
  ): Promise<AccountInsightsData> {
    const PERIOD_DAYS = 28;
    const until = Math.floor(Date.now() / 1000);
    const since = until - PERIOD_DAYS * 86_400;

    const out: AccountInsightsData = { periodDays: PERIOD_DAYS };
    const extra: Record<string, number> = {};

    // Totals with metric_type=total_value (single call with the whole list).
    // Meta rejects the entire batch if any metric is invalid for the v22
    // account-level endpoint, so this list must match the documented set.
    // Removed in v22 (caused #100 metric[i] errors): impressions,
    // email_contacts, phone_call_clicks, text_message_clicks,
    // get_directions_clicks. Use `profile_links_taps` (broken-down by
    // contact button type via `breakdown=contact_button_type`) if those
    // CTA-click totals come back into scope.
    const totalMetrics = [
      'reach',
      'accounts_engaged',
      'total_interactions',
      'likes',
      'comments',
      'saves',
      'shares',
      'replies',
      'views',
      'profile_views',
      'website_clicks',
    ];
    try {
      const body = await this.callGraph<{
        data?: Array<{ name: string; total_value?: { value: number } }>;
      }>({
        endpoint: `/${canonicalId}/insights`,
        params: {
          metric: totalMetrics.join(','),
          period: 'day',
          metric_type: 'total_value',
          since,
          until,
        },
        accessToken,
        context,
        accountId,
      });

      for (const entry of body.data ?? []) {
        const v = entry.total_value?.value;
        if (typeof v !== 'number') continue;
        switch (entry.name) {
          case 'reach':
            out.reach = v;
            break;
          case 'impressions':
            out.impressions = v;
            break;
          case 'accounts_engaged':
            out.accountsEngaged = v;
            break;
          case 'total_interactions':
            out.totalInteractions = v;
            break;
          case 'likes':
            out.likes = v;
            break;
          case 'comments':
            out.comments = v;
            break;
          case 'saves':
            out.saves = v;
            break;
          case 'shares':
            out.shares = v;
            break;
          case 'replies':
            out.replies = v;
            break;
          case 'views':
            out.views = v;
            break;
          case 'profile_views':
            out.profileViews = v;
            break;
          case 'website_clicks':
            out.websiteClicks = v;
            break;
          case 'email_contacts':
            out.emailContacts = v;
            break;
          case 'phone_call_clicks':
            out.phoneCallClicks = v;
            break;
          case 'text_message_clicks':
            out.textMessageClicks = v;
            break;
          case 'get_directions_clicks':
            out.getDirectionsClicks = v;
            break;
          default:
            extra[entry.name] = v;
        }
      }
    } catch (err) {
      this.logger.debug(
        `account total_value insights failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Follower-count time series (period=day, no metric_type).
    try {
      const body = await this.callGraph<{
        data?: Array<{
          name: string;
          values?: Array<{ value: unknown; end_time?: string }>;
        }>;
      }>({
        endpoint: `/${canonicalId}/insights`,
        params: {
          metric: 'follower_count',
          period: 'day',
          since,
          until,
        },
        accessToken,
        context,
        accountId,
      });
      const entry = (body.data ?? []).find((d) => d.name === 'follower_count');
      if (entry) {
        out.followerCountSeries = (entry.values ?? [])
          .filter((v) => typeof v.value === 'number' && !!v.end_time)
          .map((v) => ({ endTime: v.end_time as string, value: v.value as number }));
      }
    } catch (err) {
      this.logger.debug(
        `follower_count series failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (Object.keys(extra).length > 0) out.extra = extra;
    return out;
  }

  private parseFollowerDemographics(data: GraphInsight[]): DistributionBucket[] {
    const out: DistributionBucket[] = [];
    for (const insight of data) {
      const breakdowns = insight.total_value?.breakdowns ?? [];
      for (const bd of breakdowns) {
        for (const r of bd.results ?? []) {
          const label = (r.dimension_values ?? []).join('|');
          if (!label) continue;
          out.push({ label, value: r.value, unit: 'count' });
        }
      }
    }
    return out;
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

    // Rich field set for Graph v22 — every one rides on the same /media call
    // (zero extra cost). `children{…}` returns carousel subitems inline.
    // Impressions-class metrics aren't here: those require the per-media
    // /insights endpoint (1 extra call per post) and are intentionally
    // opt-in. See fetchContentInsights() for that path.
    let nextEndpoint = `/${canonicalId}/media`;
    let nextParams: Record<string, string | number | undefined> = {
      fields: [
        'id',
        'caption',
        'media_type',
        'media_url',
        'permalink',
        'timestamp',
        'thumbnail_url',
        'like_count',
        'comments_count',
        'is_shared_to_feed',
        'is_comment_enabled',
        'alt_text',
        'media_product_type',
        'shortcode',
        'owner{id,username}',
        'collaborators{id,username}',
        'children{id,media_type,media_url,thumbnail_url,permalink}',
      ].join(','),
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
        const base = this.mediaToContent(media);
        // +1 call per media for reach/saved/shares/views/etc.
        const enrich = await this.fetchContentInsights(accessToken, ctx, accountId, media);
        collected.push({
          ...base,
          metrics: { ...base.metrics, ...enrich },
        });
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
    const ctx = this.context(accessToken, metadata);
    const accountId = this.accountIdFromMeta(metadata);
    const body = await this.callGraph<GraphListResponse<GraphMedia>>({
      endpoint: `/${canonicalId}/stories`,
      params: {
        // `thumbnail_url` is needed so VIDEO stories render a poster in the
        // grid; IG only populates it for video-type media.
        fields: 'id,media_type,media_url,thumbnail_url,permalink,timestamp',
      },
      accessToken,
      context: ctx,
      accountId,
    });

    const out: ContentData[] = [];
    for (const media of body.data ?? []) {
      const base = { ...this.mediaToContent(media), contentType: 'story' as const };
      // +1 call per story for reach / replies / navigation.
      const enrich = await this.fetchContentInsights(accessToken, ctx, accountId, {
        ...media,
        media_product_type: 'STORY',
      });
      out.push({ ...base, metrics: { ...base.metrics, ...enrich } });
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
      const axBody = (err as AxiosError).response?.data;
      throw new AdapterFetchError(
        this.platform,
        opts.endpoint,
        err,
        undefined,
        axBody,
      );
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

    // Persist before status-based throws so error bodies (Meta error
    // message + code/subcode) are captured for debugging.
    await this.persistRaw(
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

  private async persistRaw(
    body: unknown,
    endpoint: string,
    accountId: bigint | null,
    httpStatus: number = 200,
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
        httpStatus,
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

    // Carousel children — each slide has its own media URL + type.
    const rawChildren = media.children?.data ?? [];
    const children: ContentChild[] = rawChildren.map((c) => ({
      id: c.id,
      mediaType: MEDIA_TYPE_MAP[c.media_type ?? ''] ?? 'other',
      mediaUrl: c.media_url ?? null,
      thumbnailUrl: c.thumbnail_url ?? null,
      permalink: c.permalink ?? null,
    }));

    // For carousels, expose every child media URL in `mediaUrls[]` so
    // consumers that don't understand the `children` field still get
    // everything.
    const mediaUrls: string[] = [];
    if (children.length > 0) {
      for (const child of children) {
        if (child.mediaUrl) mediaUrls.push(child.mediaUrl);
      }
    } else if (media.media_url) {
      mediaUrls.push(media.media_url);
    }

    return {
      platformContentId: media.id,
      contentType: type,
      caption: media.caption ?? null,
      permalink: media.permalink ?? null,
      mediaUrls,
      thumbnailUrl: media.thumbnail_url ?? children[0]?.thumbnailUrl ?? null,
      metrics,
      publishedAt: media.timestamp ? new Date(media.timestamp) : null,
      fetchedAt: new Date(),
      children: children.length > 0 ? children : undefined,
      mediaProductType: media.media_product_type ?? null,
      shortcode: media.shortcode ?? null,
      isSharedToFeed:
        typeof media.is_shared_to_feed === 'boolean' ? media.is_shared_to_feed : null,
      ownerHandle: media.owner?.username ?? null,
      rawResponse: {
        collection: MONGO_COLLECTIONS.rawPlatformResponses,
        contentHash: hash,
      },
    };
  }

  private extractMetrics(media: GraphMedia): ContentMetrics {
    // v22 scalar fields live on the media object itself.
    const out: ContentMetrics = {};
    if (typeof media.like_count === 'number') out.likes = media.like_count;
    if (typeof media.comments_count === 'number') out.comments = media.comments_count;
    return out;
  }

  /**
   * Per-media insights. Meta rejects the entire batch if any metric isn't
   * valid for the media type (or if breakdown-restricted metrics are mixed
   * in), so we split the work:
   *   1. Primary batch — only metrics safe to combine for this media type.
   *   2. Per-breakdown calls — `profile_activity` (FEED + STORY) with
   *      `breakdown=action_type`, and `navigation` (STORY only) with
   *      `breakdown=story_navigation_action_type`. These can never share a
   *      call with each other or with the base batch.
   * Breakdown failures are non-fatal (logged + skipped) so a 400 on one
   * optional metric doesn't drop everything else.
   * Requires `instagram_manage_insights` on the token.
   */
  private async fetchContentInsights(
    accessToken: string,
    context: ReturnType<InstagramAdapter['context']>,
    accountId: bigint | undefined,
    media: GraphMedia,
  ): Promise<Partial<ContentMetrics>> {
    const metrics = this.insightMetricsForMedia(media);
    if (metrics.length === 0) return {};

    const ctx = `media=${media.id} type=${media.media_type ?? '—'}/${media.media_product_type ?? '—'}`;
    const pt = (media.media_product_type ?? '').toUpperCase();
    const mt = (media.media_type ?? '').toUpperCase();
    const isStory = pt === 'STORY' || mt === 'STORY';
    const isReels = pt === 'REELS';
    const isFeed = !isStory && !isReels;

    const baseData = await this.fetchInsightsBatch(
      accessToken,
      context,
      accountId,
      media.id,
      metrics,
      ctx,
    );

    // profile_activity needs breakdown=action_type and is only valid for
    // FEED and STORY (not REELS). navigation needs breakdown=story_navigation_action_type
    // and is STORY-only.
    const breakdownCalls: Array<Promise<Record<string, number>>> = [];
    if (isFeed || isStory) {
      breakdownCalls.push(
        this.fetchInsightBreakdown(
          accessToken,
          context,
          accountId,
          media.id,
          'profile_activity',
          'action_type',
          ctx,
        ),
      );
    }
    if (isStory) {
      breakdownCalls.push(
        this.fetchInsightBreakdown(
          accessToken,
          context,
          accountId,
          media.id,
          'navigation',
          'story_navigation_action_type',
          ctx,
        ),
      );
    }
    const breakdownResults = await Promise.all(breakdownCalls);

    const out = this.mapInsightsData(baseData);
    const mergedExtra: Record<string, number> = { ...(out.extra ?? {}) };
    for (const result of breakdownResults) {
      Object.assign(mergedExtra, result);
    }
    if (Object.keys(mergedExtra).length > 0) out.extra = mergedExtra;
    return out;
  }

  private async fetchInsightsBatch(
    accessToken: string,
    context: ReturnType<InstagramAdapter['context']>,
    accountId: bigint | undefined,
    mediaId: string,
    metrics: string[],
    ctx: string,
  ): Promise<Array<{ name: string; values?: Array<{ value: unknown }> }>> {
    const fetchOnce = async (metricList: string[]) =>
      this.callGraph<{
        data?: Array<{ name: string; values?: Array<{ value: unknown }> }>;
      }>({
        endpoint: `/${mediaId}/insights`,
        params: { metric: metricList.join(',') },
        accessToken,
        context,
        accountId,
      });

    try {
      const body = await fetchOnce(metrics);
      const data = body.data ?? [];
      if (data.length === 0) {
        this.logger.warn(`insights returned zero metrics (${ctx})`);
      }
      return data;
    } catch (err) {
      // `reach` is valid for every IG media type (STORY/REELS/VIDEO/IMAGE/
      // CAROUSEL_ALBUM), so this fallback never 400s on a metric mismatch.
      this.logger.warn(
        `insights primary failed (${ctx}) attempted=[${metrics.join(',')}]: ${this.extractMetaError(err)} — retrying with reach`,
      );
      try {
        const body = await fetchOnce(['reach']);
        return body.data ?? [];
      } catch (err2) {
        this.logger.warn(
          `insights fallback failed (${ctx}): ${this.extractMetaError(err2)}`,
        );
        return [];
      }
    }
  }

  /**
   * Single-metric insights call with a required breakdown. Used for
   * `profile_activity` (action_type) and `navigation` (story_navigation_action_type)
   * — neither can be batched with other metrics. Returns flattened keys
   * like `profile_activity__bio_link_clicked` ready to merge into `extra`,
   * plus the metric total under its own name. Failures are swallowed and
   * logged so they never break the parent insights call.
   */
  private async fetchInsightBreakdown(
    accessToken: string,
    context: ReturnType<InstagramAdapter['context']>,
    accountId: bigint | undefined,
    mediaId: string,
    metric: string,
    breakdown: string,
    ctx: string,
  ): Promise<Record<string, number>> {
    try {
      const body = await this.callGraph<{
        data?: Array<{
          name: string;
          values?: Array<{ value: unknown }>;
          total_value?: {
            value?: number;
            breakdowns?: Array<{
              dimension_keys: string[];
              results: Array<{ dimension_values: string[]; value: number }>;
            }>;
          };
        }>;
      }>({
        endpoint: `/${mediaId}/insights`,
        params: { metric, breakdown, metric_type: 'total_value' },
        accessToken,
        context,
        accountId,
      });

      const out: Record<string, number> = {};
      for (const entry of body.data ?? []) {
        const total = entry.total_value?.value;
        if (typeof total === 'number') out[metric] = total;
        const rows = entry.total_value?.breakdowns?.[0]?.results ?? [];
        for (const r of rows) {
          const label = (r.dimension_values ?? []).join('|');
          if (!label || typeof r.value !== 'number') continue;
          out[`${metric}__${label.toLowerCase()}`] = r.value;
        }
        if (out[metric] === undefined) {
          const fallback = entry.values?.[0]?.value;
          if (typeof fallback === 'number') out[metric] = fallback;
        }
      }
      return out;
    } catch (err) {
      this.logger.warn(
        `insights breakdown ${metric}/${breakdown} failed (${ctx}): ${this.extractMetaError(err)}`,
      );
      return {};
    }
  }

  /**
   * Pull Meta's specific error message out of an `AdapterFetchError.body`
   * (Graph errors are `{error:{message,code,error_subcode,...}}`). Falls back
   * to the JS error string when the body is missing or malformed.
   */
  private extractMetaError(err: unknown): string {
    if (err && typeof err === 'object' && 'body' in err) {
      const body = (err as { body?: unknown }).body as
        | { error?: { message?: string; code?: number; error_subcode?: number } }
        | undefined;
      const message = body?.error?.message;
      if (message) {
        const code = body?.error?.code;
        const sub = body?.error?.error_subcode;
        const tag = code ? `#${code}${sub ? `/${sub}` : ''}` : '';
        return tag ? `(${tag}) ${message}` : message;
      }
    }
    return err instanceof Error ? err.message : String(err);
  }

  private insightMetricsForMedia(media: GraphMedia): string[] {
    // Graph v22 metric sets by media type. Meta rejects the whole batch if
    // ANY metric isn't valid for the type, and breakdown-restricted metrics
    // can't be combined with anything else, so these sets are strict:
    //   • `impressions` was REMOVED in v22 for all IG media (use `reach` /
    //     `views` instead).
    //   • `saved` is valid for IMAGE/CAROUSEL/VIDEO/REELS but NOT for STORY.
    //   • `views` is valid for VIDEO/REELS/STORY, NOT IMAGE/CAROUSEL.
    //   • REELS does NOT accept `follows` / `profile_visits` / `profile_activity`
    //     — those exist only on FEED and STORY.
    //   • `profile_activity` and `navigation` REQUIRE their own breakdown
    //     calls (action_type / story_navigation_action_type respectively)
    //     and are fetched in fetchInsightBreakdown(), not here.
    const pt = (media.media_product_type ?? '').toUpperCase();
    const mt = (media.media_type ?? '').toUpperCase();

    if (pt === 'STORY' || mt === 'STORY') {
      return [
        'reach',
        'replies',
        'shares',
        'total_interactions',
        'follows',
        'profile_visits',
      ];
    }
    if (pt === 'REELS') {
      return [
        'reach',
        'saved',
        'likes',
        'comments',
        'shares',
        'total_interactions',
        'views',
      ];
    }
    if (mt === 'VIDEO') {
      // FEED video (legacy IG video posted to feed, not Reels).
      return [
        'reach',
        'saved',
        'likes',
        'comments',
        'shares',
        'total_interactions',
        'views',
        'follows',
        'profile_visits',
      ];
    }
    // IMAGE / CAROUSEL_ALBUM / FEED
    return [
      'reach',
      'saved',
      'likes',
      'comments',
      'shares',
      'total_interactions',
      'follows',
      'profile_visits',
    ];
  }

  private mapInsightsData(
    data: Array<{ name: string; values?: Array<{ value: unknown }> }>,
  ): Partial<ContentMetrics> {
    const out: Partial<ContentMetrics> = {};
    const extra: Record<string, number> = {};
    for (const entry of data) {
      const first = entry.values?.[0]?.value;
      if (typeof first !== 'number') continue;
      switch (entry.name) {
        case 'reach':
          out.reach = first;
          break;
        case 'saved':
          out.saves = first;
          break;
        case 'shares':
          out.shares = first;
          break;
        case 'views':
          out.views = first;
          break;
        case 'impressions':
          out.impressions = first;
          break;
        default:
          extra[entry.name] = first;
      }
    }
    if (Object.keys(extra).length > 0) out.extra = extra;
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
