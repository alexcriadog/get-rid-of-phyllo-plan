// Threads content fetcher.
//
// /me/threads is the source of truth for the connected user's posts. We
// request the metadata-only field set, paginate via paging.next, filter the
// time window client-side, then enrich each item with /{thread_id}/insights
// for likes/views/replies/reposts/quotes (mirrors FB's two-call pattern).
//
// Request budget: ~1 list call per page (DEFAULT_PAGE_SIZE) + 1 insights
// call per post. We cap concurrency at 5 to keep within the 200/h Threads
// quota (the chokepoint will deny further calls if the bucket runs dry).

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BoundThreadsClient } from '../../shared/threads-api/threads-client';
import type {
  ThreadsApiResponse,
  ThreadsInsight,
  ThreadsPost,
} from '../../shared/threads-api/threads-types';
import { parseThreadsNextUrl } from '../../shared/threads-api/threads-paging';
import {
  extractAccountId,
  extractMetaError,
} from '../../shared/meta-graph';
import type { PlatformAdapterContext } from '../../shared/platform-adapter.port';
import type {
  ContentData,
  FetchOpts,
} from '../../shared/platform-types';
import { buildThreadsContext } from '../threads.context';
import { THREADS_API_CLIENT } from '../threads.tokens';
import {
  mergeThreadsPostInsights,
  threadsPostToContent,
} from '../mapper/threads-post.mapper';

const LIST_FIELDS = [
  'id',
  'media_product_type',
  'media_type',
  'text',
  'permalink',
  'timestamp',
  'shortcode',
  'thumbnail_url',
  'media_url',
  'owner',
  'username',
  'is_quote_post',
  'has_replies',
  'reply_audience',
  'alt_text',
  'children{id,media_type,media_url,thumbnail_url,permalink}',
].join(',');

const POST_INSIGHT_METRICS = ['views', 'likes', 'replies', 'reposts', 'quotes'].join(',');

const DEFAULT_PAGE_SIZE = 25;
const ENRICH_BATCH = 5;

@Injectable()
export class ThreadsContentFetcher {
  private readonly logger = new Logger(ThreadsContentFetcher.name);

  constructor(
    @Inject(THREADS_API_CLIENT)
    private readonly client: BoundThreadsClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    const limit = opts.limit ?? DEFAULT_PAGE_SIZE;
    const ctx = buildThreadsContext(accessToken, canonicalId, metadata);
    const accountId = extractAccountId(metadata);

    const items = await this.fetchList(
      accessToken,
      canonicalId,
      limit,
      ctx,
      accountId,
      opts,
    );

    items.sort((a, b) => {
      const aTs = a.publishedAt ? a.publishedAt.getTime() : 0;
      const bTs = b.publishedAt ? b.publishedAt.getTime() : 0;
      return bTs - aTs;
    });

    const trimmed = items.slice(0, limit);
    await this.enrichWithInsights(trimmed, accessToken, ctx, accountId);
    return trimmed;
  }

  private async fetchList(
    accessToken: string,
    canonicalId: string,
    limit: number,
    ctx: PlatformAdapterContext,
    accountId: bigint | undefined,
    opts: FetchOpts,
  ): Promise<ContentData[]> {
    const collected: ContentData[] = [];
    let nextEndpoint = `/${canonicalId}/threads`;
    let nextParams: Record<string, string | number | undefined> = {
      fields: LIST_FIELDS,
      limit: Math.min(limit, DEFAULT_PAGE_SIZE),
    };

    let earlyExit = false;

    while (collected.length < limit && nextEndpoint && !earlyExit) {
      const body = await this.client.call<ThreadsApiResponse<ThreadsPost[]>>({
        endpoint: nextEndpoint,
        params: nextParams,
        accessToken,
        context: ctx,
        accountId,
      });

      for (const post of body.data ?? []) {
        if (!withinTimeWindow(post.timestamp, opts)) {
          // /me/threads is sorted newest-first. If the post is older than
          // opts.since we can stop walking the cursor entirely.
          if (opts.since && post.timestamp) {
            const ts = new Date(post.timestamp);
            if (!Number.isNaN(ts.getTime()) && ts < opts.since) {
              earlyExit = true;
              break;
            }
          }
          continue;
        }
        collected.push(threadsPostToContent(post));
        if (collected.length >= limit) break;
      }

      const nextUrl = body.paging?.next;
      if (!nextUrl || collected.length >= limit) break;
      const parsed = parseThreadsNextUrl(nextUrl);
      nextEndpoint = parsed.endpoint;
      nextParams = { ...parsed.params, fields: LIST_FIELDS };
    }

    return collected;
  }

  private async enrichWithInsights(
    items: ContentData[],
    accessToken: string,
    ctx: PlatformAdapterContext,
    accountId: bigint | undefined,
  ): Promise<void> {
    if (items.length === 0) return;

    for (let i = 0; i < items.length; i += ENRICH_BATCH) {
      const batch = items.slice(i, i + ENRICH_BATCH);
      await Promise.all(
        batch.map((item) =>
          this.enrichOne(item, accessToken, ctx, accountId),
        ),
      );
    }
  }

  private async enrichOne(
    item: ContentData,
    accessToken: string,
    ctx: PlatformAdapterContext,
    accountId: bigint | undefined,
  ): Promise<void> {
    try {
      const body = await this.client.call<ThreadsApiResponse<ThreadsInsight[]>>({
        endpoint: `/${item.platformContentId}/insights`,
        params: { metric: POST_INSIGHT_METRICS },
        accessToken,
        context: ctx,
        accountId,
      });
      mergeThreadsPostInsights(item, body.data ?? []);
    } catch (err) {
      // Per-post insights are best-effort — a single 400 (e.g. account too
      // young, post too old) shouldn't poison the entire content sync.
      this.logger.debug(
        `threads insights failed for ${item.platformContentId}: ${extractMetaError(err)}`,
      );
    }
  }
}

function withinTimeWindow(
  timestamp: string | undefined,
  opts: FetchOpts,
): boolean {
  if (!timestamp) return true;
  const ts = new Date(timestamp);
  if (Number.isNaN(ts.getTime())) return true;
  if (opts.since && ts < opts.since) return false;
  if (opts.until && ts > opts.until) return false;
  return true;
}
