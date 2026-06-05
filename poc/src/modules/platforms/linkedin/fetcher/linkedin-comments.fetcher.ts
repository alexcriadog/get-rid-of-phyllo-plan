// LinkedIn comments fetcher — ORGANIZATION posts only (r_organization_social_feed).
//
// Pipeline (≤ 2 + COMMENTS_MAX_POSTS calls):
//   1. First page of org posts (newest first).
//   2. socialMetadata BATCH_GET on the top COMMENTS_MAX_POSTS — skip posts
//      with zero comments (socialActions 404s on empty threads).
//   3. /rest/socialActions/{urn}/comments per commented post.
//
// Member accounts return [] — member post enumeration is closed by LinkedIn.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CommentData, FetchOpts } from '../../shared/platform-types';
import type {
  BoundLinkedInClient,
  LinkedInCallContext,
} from '../../shared/linkedin-api/linkedin-client';
import { extractAccountId } from '../../shared/meta-graph';
import {
  buildLinkedInContext,
  linkedInKind,
  organizationUrn,
} from '../linkedin.context';
import {
  COMMENTS_MAX_POSTS,
  COMMENTS_PER_POST,
  POSTS_PAGE_SIZE,
} from '../linkedin.constants';
import { linkedInCommentToComment } from '../mapper/linkedin-comment.mapper';
import { LINKEDIN_API_CLIENT } from '../linkedin.tokens';

@Injectable()
export class LinkedInCommentsFetcher {
  private readonly logger = new Logger(LinkedInCommentsFetcher.name);

  constructor(
    @Inject(LINKEDIN_API_CLIENT)
    private readonly client: BoundLinkedInClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<CommentData[]> {
    if (linkedInKind(metadata) !== 'organization') {
      return [];
    }
    const accountId = extractAccountId(metadata);
    const ctx = buildLinkedInContext(accessToken, canonicalId);
    const callCtx: LinkedInCallContext = {
      accessToken,
      context: ctx,
      accountId,
    };
    const orgUrn = organizationUrn(canonicalId, metadata);

    const posts = await this.client
      .getOrganizationPosts({
        ...callCtx,
        orgUrn,
        start: 0,
        count: POSTS_PAGE_SIZE,
      })
      .then((r) => (r.elements ?? []).slice(0, COMMENTS_MAX_POSTS))
      .catch((err) => {
        this.logger.warn(
          `posts page failed for ${orgUrn}: ${msg(err)} — no comments this sync`,
        );
        return [];
      });
    if (posts.length === 0) return [];

    // Skip zero-comment posts (socialActions 404s on empty threads).
    const commented = new Set<string>();
    try {
      const meta = await this.client.getSocialMetadata({
        ...callCtx,
        postUrns: posts.map((p) => p.id),
      });
      for (const [urn, m] of Object.entries(meta.results ?? {})) {
        const count = m.commentSummary?.count ?? m.commentSummary?.topLevelCount;
        if (typeof count === 'number' && count > 0) commented.add(urn);
      }
    } catch (err) {
      this.logger.warn(
        `socialMetadata failed for ${orgUrn}: ${msg(err)} — threading all posts`,
      );
      posts.forEach((p) => commented.add(p.id));
    }

    const out: CommentData[] = [];
    const perPost = Math.min(opts.limit ?? COMMENTS_PER_POST, COMMENTS_PER_POST);
    for (const post of posts) {
      if (!commented.has(post.id)) continue;
      try {
        const res = await this.client.getComments({
          ...callCtx,
          postUrn: post.id,
          count: perPost,
        });
        for (const c of res.elements ?? []) {
          out.push(linkedInCommentToComment(c, post.id));
        }
      } catch (err) {
        this.logger.warn(
          `comments failed for ${post.id}: ${msg(err)} — skipping thread`,
        );
      }
    }
    return out;
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
