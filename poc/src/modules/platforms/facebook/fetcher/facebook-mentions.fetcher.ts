// Facebook mentions fetcher — backed by /{page_id}/tagged.
//
// Requires `pages_read_user_content`. Returns posts authored by OTHER pages
// that tagged this Page in their content. The sync worker stores them in
// the `posts` collection alongside Page-owned posts; the public mentions UI
// filters by `data.ownerHandle !== self.username` to surface them.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BoundGraphClient } from '../../shared/meta-graph/graph-client';
import type {
  ContentData,
  FetchOpts,
} from '../../shared/platform-types';
import {
  GraphListResponse,
  extractAccountId,
  parseNextUrl,
} from '../../shared/meta-graph';
import { DEFAULT_PAGE_SIZE } from '../facebook.constants';
import { buildFacebookContext } from '../facebook.context';
import { FACEBOOK_GRAPH_CLIENT } from '../facebook.tokens';
import type { FacebookTaggedPost } from '../facebook.types';
import { taggedPostToContent } from '../mapper/facebook-tagged.mapper';

@Injectable()
export class FacebookMentionsFetcher {
  private readonly logger = new Logger(FacebookMentionsFetcher.name);

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

    const fields =
      'id,message,created_time,permalink_url,full_picture,attachments,' +
      'from{id,name},comments.summary(total_count),reactions.summary(total_count)';

    const collected: ContentData[] = [];
    let nextEndpoint = `/${canonicalId}/tagged`;
    let nextParams: Record<string, string | number | undefined> = {
      fields,
      limit: Math.min(limit, DEFAULT_PAGE_SIZE),
    };

    while (collected.length < limit && nextEndpoint) {
      const body = await this.client.call<GraphListResponse<FacebookTaggedPost>>({
        endpoint: nextEndpoint,
        params: nextParams,
        accessToken,
        context: ctx,
        accountId,
      });

      for (const post of body.data ?? []) {
        if (!withinTimeWindow(post.created_time, opts)) continue;
        const content = taggedPostToContent(post, canonicalId);
        if (content) collected.push(content);
        if (collected.length >= limit) break;
      }

      const nextUrl = body.paging?.next;
      if (!nextUrl || collected.length >= limit) break;
      const parsed = parseNextUrl(nextUrl);
      nextEndpoint = parsed.endpoint;
      nextParams = { ...parsed.params, fields };
    }

    this.logger.debug(`fetched ${collected.length} mentions for page=${canonicalId}`);
    return collected;
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
