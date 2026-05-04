// Threads mentions fetcher.
//
// /me/mentions returns every thread (regardless of author) that @-mentions
// the connected user. The response is shaped like /me/threads — same
// ThreadsPost envelope plus a `from` field with the author. We reuse
// threadsPostToContent for the heavy lifting and only override ownerHandle
// to the mentioning author.
//
// Note: some older Meta docs describe the edge as `mentioned_threads`;
// the live API rejects that name with `Tried accessing nonexisting field
// (mentioned_threads)` (THApiException code 100). The canonical edge is
// `mentions`.

import { Inject, Injectable } from '@nestjs/common';
import type { BoundThreadsClient } from '../../shared/threads-api/threads-client';
import type {
  ThreadsApiResponse,
  ThreadsMention,
} from '../../shared/threads-api/threads-types';
import { parseThreadsNextUrl } from '../../shared/threads-api/threads-paging';
import { extractAccountId } from '../../shared/meta-graph';
import type { ContentData, FetchOpts } from '../../shared/platform-types';
import { buildThreadsContext } from '../threads.context';
import { THREADS_API_CLIENT } from '../threads.tokens';
import { threadsPostToContent } from '../mapper/threads-post.mapper';

const MENTION_FIELDS = [
  'id',
  'media_product_type',
  'media_type',
  'text',
  'permalink',
  'timestamp',
  'shortcode',
  'thumbnail_url',
  'media_url',
  'username',
  'from',
  'children{id,media_type,media_url,thumbnail_url,permalink}',
].join(',');

const DEFAULT_LIMIT = 25;
const PAGE_SIZE = 25;

@Injectable()
export class ThreadsMentionsFetcher {
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
    const ctx = buildThreadsContext(accessToken, canonicalId, metadata);
    const accountId = extractAccountId(metadata);
    const limit = opts.limit ?? DEFAULT_LIMIT;

    const collected: ContentData[] = [];
    let nextEndpoint = '/me/mentions';
    let nextParams: Record<string, string | number | undefined> = {
      fields: MENTION_FIELDS,
      limit: Math.min(limit, PAGE_SIZE),
    };

    while (collected.length < limit && nextEndpoint) {
      const body = await this.client.call<ThreadsApiResponse<ThreadsMention[]>>({
        endpoint: nextEndpoint,
        params: nextParams,
        accessToken,
        context: ctx,
        accountId,
      });
      for (const mention of body.data ?? []) {
        if (!withinTimeWindow(mention.timestamp, opts)) continue;
        const item = threadsPostToContent(mention);
        // The post's `username` is the connected user (because they're
        // mentioned in it). For mentions, ownerHandle should reflect the
        // author who tagged us — surfaced by `from.username`.
        if (mention.from?.username) {
          item.ownerHandle = mention.from.username;
        }
        collected.push(item);
        if (collected.length >= limit) break;
      }
      const nextUrl = body.paging?.next;
      if (!nextUrl || collected.length >= limit) break;
      const parsed = parseThreadsNextUrl(nextUrl);
      nextEndpoint = parsed.endpoint;
      nextParams = { ...parsed.params, fields: MENTION_FIELDS };
    }
    return collected;
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
