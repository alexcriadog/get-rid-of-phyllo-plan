// Facebook comments fetcher — per-post comments via /{post_id}/comments.
//
// Strategy mirrors the YouTube comments fetcher: fetch the most recent N
// posts for the Page, then walk comments per post (capped pages so the
// quota stays predictable). Requires pages_read_engagement (already had it)
// + pages_read_user_content (NEW — unlocks `from{id,name}` for user
// authors; previously only the Page admin's own replies carried identity).

import { Inject, Injectable, Logger } from '@nestjs/common';
import { AdapterFetchError } from '../../shared/platform-adapter.port';
import type { BoundGraphClient } from '../../shared/meta-graph/graph-client';
import type { CommentData, FetchOpts } from '../../shared/platform-types';
import {
  GraphListResponse,
  extractAccountId,
  extractMetaError,
  parseNextUrl,
} from '../../shared/meta-graph';
import { buildFacebookContext } from '../facebook.context';
import { FACEBOOK_GRAPH_CLIENT } from '../facebook.tokens';
import type { FacebookCommentRow, FacebookPost } from '../facebook.types';
import { commentRowToComment } from '../mapper/facebook-comment.mapper';

const DEFAULT_TOP_POSTS = 10;
const MAX_COMMENT_PAGES_PER_POST = 2;
const COMMENTS_PER_PAGE = 50;

@Injectable()
export class FacebookCommentsFetcher {
  private readonly logger = new Logger(FacebookCommentsFetcher.name);

  constructor(
    @Inject(FACEBOOK_GRAPH_CLIENT)
    private readonly client: BoundGraphClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<CommentData[]> {
    const ctx = buildFacebookContext(accessToken, canonicalId, metadata);
    const accountId = extractAccountId(metadata);
    const topN = Math.min(opts.limit ?? DEFAULT_TOP_POSTS, 25);

    const postsBody = await this.client.call<GraphListResponse<FacebookPost>>({
      endpoint: `/${canonicalId}/posts`,
      params: { fields: 'id,created_time', limit: topN },
      accessToken,
      context: ctx,
      accountId,
    });

    const postIds = (postsBody.data ?? [])
      .map((p) => p.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    const all: CommentData[] = [];
    for (const postId of postIds) {
      const perPost = await this.collectForPost(
        postId,
        canonicalId,
        accessToken,
        ctx,
        accountId,
      );
      all.push(...perPost);
    }
    return all;
  }

  private async collectForPost(
    postId: string,
    selfPageId: string,
    accessToken: string,
    ctx: ReturnType<typeof buildFacebookContext>,
    accountId: bigint | undefined,
  ): Promise<CommentData[]> {
    const out: CommentData[] = [];
    let nextEndpoint: string = `/${postId}/comments`;
    let nextParams: Record<string, string | number | undefined> = {
      fields:
        'id,message,created_time,from{id,name},parent{id},like_count,comment_count,permalink_url',
      limit: COMMENTS_PER_PAGE,
      filter: 'stream',
      order: 'reverse_chronological',
    };

    for (let page = 0; page < MAX_COMMENT_PAGES_PER_POST; page++) {
      let body;
      try {
        body = await this.client.call<GraphListResponse<FacebookCommentRow>>({
          endpoint: nextEndpoint,
          params: nextParams,
          accessToken,
          context: ctx,
          accountId,
        });
      } catch (err) {
        if (err instanceof AdapterFetchError) {
          this.logger.debug(
            `comments fetch failed for post=${postId}: ${extractMetaError(err)}`,
          );
          return out;
        }
        throw err;
      }

      for (const row of body.data ?? []) {
        out.push(commentRowToComment(row, postId, selfPageId));
      }

      const nextUrl = body.paging?.next;
      if (!nextUrl) break;
      const parsed = parseNextUrl(nextUrl);
      nextEndpoint = parsed.endpoint;
      nextParams = { ...parsed.params };
    }
    return out;
  }
}
