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
  extractMetaError,
  parseNextUrl,
} from '../../shared/meta-graph';
import { DEFAULT_PAGE_SIZE } from '../facebook.constants';
import { buildFacebookContext } from '../facebook.context';
import { FACEBOOK_GRAPH_CLIENT } from '../facebook.tokens';
import type { FacebookPost } from '../facebook.types';
import {
  mergePostInsights,
  postToContent,
} from '../mapper/facebook-post.mapper';
import { mergeVideoInsights } from '../mapper/facebook-video.mapper';

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
    // (see enrichPostsWithInsights). `comments.summary(total_count)` and
    // `reactions.summary(total_count)` ride free on the same call.
    const liteFields =
      'id,message,created_time,permalink_url,full_picture,attachments,' +
      'comments.summary(total_count),reactions.summary(total_count)';

    let nextParams: Record<string, string | number | undefined> = {
      fields: liteFields,
      limit: Math.min(limit, DEFAULT_PAGE_SIZE),
    };

    while (collected.length < limit && nextEndpoint) {
      const body = await this.client.call<GraphListResponse<FacebookPost>>({
        endpoint: nextEndpoint,
        params: nextParams,
        accessToken,
        context: ctx,
        accountId,
      });

      for (const post of body.data ?? []) {
        if (!withinTimeWindow(post.created_time, opts)) continue;
        collected.push(postToContent(post));
        if (collected.length >= limit) break;
      }

      const nextUrl = body.paging?.next;
      if (!nextUrl || collected.length >= limit) break;
      const parsed = parseNextUrl(nextUrl);
      nextEndpoint = parsed.endpoint;
      nextParams = { ...parsed.params, fields: liteFields };
    }

    return collected;
  }

  /**
   * Enriches each content item with real metrics via a second Graph call.
   * Composite-id posts → `/{id}/insights?metric=post_*`.
   * Pure-numeric video ids → `/{id}/video_insights?metric=total_video_*`.
   * Runs in parallel batches; per-item failures swallowed at debug.
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
        batch.map((item) =>
          this.enrichOneItem(item, accessToken, ctx, accountId),
        ),
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
        // NB: post_negative_feedback and post_engaged_users are documented
        // for the Page-level endpoint but Meta rejects them inside this
        // /{post_id}/insights batch with `(#100) must be a valid insights
        // metric`. A per-post negative feedback path would need its own
        // call (with breakdown=type) — keep them out of this batch.
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
