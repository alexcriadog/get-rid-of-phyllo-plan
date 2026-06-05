// LinkedIn mentions fetcher — posts by OTHERS that @-mention the org.
//
// organizationalEntityNotifications (SHARE_MENTION, 60-day retention) yields
// the mentioning post URNs; each is hydrated via GET /rest/posts/{urn} and
// mapped to ContentData (a mention IS a content item from another author).
// Requires rw_organization_admin + ADMINISTRATOR role. Member accounts
// return [].

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ContentData, FetchOpts } from '../../shared/platform-types';
import type {
  BoundLinkedInClient,
  LinkedInCallContext,
} from '../../shared/linkedin-api/linkedin-client';
import { extractAccountId } from '../../shared/meta-graph';
import { rethrowCritical } from '../../shared/fetch-guards';
import {
  buildLinkedInContext,
  linkedInKind,
  organizationUrn,
} from '../linkedin.context';
import { MENTIONS_MAX } from '../linkedin.constants';
import { linkedInPostToContent } from '../mapper/linkedin-post.mapper';
import { LINKEDIN_API_CLIENT } from '../linkedin.tokens';

@Injectable()
export class LinkedInMentionsFetcher {
  private readonly logger = new Logger(LinkedInMentionsFetcher.name);

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
    const limit = Math.min(opts.limit ?? MENTIONS_MAX, MENTIONS_MAX);

    const postUrns = await this.client
      .getOrganizationNotifications({
        ...callCtx,
        orgUrn,
        actions: ['SHARE_MENTION'],
        count: limit,
      })
      .then((r) => {
        const urns = new Set<string>();
        for (const n of r.elements ?? []) {
          // Field semantics verified against live traffic 2026-06-05:
          // generatedActivity carries the ugcPost/share URN of the mentioning
          // post; sourcePost is an urn:li:activity wrapper. Prefer whichever
          // is a fetchable post URN.
          const urn = [n.generatedActivity, n.sourcePost].find(
            (u) =>
              u &&
              (u.startsWith('urn:li:share:') ||
                u.startsWith('urn:li:ugcPost:')),
          );
          if (urn) urns.add(urn);
        }
        return [...urns].slice(0, limit);
      })
      .catch((err) => {
        rethrowCritical(err);
        this.logger.warn(
          `notifications failed for ${orgUrn}: ${msg(err)} — no mentions this sync`,
        );
        return [];
      });

    const out: ContentData[] = [];
    for (const urn of postUrns) {
      try {
        const post = await this.client.getPost({ ...callCtx, postUrn: urn });
        const content = linkedInPostToContent(post, null);
        out.push({ ...content, ownerHandle: post.author ?? null });
      } catch (err) {
        rethrowCritical(err);
        this.logger.warn(`mention post ${urn} failed: ${msg(err)} — skipping`);
      }
    }
    return out;
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
