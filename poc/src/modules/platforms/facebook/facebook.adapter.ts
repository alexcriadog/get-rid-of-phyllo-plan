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

const GRAPH_VERSION = 'v22.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_PAGE_SIZE = 25;

type AccountInsightsCounterMap = {
  impressions: number;
  reach: number;
  profileViews: number;
  totalInteractions: number;
  page_follows: number;
};

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

/** Page Stories API row — see https://developers.facebook.com/docs/page-stories-api/. */
interface FacebookStory {
  post_id: string;
  status?: 'PUBLISHED' | 'ARCHIVED';
  /** UNIX timestamp (seconds). */
  creation_time?: number;
  media_type?: 'video' | 'photo';
  media_id?: string;
  /** Public Facebook story URL. */
  url?: string;
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
 *
 * Shape is intentionally a near-clone of InstagramAdapter: same Graph base,
 * same callGraph chokepoint, same rate-bucket + api_call_log + raw-archive
 * pipeline. The differences are endpoint shapes and the audience parsing
 * logic (FB returns `F.18-24` style keys under page_fans_gender_age).
 *
 * Stories: served by the Page Stories API (GA in v22) — see fetchStories().
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
      stories: {
        // Page Stories API — GA in v22. Returns {post_id,status,creation_time,
        // media_type,media_id,url}. Insights for individual stories aren't
        // exposed by Meta on this endpoint (no per-story metrics today), so
        // metric fields are declared as `empty_possible`.
        permalink: 'supported',
        publishedAt: 'supported',
        mediaUrls: 'empty_possible',
        likes: 'not_supported',
        reach: 'not_supported',
        replies: 'not_supported',
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
    const ctx = this.context(accessToken, canonicalId, metadata);
    const accountId = this.accountIdFromMeta(metadata);

    // Meta removed demographic breakdowns (country / gender_age / city) for
    // Facebook Pages in v22. What's still available are activity counters.
    // Pull them in parallel with period=day and aggregate over 28 days so
    // the admin panel has meaningful totals + a follower time series.
    const PERIOD_DAYS = 28;
    const until = Math.floor(Date.now() / 1000);
    const since = until - PERIOD_DAYS * 86_400;

    type MetricSpec = {
      name: string;
      mapTo?: keyof AccountInsightsCounterMap;
      timeSeries?: boolean;
    };
    const specs: MetricSpec[] = [
      { name: 'page_follows', mapTo: 'page_follows', timeSeries: true },
      { name: 'page_media_view', mapTo: 'impressions' },
      { name: 'page_total_media_view_unique', mapTo: 'reach' },
      { name: 'page_views_total', mapTo: 'profileViews' },
      { name: 'page_total_actions', mapTo: 'totalInteractions' },
    ];

    const results = await Promise.all(
      specs.map(async (spec) => {
        try {
          const body = await this.callGraph<{ data?: GraphInsight[] }>({
            endpoint: `/${canonicalId}/insights`,
            params: { metric: spec.name, period: 'day', since, until },
            accessToken,
            context: ctx,
            accountId,
          });
          return { spec, body, error: null as string | null };
        } catch (err) {
          return {
            spec,
            body: null as { data?: GraphInsight[] } | null,
            error: this.audienceErrorMessage(err),
          };
        }
      }),
    );

    const counters: AccountInsightsCounterMap = {
      impressions: 0,
      reach: 0,
      profileViews: 0,
      totalInteractions: 0,
      page_follows: 0,
    };
    const followerSeries: Array<{ endTime: string; value: number }> = [];
    const errors: string[] = [];

    for (const r of results) {
      if (r.error || !r.body) {
        errors.push(`${r.spec.name}: ${r.error ?? 'no body'}`);
        continue;
      }
      for (const insight of r.body.data ?? []) {
        const values = insight.values ?? [];
        let total = 0;
        for (const v of values) {
          if (typeof v.value === 'number') {
            total += v.value;
            if (r.spec.timeSeries && v.end_time) {
              followerSeries.push({ endTime: v.end_time, value: v.value });
            }
          }
        }
        if (r.spec.mapTo) counters[r.spec.mapTo] += total;
      }
    }

    if (errors.length === specs.length) {
      throw new AdapterFetchError(
        this.platform,
        `/${canonicalId}/insights`,
        new Error('All audience metrics rejected'),
        `FB audience unavailable for ${canonicalId}. Graph rejected every metric: ${errors.join(
          ' | ',
        )}. Likely causes: (1) OAuth user has no ANALYZE task on this Page; (2) app lacks Advanced Access to 'read_insights' / 'pages_read_engagement'; (3) token missing those scopes.`,
      );
    }

    return {
      genderDistribution: [],
      ageDistribution: [],
      countryDistribution: [],
      cityDistribution: [],
      accountInsights: {
        periodDays: PERIOD_DAYS,
        impressions: counters.impressions,
        reach: counters.reach,
        profileViews: counters.profileViews,
        totalInteractions: counters.totalInteractions,
        followerCountSeries: followerSeries,
        extra: {
          page_follows_28d: counters.page_follows,
        },
      },
      fetchedAt: new Date(),
    };
  }

