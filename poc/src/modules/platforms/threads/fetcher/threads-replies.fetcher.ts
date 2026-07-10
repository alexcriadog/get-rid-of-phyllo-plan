// Threads replies fetcher — what the rest of the system calls "comments".
//
// Two-step walk:
//   1) GET /{user-id}/threads?fields=id,has_replies,timestamp — pick the most
//      recent posts that actually have replies. Calling /replies on a post
//      with `has_replies=false` is a wasted request, so we skip those.
//   2) GET /{thread_id}/replies for each, paginating up to opts.limit per
//      post.
//
// Mirrors tiktok-comments.fetcher.ts in spirit: bound the per-account scan
// (LOOKBACK videos / posts) and the per-item depth (perItem replies), since
// every call burns one rate-bucket token.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BoundThreadsClient } from '../../shared/threads-api/threads-client';
import type {
  ThreadsApiResponse,
  ThreadsPost,
  ThreadsReply,
} from '../../shared/threads-api/threads-types';
import { parseThreadsNextUrl } from '../../shared/threads-api/threads-paging';
import { rethrowCritical } from '../../shared/fetch-guards';
import {
  extractAccountId,
  extractMetaError,
} from '../../shared/meta-graph';
import type { PlatformAdapterContext } from '../../shared/platform-adapter.port';
import type { CommentData, FetchOpts } from '../../shared/platform-types';
import { buildThreadsContext } from '../threads.context';
import { THREADS_API_CLIENT } from '../threads.tokens';
import { threadsReplyToComment } from '../mapper/threads-comment.mapper';

const REPLY_FIELDS = [
  'id',
  'text',
  'timestamp',
  'username',
  'is_reply_owned_by_me',
  'likes',
  'replies',
  'replied_to',
  'root_post',
  'hide_status',
  // Max-capture pass 2026-07-10: replies are full media objects too — capture
  // any image/GIF/link they carry (raw archive keeps it all verbatim).
  'media_type',
  'media_url',
  'thumbnail_url',
  'alt_text',
  'gif_url',
  'link_attachment_url',
].join(',');

const POST_SCAN_FIELDS = ['id', 'has_replies', 'timestamp'].join(',');
const POST_LOOKBACK = 50;
const DEFAULT_REPLIES_PER_POST = 25;
const REPLIES_BATCH = 5;

@Injectable()
export class ThreadsRepliesFetcher {
  private readonly logger = new Logger(ThreadsRepliesFetcher.name);

  constructor(
    @Inject(THREADS_API_CLIENT)
    private readonly client: BoundThreadsClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<CommentData[]> {
    const ctx = buildThreadsContext(accessToken, canonicalId, metadata);
    const accountId = extractAccountId(metadata);
    const perPost = opts.limit ?? DEFAULT_REPLIES_PER_POST;

    const posts = await this.scanPostsWithReplies(
      accessToken,
      canonicalId,
      POST_LOOKBACK,
      ctx,
      accountId,
    );

    const all: CommentData[] = [];
    for (let i = 0; i < posts.length; i += REPLIES_BATCH) {
      const batch = posts.slice(i, i + REPLIES_BATCH);
      const results = await Promise.all(
        batch.map((p) =>
          this.fetchRepliesFor(p.id, perPost, accessToken, ctx, accountId),
        ),
      );
      for (const r of results) all.push(...r);
    }
    return all;
  }

  private async scanPostsWithReplies(
    accessToken: string,
    canonicalId: string,
    lookback: number,
    ctx: PlatformAdapterContext,
    accountId: bigint | undefined,
  ): Promise<Array<{ id: string }>> {
    const out: Array<{ id: string }> = [];
    let nextEndpoint = `/${canonicalId}/threads`;
    let nextParams: Record<string, string | number | undefined> = {
      fields: POST_SCAN_FIELDS,
      limit: Math.min(lookback, 25),
    };

    while (out.length < lookback && nextEndpoint) {
      const body = await this.client.call<ThreadsApiResponse<ThreadsPost[]>>({
        endpoint: nextEndpoint,
        params: nextParams,
        accessToken,
        context: ctx,
        accountId,
      });
      for (const post of body.data ?? []) {
        if (post.has_replies) out.push({ id: post.id });
        if (out.length >= lookback) break;
      }
      const nextUrl = body.paging?.next;
      if (!nextUrl || out.length >= lookback) break;
      const parsed = parseThreadsNextUrl(nextUrl);
      nextEndpoint = parsed.endpoint;
      nextParams = { ...parsed.params, fields: POST_SCAN_FIELDS };
    }
    return out;
  }

  private async fetchRepliesFor(
    postId: string,
    perPost: number,
    accessToken: string,
    ctx: PlatformAdapterContext,
    accountId: bigint | undefined,
  ): Promise<CommentData[]> {
    const collected: CommentData[] = [];
    let nextEndpoint: string | null = `/${postId}/replies`;
    let nextParams: Record<string, string | number | undefined> = {
      fields: REPLY_FIELDS,
      limit: Math.min(perPost, 25),
      reverse: 'true',
    };
    try {
      while (nextEndpoint && collected.length < perPost) {
        const body = await this.client.call<ThreadsApiResponse<ThreadsReply[]>>({
          endpoint: nextEndpoint,
          params: nextParams,
          accessToken,
          context: ctx,
          accountId,
        });
        for (const reply of body.data ?? []) {
          collected.push(threadsReplyToComment(reply, postId));
          if (collected.length >= perPost) break;
        }
        const nextUrl = body.paging?.next;
        if (!nextUrl || collected.length >= perPost) break;
        const parsed = parseThreadsNextUrl(nextUrl);
        nextEndpoint = parsed.endpoint;
        nextParams = { ...parsed.params, fields: REPLY_FIELDS };
      }
    } catch (err) {
      rethrowCritical(err);
      // Per-post failure is best-effort — keep the rest of the comment sync
      // moving rather than abort.
      this.logger.debug(
        `threads /replies failed for ${postId}: ${extractMetaError(err)}`,
      );
    }
    return collected;
  }
}
