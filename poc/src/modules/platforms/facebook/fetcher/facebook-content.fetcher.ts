// Facebook content fetcher. Phase C.
//
// /posts is the single source of truth for Page content (photos, text,
// videos, Reels) — yields the composite `{page_id}_{post_id}` id and lets
// us walk paging.next. Each post is enriched with a per-id /insights call
// (or /video_insights for the rare pure-video numeric id).
//
// Dead `fetchVideos` and `looksLikeInsightsScopeError` from the old adapter
// are intentionally NOT migrated — see docs/platform-refactor.md §3.1.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BoundGraphClient } from '../../shared/meta-graph/graph-client';
import type { PlatformAdapterContext } from '../../shared/platform-adapter.port';
import type {
  ContentData,
  FetchOpts,
} from '../../shared/platform-types';
import {
  GraphInsight,
  GraphListResponse,
  extractAccountId,
  extractGraphError,
  extractMetaError,
  parseNextUrl,
} from '../../shared/meta-graph';
import { rethrowCritical } from '../../shared/fetch-guards';
import { DEFAULT_PAGE_SIZE } from '../facebook.constants';
import { buildFacebookContext } from '../facebook.context';
import { FACEBOOK_GRAPH_CLIENT } from '../facebook.tokens';
import type { FacebookPost } from '../facebook.types';
import {
  mergePostInsights,
  postToContent,
} from '../mapper/facebook-post.mapper';
import { mergeVideoInsights } from '../mapper/facebook-video.mapper';

/**
 * Max-capture /posts fields beyond the lite set. Standard Page-post fields:
 * native share count, post kind (status_type), publish state, tagged
 * people/pages and the tagged place. Each one degrades independently.
 */
const EXTRA_POST_FIELDS = [
  'shares',
  'status_type',
  'is_published',
  'message_tags',
  'place',
] as const;

@Injectable()
export class FacebookContentFetcher {
  private readonly logger = new Logger(FacebookContentFetcher.name);

  constructor(
    @Inject(FACEBOOK_GRAPH_CLIENT)
    private readonly client: BoundGraphClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    const limit = opts.limit ?? DEFAULT_PAGE_SIZE;
    const ctx = buildFacebookContext(accessToken, canonicalId, metadata);
    const accountId = extractAccountId(metadata);
    const perSourceLimit = Math.min(limit, DEFAULT_PAGE_SIZE);

    const fetched = await this.fetchPosts(
      accessToken,
      canonicalId,
      perSourceLimit,
      ctx,
      accountId,
      opts,
    );
    fetched.sort((a, b) => {
      const aTs = a.item.publishedAt ? a.item.publishedAt.getTime() : 0;
      const bTs = b.item.publishedAt ? b.item.publishedAt.getTime() : 0;
      return bTs - aTs;
    });
    const trimmed = fetched.slice(0, limit);
    const trimmedItems = trimmed.map((t) => t.item);

    // Single batch call to /{page_id}/videos populates view counts for
    // every video on the page in one shot — beats per-post insights
    // calls and works on BC-managed pages where /post/insights returns
    // silent empty. Uses each post's attachments[].target.id (which IS
    // the video_id for video posts, verified empirically) to map.
    await this.enrichWithVideoViews(
      trimmed,
      canonicalId,
      accessToken,
      ctx,
      accountId,
    );

    await this.enrichPostsWithInsights(trimmedItems, accessToken, ctx, accountId);
    return trimmedItems;
  }

  /**
   * Single /{page_id}/videos batch fetch. Builds a map (video_id → views)
   * and stamps every post whose attachment-target matches into
   * metrics.views (mirrored to metrics.impressions when not already set).
   * Free, works on every Page including BC-managed agency pages.
   */
  private async enrichWithVideoViews(
    pairs: Array<{ post: FacebookPost; item: ContentData }>,
    canonicalId: string,
    accessToken: string,
    ctx: PlatformAdapterContext,
    accountId: bigint | undefined,
  ): Promise<void> {
    if (pairs.length === 0) return;
    let body: GraphListResponse<{ id?: string; views?: number; length?: number }>;
    try {
      body = await this.client.call<
        GraphListResponse<{ id?: string; views?: number; length?: number }>
      >({
        endpoint: `/${canonicalId}/videos`,
        params: { fields: 'id,views,length', limit: 100 },
        accessToken,
        context: ctx,
        accountId,
      });
    } catch (err) {
      rethrowCritical(err);
      this.logger.debug(
        `videos batch failed for ${canonicalId}: ${extractMetaError(err)}`,
      );
      return;
    }
    const viewsByVideoId = new Map<string, number>();
    for (const v of body.data ?? []) {
      if (v.id && typeof v.views === 'number') {
        viewsByVideoId.set(v.id, v.views);
      }
    }
    if (viewsByVideoId.size === 0) return;

    for (const { post, item } of pairs) {
      // Walk attachments looking for a target.id that matches a video.
      // Video posts have one attachment with type='video_inline' (or
      // similar) and target.id = video_id; carousels with a video sub
      // have it nested under subattachments.
      const targetIds = collectAttachmentTargetIds(post);
      let totalViews = 0;
      let matched = false;
      for (const tid of targetIds) {
        const v = viewsByVideoId.get(tid);
        if (typeof v === 'number') {
          totalViews += v;
          matched = true;
        }
      }
      if (!matched) continue;
      item.metrics = item.metrics ?? {};
      item.metrics.views = totalViews;
      // Don't mirror to metrics.impressions — that field is
      // intentionally unset on FB now that v22 retired
      // post_impressions and rebranded the replacement to "Views".
    }
  }