  /**
   * Fetch one Page Insights metric, trying the modern name first and falling
   * back to the legacy name on 400. Returns the raw `Object.entries` lists
   * (one per insight datapoint) so the caller can split into gender/age or
   * country buckets.
   */
  private async fetchAudienceMetric(
    spec: { modern: string; legacy: string; bucket: 'country' | 'gender_age' },
    accessToken: string,
    canonicalId: string,
    ctx: PlatformAdapterContext,
    accountId: bigint | undefined,
  ): Promise<{ entries: Array<Array<[string, number]>>; error?: string }> {
    const candidates = [spec.modern, spec.legacy];
    let lastError: string | undefined;
    for (const metric of candidates) {
      try {
        const body = await this.callGraph<{ data?: GraphInsight[] }>({
          endpoint: `/${canonicalId}/insights`,
          params: { metric, period: 'lifetime' },
          accessToken,
          context: ctx,
          accountId,
        });
        const out: Array<Array<[string, number]>> = [];
        for (const insight of body.data ?? []) {
          const values = insight.values ?? [];
          const sample =
            values[values.length - 1]?.value ?? values[0]?.value;
          if (!sample || typeof sample !== 'object') continue;
          out.push(Object.entries(sample as Record<string, number>));
        }
        return { entries: out };
      } catch (err) {
        lastError = this.audienceErrorMessage(err);
        // If the error isn't an unknown-metric error, no point retrying with
        // the legacy name — propagate the original failure.
        if (!/nonexisting field|unknown.*metric|deprecated/i.test(lastError)) {
          break;
        }
      }
    }
    return { entries: [], error: lastError ?? 'unknown error' };
  }

  private audienceErrorMessage(err: unknown): string {
    if (err && typeof err === 'object') {
      const e = err as {
        body?: { error?: { message?: string; code?: number } };
        message?: string;
      };
      const graphErr = e.body?.error;
      if (graphErr?.message) {
        return graphErr.code ? `(#${graphErr.code}) ${graphErr.message}` : graphErr.message;
      }
      if (typeof e.message === 'string') return e.message;
    }
    return String(err);
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

    // /posts returns all Page content (photos, text, videos, Reels) with the
    // composite `{page_id}_{post_id}` id. The /videos endpoint returns the
    // same Reels with a pure numeric id and no accessible insights edge, so
    // we'd just be storing duplicates. Single source of truth: /posts.
    const posts = await this.fetchPosts(
      accessToken,
      canonicalId,
      perSourceLimit,
      ctx,
      accountId,
      opts,
    );
    posts.sort((a, b) => {
      const aTs = a.publishedAt ? a.publishedAt.getTime() : 0;
      const bTs = b.publishedAt ? b.publishedAt.getTime() : 0;
      return bTs - aTs;
    });

    const trimmed = posts.slice(0, limit);
    await this.enrichPostsWithInsights(trimmed, accessToken, ctx, accountId);
    return trimmed;
  }

