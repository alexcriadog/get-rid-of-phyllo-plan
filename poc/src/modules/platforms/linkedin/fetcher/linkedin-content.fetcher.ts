// LinkedIn content fetcher — ORGANIZATION posts only.
//
// Member accounts return [] — the person-author Posts finder requires
// r_member_social, a closed LinkedIn permission. See linkedin.support-matrix.
//
// Org pipeline:
//   1. /rest/posts?q=author (offset paging, ≤POSTS_MAX_PAGES pages)
//   2. /rest/organizationalEntityShareStatistics in List() batches of
//      SHARE_STATS_BATCH, split by URN type (shares / ugcPosts). Best-effort.
//   3. /rest/images + /rest/videos BATCH_GET to resolve asset URNs into
//      downloadUrl/thumbnail (posts only carry urn:li:image/video ids).
//      Best-effort; downloadUrls expire but each 6h sync refreshes them.
//   4. Map to ContentData with stats + media merged by URN.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ContentData, FetchOpts } from '../../shared/platform-types';
import type {
  BoundLinkedInClient,
  LinkedInCallContext,
} from '../../shared/linkedin-api/linkedin-client';
import type {
  LinkedInPost,
  LinkedInTotalShareStatistics,
} from '../../shared/linkedin-api/linkedin-types';
import { extractAccountId } from '../../shared/meta-graph';
import {
  buildLinkedInContext,
  linkedInKind,
  organizationUrn,
} from '../linkedin.context';
import {
  POSTS_MAX_PAGES,
  POSTS_PAGE_SIZE,
  SHARE_STATS_BATCH,
} from '../linkedin.constants';
import {
  linkedInPostToContent,
  type LinkedInResolvedMedia,
} from '../mapper/linkedin-post.mapper';
import { LINKEDIN_API_CLIENT } from '../linkedin.tokens';

@Injectable()
export class LinkedInContentFetcher {
  private readonly logger = new Logger(LinkedInContentFetcher.name);

  constructor(
    @Inject(LINKEDIN_API_CLIENT)
    private readonly client: BoundLinkedInClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    if (linkedInKind(metadata) !== 'organization') {
      // Member posts are not listable (r_member_social is closed).
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

    const posts = await this.fetchPosts(callCtx, orgUrn, opts);
    const statsByUrn = await this.fetchStats(callCtx, orgUrn, posts);
    const mediaByUrn = await this.resolveMedia(callCtx, posts);

    return posts.map((p) =>
      linkedInPostToContent(p, statsByUrn.get(p.id) ?? null, undefined, mediaByUrn),
    );
  }

  /**
   * Batch-resolve image/video asset URNs referenced by the posts into
   * downloadUrl/thumbnail. Best-effort — a failed batch just means those
   * posts ship without media URLs until the next sync.
   */
  private async resolveMedia(
    callCtx: LinkedInCallContext,
    posts: LinkedInPost[],
  ): Promise<Map<string, LinkedInResolvedMedia>> {
    const imageUrns = new Set<string>();
    const videoUrns = new Set<string>();
    for (const post of posts) {
      const single = post.content?.media?.id;
      if (single?.startsWith('urn:li:image:')) imageUrns.add(single);
      else if (single?.startsWith('urn:li:video:')) videoUrns.add(single);
      for (const img of post.content?.multiImage?.images ?? []) {
        if (img.id?.startsWith('urn:li:image:')) imageUrns.add(img.id);
      }
    }

    const media = new Map<string, LinkedInResolvedMedia>();
    const batches = <T,>(arr: T[]): T[][] => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += SHARE_STATS_BATCH) {
        out.push(arr.slice(i, i + SHARE_STATS_BATCH));
      }
      return out;
    };

    for (const batch of batches([...imageUrns])) {
      try {
        const res = await this.client.getImages({ ...callCtx, imageUrns: batch });
        for (const [urn, asset] of Object.entries(res.results ?? {})) {
          media.set(urn, { url: asset.downloadUrl ?? null });
        }
      } catch (err) {
        this.logger.warn(
          `getImages batch failed: ${err instanceof Error ? err.message : String(err)} — posts ship without image URLs`,
        );
      }
    }
    for (const batch of batches([...videoUrns])) {
      try {
        const res = await this.client.getVideos({ ...callCtx, videoUrns: batch });
        for (const [urn, asset] of Object.entries(res.results ?? {})) {
          media.set(urn, {
            url: asset.downloadUrl ?? null,
            thumbnail: asset.thumbnail ?? null,
          });
        }
      } catch (err) {
        this.logger.warn(
          `getVideos batch failed: ${err instanceof Error ? err.message : String(err)} — posts ship without video URLs`,
        );
      }
    }
    return media;
  }

  private async fetchPosts(
    callCtx: LinkedInCallContext,
    orgUrn: string,
    opts: FetchOpts,
  ): Promise<LinkedInPost[]> {
    const out: LinkedInPost[] = [];
    const sinceMs = opts.since?.getTime();
    const limit = opts.limit ?? POSTS_PAGE_SIZE * POSTS_MAX_PAGES;

    for (let page = 0; page < POSTS_MAX_PAGES; page++) {
      const res = await this.client.getOrganizationPosts({
        ...callCtx,
        orgUrn,
        start: page * POSTS_PAGE_SIZE,
        count: POSTS_PAGE_SIZE,
      });
      const elements = res.elements ?? [];
      for (const post of elements) {
        const publishedMs = post.publishedAt ?? post.createdAt ?? 0;
        // Results are sortBy=CREATED descending — once a post predates
        // `since`, everything after it does too. Break instead of paging on,
        // saving calls against the 100/member/day quota.
        if (sinceMs && publishedMs && publishedMs < sinceMs) return out;
        out.push(post);
        if (out.length >= limit) return out;
      }
      if (elements.length < POSTS_PAGE_SIZE) break;
    }
    return out;
  }

  private async fetchStats(
    callCtx: LinkedInCallContext,
    orgUrn: string,
    posts: LinkedInPost[],
  ): Promise<Map<string, LinkedInTotalShareStatistics>> {
    const stats = new Map<string, LinkedInTotalShareStatistics>();
    const shareUrns = posts
      .map((p) => p.id)
      .filter((id) => id.startsWith('urn:li:share:'));
    const ugcUrns = posts
      .map((p) => p.id)
      .filter((id) => id.startsWith('urn:li:ugcPost:'));

    const collect = async (
      kind: 'shares' | 'ugcPosts',
      urns: string[],
    ): Promise<void> => {
      for (let i = 0; i < urns.length; i += SHARE_STATS_BATCH) {
        const batch = urns.slice(i, i + SHARE_STATS_BATCH);
        try {
          const res = await this.client.getShareStatistics({
            ...callCtx,
            orgUrn,
            ...(kind === 'shares'
              ? { shareUrns: batch }
              : { ugcPostUrns: batch }),
          });
          for (const el of res.elements ?? []) {
            const urn = el.share ?? el.ugcPost;
            if (urn && el.totalShareStatistics) {
              stats.set(urn, el.totalShareStatistics);
            }
          }
        } catch (err) {
          this.logger.warn(
            `shareStatistics(${kind}) batch failed for ${orgUrn}: ${
              err instanceof Error ? err.message : String(err)
            } — posts ship without metrics`,
          );
        }
      }
    };

    await collect('shares', shareUrns);
    await collect('ugcPosts', ugcUrns);
    return stats;
  }
}