  private async fetchPosts(
    accessToken: string,
    canonicalId: string,
    limit: number,
    ctx: PlatformAdapterContext,
    accountId: bigint | undefined,
    opts: FetchOpts,
  ): Promise<Array<{ post: FacebookPost; item: ContentData }>> {
    const collected: Array<{ post: FacebookPost; item: ContentData }> = [];
    let nextEndpoint = `/${canonicalId}/posts`;

    // v22 rejects inline `insights.metric(...)` expansion on /posts even
    // with the right scopes. Fetch with metadata-only fields and enrich
    // separately. `comments.summary(total_count)` and
    // `reactions.summary(total_count)` ride free on the same call.
    // Video views come from a separate /{page_id}/videos call
    // (one batch instead of one per post) and are merged in via
    // mapPostsToVideoViews — see fetch().
    const liteFields =
      'id,message,created_time,permalink_url,full_picture,attachments,' +
      'comments.summary(total_count),reactions.summary(total_count)';
    // Max-capture extras (docs/max-capture-all-platforms.md) ride on the
    // same call. If Graph rejects one (#100 — permissions or API-version
    // drift), dropRejectedField() removes JUST that field and the page is
    // retried, so a bad field can never break the sync or the other extras.
    let extraFields: string[] = [...EXTRA_POST_FIELDS];
    const fieldsOf = (): string =>
      extraFields.length > 0
        ? `${liteFields},${extraFields.join(',')}`
        : liteFields;

    let nextParams: Record<string, string | number | undefined> = {
      limit: Math.min(limit, DEFAULT_PAGE_SIZE),
    };

    while (collected.length < limit && nextEndpoint) {
      let body: GraphListResponse<FacebookPost>;
      try {
        body = await this.client.call<GraphListResponse<FacebookPost>>({
          endpoint: nextEndpoint,
          params: { ...nextParams, fields: fieldsOf() },
          accessToken,
          context: ctx,
          accountId,
        });
      } catch (err) {
        rethrowCritical(err);
        const remaining = this.dropRejectedField(extraFields, err);
        if (remaining !== null) {
          extraFields = remaining;
          continue; // retry the SAME page without the rejected field(s)
        }
        throw err;
      }

      for (const post of body.data ?? []) {
        if (!withinTimeWindow(post.created_time, opts)) continue;
        collected.push({ post, item: postToContent(post) });
        if (collected.length >= limit) break;
      }

      const nextUrl = body.paging?.next;
      if (!nextUrl || collected.length >= limit) break;
      const parsed = parseNextUrl(nextUrl);
      nextEndpoint = parsed.endpoint;
      nextParams = { ...parsed.params };
      delete nextParams.fields; // fieldsOf() decides, not the paging URL
    }

    return collected;
  }

  /**
   * When Graph rejects the extended /posts field list, work out which extra
   * field(s) to drop. Returns the reduced list (retry), or null when this
   * isn't a droppable field error (rethrow). Each drop removes ≥1 field, so
   * retries are bounded by EXTRA_POST_FIELDS.length.
   */
  private dropRejectedField(
    extraFields: string[],
    err: unknown,
  ): string[] | null {
    if (extraFields.length === 0) return null;
    const { code } = extractGraphError(err);
    const msg = extractMetaError(err);
    const looksLikeFieldError =
      code === 100 || /nonexisting field|invalid field/i.test(msg);
    if (!looksLikeFieldError) return null;
    const named = extraFields.filter((f) => new RegExp(`\\b${f}\\b`).test(msg));
    // Error didn't name a field we sent → drop all extras in one step.
    const toDrop = named.length > 0 ? named : extraFields;
    this.logger.warn(
      `extended /posts fields rejected (${msg}) — dropping [${toDrop.join(', ')}] for this run`,
    );
    return extraFields.filter((f) => !toDrop.includes(f));
  }