  /**
   * Page Stories API — `GET /{page_id}/stories`. GA in v22.
   * Returns published + archived stories with `post_id`, `status`,
   * `creation_time` (UNIX seconds), `media_type` (`video`|`photo`),
   * `media_id` and a public `url`. Permissions: `pages_read_engagement`
   * + `pages_show_list` (already in FB_SCOPES) plus the OAuth user must
   * have CREATE_CONTENT on the Page.
   *
   * No per-story insights endpoint is exposed today, so metrics are left
   * empty — the SupportMatrix declares them `not_supported`/`empty_possible`.
   */
  async fetchStories(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    const ctx = this.context(accessToken, canonicalId, metadata);
    const accountId = this.accountIdFromMeta(metadata);

    const body = await this.callGraph<GraphListResponse<FacebookStory>>({
      endpoint: `/${canonicalId}/stories`,
      params: {
        fields: 'post_id,status,creation_time,media_type,media_id,url',
      },
      accessToken,
      context: ctx,
      accountId,
    });

    const out: ContentData[] = [];
    for (const story of body.data ?? []) {
      if (!story.post_id) continue;
      out.push(this.storyToContent(story));
    }
    return out;
  }

  private storyToContent(story: FacebookStory): ContentData {
    const serialized = JSON.stringify(story);
    const hash = createHash('sha256').update(serialized).digest('hex');
    const publishedAt =
      typeof story.creation_time === 'number'
        ? new Date(story.creation_time * 1000)
        : null;

    return {
      platformContentId: story.post_id,
      contentType: 'story',
      caption: null,
      permalink: story.url ?? null,
      // Page Stories API returns a `media_id` only — resolving it to a
      // playable URL is an extra `/{media_id}?fields=source|images` call
      // that we skip on this iteration. Consumers that need the asset can
      // hit the permalink (`url`) which renders publicly on Facebook.
      mediaUrls: [],
      thumbnailUrl: null,
      metrics: {
        extra: {
          ...(story.media_id ? { fb_media_id: Number(story.media_id) || 0 } : {}),
        },
      },
      publishedAt,
      fetchedAt: new Date(),
      mediaProductType: 'STORY',
      rawResponse: {
        collection: MONGO_COLLECTIONS.rawPlatformResponses,
        contentHash: hash,
      },
    };
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

    // v22 rejects inline `insights.metric(...)` expansion on /posts even with
    // the right scopes. Always fetch posts with metadata-only fields and
    // enrich reactions/impressions with a separate per-post /insights call
    // (see enrichPostsWithInsights). This matches the working pattern in the
    // reference SocialMediaMetaAuthentication project.
    const liteFields =
      'id,message,created_time,permalink_url,full_picture,attachments';

    let nextParams: Record<string, string | number | undefined> = {
      fields: liteFields,
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
      nextParams = { ...parsed.params, fields: liteFields };
    }

    return collected;
  }