  /**
   * Enriches each content item with real metrics via a second Graph call.
   * Composite-id posts → `/{id}/insights?metric=post_*`.
   * Pure-numeric video ids → `/{id}/video_insights?metric=total_video_*`.
   *
   * Adaptive skip: BC-managed pages (most agencies) silently return
   * `data: []` from /post/insights for every post. To avoid wasting N
   * calls per refresh on these pages, we probe the FIRST batch and if
   * every result was empty, we abort the remaining N-batchSize calls.
   * Re-tested every refresh so a change in Meta's behaviour is picked
   * up automatically — no persistent flag, no schema migration.
   *
   * Items still get the inline data we collected via field expansion
   * (reactions, comments, video.views via attachments).
   */
  private async enrichPostsWithInsights(
    items: ContentData[],
    accessToken: string,
    ctx: PlatformAdapterContext,
    accountId: bigint | undefined,
  ): Promise<void> {
    if (items.length === 0) return;
    const BATCH_SIZE = 5;
    const PROBE_BATCHES = 1;

    let nonEmptyHits = 0;
    let probedItems = 0;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      const beforeCount = countWithInsights(batch);
      await Promise.all(
        batch.map((item) =>
          this.enrichOneItem(item, accessToken, ctx, accountId),
        ),
      );
      const afterCount = countWithInsights(batch);
      const newHits = afterCount - beforeCount;
      nonEmptyHits += newHits;
      probedItems += batch.length;

      const batchIndex = Math.floor(i / BATCH_SIZE);
      if (batchIndex + 1 >= PROBE_BATCHES && nonEmptyHits === 0) {
        const remaining = items.length - probedItems;
        if (remaining > 0) {
          this.logger.debug(
            `skipping ${remaining} /post/insights calls — first ${probedItems} returned silent-empty (BC-restricted page); inline reactions/views from field expansion remain in place`,
          );
        }
        return;
      }
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
        // Meta v22 (post-2025-11-15): post_impressions* retired.
        // post_media_view = total views (formerly post_impressions,
        // rebranded "Views" in Meta's UI). All post types.
        'post_media_view',
        // post_total_media_view_unique = unique users reached
        // (formerly post_impressions_unique, retired Jun-15-2025).
        // Meta documents this as the canonical reach metric in v25.
        // Returns 0 silently when read_insights scope is missing.
        'post_total_media_view_unique',
        'post_reactions_by_type_total',
        'post_clicks_by_type',
        'post_activity_by_action_type',
        'post_video_views',
        // NB on excluded metrics:
        //   • post_reach / post_impressions — empirically INVALID in
        //     v22 (#100). Including either poisons the whole batch,
        //     so we use post_media_view + post_total_media_view_unique
        //     above instead.
        //   • post_negative_feedback / post_engaged_users — rejected
        //     here (documented for page-level only).
      ].join(',');
      try {
        const body = await this.client.call<{ data?: GraphInsight[] }>({
          endpoint: `/${item.platformContentId}/insights`,
          params: { metric: metrics },
          accessToken,
          context: ctx,
          accountId,
        });
        mergePostInsights(item, body.data ?? []);
      } catch (err) {
        rethrowCritical(err);
        this.logger.debug(
          `post insights failed for ${item.platformContentId}: ${extractMetaError(err)}`,
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
      const body = await this.client.call<{ data?: GraphInsight[] }>({
        endpoint: `/${item.platformContentId}/video_insights`,
        params: { metric: videoMetrics },
        accessToken,
        context: ctx,
        accountId,
      });
      mergeVideoInsights(item, body.data ?? []);
    } catch (err) {
      rethrowCritical(err);
      this.logger.debug(
        `video insights failed for ${item.platformContentId}: ${extractMetaError(err)}`,
      );
    }
  }
}

function withinTimeWindow(
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
 * Counts how many items have at least one insight-derived metric set.
 * Used by adaptive-skip to decide whether /post/insights is worth
 * continuing. `reach` only comes from /post/insights (post_reach);
 * `views` may already be set from the /videos batch, so we ignore it
 * here. `extra` keys (reaction breakdown, clicks_by_type, …) also
 * only land via /post/insights.
 */
function countWithInsights(items: ContentData[]): number {
  let n = 0;
  for (const it of items) {
    if (typeof it.metrics?.reach === 'number') {
      n++;
      continue;
    }
    const extra = it.metrics?.extra;
    if (extra && Object.keys(extra).length > 0) n++;
  }
  return n;
}

/**
 * Walk every attachment + subattachment on a post and yield each
 * `target.id` (the video id for video posts). Used to match posts to
 * /videos batch results.
 */
function collectAttachmentTargetIds(post: FacebookPost): string[] {
  const ids: string[] = [];
  for (const a of post.attachments?.data ?? []) {
    const t = (a as { target?: { id?: string } }).target;
    if (t?.id) ids.push(t.id);
    for (const sub of a.subattachments?.data ?? []) {
      const st = (sub as { target?: { id?: string } }).target;
      if (st?.id) ids.push(st.id);
    }
  }
  return ids;
}