  /**
   * Enriches each content item with real metrics via a second Graph call.
   * Posts (composite `{page_id}_{post_id}`) → `/{id}/insights?metric=post_*`.
   * Videos (pure numeric id) → `/{id}/video_insights?metric=total_video_*`.
   * Runs in parallel batches, swallows per-item failures at debug level.
   */
  private async enrichPostsWithInsights(
    items: ContentData[],
    accessToken: string,
    ctx: PlatformAdapterContext,
    accountId: bigint | undefined,
  ): Promise<void> {
    if (items.length === 0) return;
    const BATCH_SIZE = 5;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map((item) => this.enrichOneItem(item, accessToken, ctx, accountId)),
      );
    }
  }

  private async enrichOneItem(
    item: ContentData,
    accessToken: string,
    ctx: PlatformAdapterContext,
    accountId: bigint | undefined,
  ): Promise<void> {
    const isComposite = item.platformContentId.includes('_');
    if (isComposite) {
      const metrics = [
        'post_media_view',
        'post_reactions_by_type_total',
        'post_clicks_by_type',
        'post_activity_by_action_type',
        'post_video_views',
      ].join(',');
      try {
        const body = await this.callGraph<{ data?: GraphInsight[] }>({
          endpoint: `/${item.platformContentId}/insights`,
          params: { metric: metrics },
          accessToken,
          context: ctx,
          accountId,
        });
        this.mergePostInsights(item, body.data ?? []);
      } catch (err) {
        this.logger.debug(
          `post insights failed for ${item.platformContentId}: ${this.audienceErrorMessage(
            err,
          )}`,
        );
      }
      return;
    }

    // Video fallback — /{video_id}/video_insights
    const videoMetrics = [
      'total_video_views',
      'total_video_views_unique',
      'total_video_impressions',
      'total_video_reactions_by_type_total',
    ].join(',');
    try {
      const body = await this.callGraph<{ data?: GraphInsight[] }>({
        endpoint: `/${item.platformContentId}/video_insights`,
        params: { metric: videoMetrics },
        accessToken,
        context: ctx,
        accountId,
      });
      this.mergeVideoInsights(item, body.data ?? []);
    } catch (err) {
      this.logger.debug(
        `video insights failed for ${item.platformContentId}: ${this.audienceErrorMessage(
          err,
        )}`,
      );
    }
  }

  private mergeVideoInsights(item: ContentData, data: GraphInsight[]): void {
    const extra = item.metrics.extra ?? {};
    for (const insight of data) {
      const values = insight.values ?? [];
      const first = values[values.length - 1]?.value ?? values[0]?.value;
      if (insight.name === 'total_video_views' && typeof first === 'number') {
        item.metrics.views = first;
      } else if (
        insight.name === 'total_video_views_unique' &&
        typeof first === 'number'
      ) {
        item.metrics.reach = first;
      } else if (
        insight.name === 'total_video_impressions' &&
        typeof first === 'number'
      ) {
        item.metrics.impressions = first;
      } else if (
        insight.name === 'total_video_reactions_by_type_total' &&
        first !== null &&
        typeof first === 'object'
      ) {
        const reactions = first as Record<string, number>;
        const total = Object.values(reactions).reduce(
          (sum, v) => (typeof v === 'number' ? sum + v : sum),
          0,
        );
        item.metrics.likes = total;
        for (const [k, v] of Object.entries(reactions)) {
          if (typeof v === 'number') extra[`reaction_${k}`] = v;
        }
      } else if (typeof first === 'number') {
        extra[insight.name] = first;
      }
    }
    item.metrics.extra = extra;
  }

  private mergePostInsights(post: ContentData, data: GraphInsight[]): void {
    const extra = post.metrics.extra ?? {};
    for (const insight of data) {
      const values = insight.values ?? [];
      const first = values[values.length - 1]?.value ?? values[0]?.value;
      if (insight.name === 'post_media_view' && typeof first === 'number') {
        // `post_media_view` is impressions. Meta removed per-post unique reach
        // in v22 (`post_impressions_unique` was deprecated) so we do NOT set
        // `reach` here — leaving it undefined is honest rather than
        // pretending impressions equals reach.
        post.metrics.impressions = first;
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
        post.metrics.likes = total;
        for (const [k, v] of Object.entries(reactions)) {
          if (typeof v === 'number') extra[`reaction_${k}`] = v;
        }
      } else if (
        insight.name === 'post_clicks_by_type' &&
        first !== null &&
        typeof first === 'object'
      ) {
        const clicks = first as Record<string, number>;
        for (const [k, v] of Object.entries(clicks)) {
          if (typeof v === 'number') extra[`click_${k.replace(/\s+/g, '_')}`] = v;
        }
      } else if (
        insight.name === 'post_activity_by_action_type' &&
        first !== null &&
        typeof first === 'object'
      ) {
        const activity = first as Record<string, number>;
        for (const [k, v] of Object.entries(activity)) {
          if (typeof v === 'number') extra[`activity_${k.replace(/\s+/g, '_')}`] = v;
        }
      } else if (typeof first === 'number') {
        extra[insight.name] = first;
      }
    }
    post.metrics.extra = extra;
  }

  private looksLikeInsightsScopeError(err: unknown): boolean {
    const msg = this.audienceErrorMessage(err);
    return /insights|read_insights|nonexisting field|permission|#10\b|#100\b|#200\b/i.test(
      msg,
    );
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
      throw new AdapterFetchError(
        this.platform,
        opts.endpoint,
        err,
        undefined,
        axErr.response?.data,
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
