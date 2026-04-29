// Facebook stories fetcher. Phase C.
//
// Page Stories API — `GET /{page_id}/stories`. GA in v22. Returns
// {post_id, status, creation_time, media_type, media_id, url}. Per story
// we issue 2 extra calls in parallel batches of 5: media resolution and
// per-story insights. Permissions: `pages_read_engagement` +
// `pages_show_list` plus the OAuth user must have CREATE_CONTENT on the
// Page.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BoundGraphClient } from '../../shared/meta-graph/graph-client';
import type { PlatformAdapterContext } from '../../shared/platform-adapter.port';
import type { ContentData, ContentMetrics } from '../../shared/platform-types';
import {
  GraphInsight,
  GraphListResponse,
  extractAccountId,
  extractMetaError,
} from '../../shared/meta-graph';
import { buildFacebookContext } from '../facebook.context';
import { FACEBOOK_GRAPH_CLIENT } from '../facebook.tokens';
import type {
  FacebookPhotoMedia,
  FacebookStory,
  FacebookVideoMedia,
} from '../facebook.types';
import {
  mapStoryInsights,
  storyToContent,
} from '../mapper/facebook-story.mapper';

@Injectable()
export class FacebookStoriesFetcher {
  private readonly logger = new Logger(FacebookStoriesFetcher.name);

  constructor(
    @Inject(FACEBOOK_GRAPH_CLIENT)
    private readonly client: BoundGraphClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    const ctx = buildFacebookContext(accessToken, canonicalId, metadata);
    const accountId = extractAccountId(metadata);

    const body = await this.client.call<GraphListResponse<FacebookStory>>({
      endpoint: `/${canonicalId}/stories`,
      params: {
        fields: 'post_id,status,creation_time,media_type,media_id,url',
      },
      accessToken,
      context: ctx,
      accountId,
    });

    const stories = (body.data ?? []).filter((s) => !!s.post_id);
    const BATCH_SIZE = 5;
    const out: ContentData[] = [];

    for (let i = 0; i < stories.length; i += BATCH_SIZE) {
      const batch = stories.slice(i, i + BATCH_SIZE);
      const enriched = await Promise.all(
        batch.map(async (story) => {
          const base = storyToContent(story);
          const [resolved, insights] = await Promise.all([
            this.resolveStoryMedia(story, accessToken, ctx, accountId),
            this.fetchStoryInsights(story, accessToken, ctx, accountId),
          ]);
          const baseExtra = base.metrics.extra ?? {};
          const insightsExtra = insights.extra ?? {};
          return {
            ...base,
            mediaUrls: resolved.mediaUrls,
            thumbnailUrl: resolved.thumbnailUrl ?? base.thumbnailUrl,
            metrics: {
              ...base.metrics,
              ...insights,
              extra: { ...baseExtra, ...insightsExtra },
            },
          };
        }),
      );
      out.push(...enriched);
    }
    return out;
  }

  /**
   * Story insights — `GET /{post_id}/insights` with NO `metric` param.
   * Failures are non-fatal — the story still gets persisted with its known
   * fields, just without the metric overlay.
   */
  private async fetchStoryInsights(
    story: FacebookStory,
    accessToken: string,
    ctx: PlatformAdapterContext,
    accountId: bigint | undefined,
  ): Promise<Partial<ContentMetrics>> {
    try {
      const body = await this.client.call<{ data?: GraphInsight[] }>({
        endpoint: `/${story.post_id}/insights`,
        params: {},
        accessToken,
        context: ctx,
        accountId,
      });
      return mapStoryInsights(body.data ?? []);
    } catch (err) {
      this.logger.debug(
        `story insights failed post_id=${story.post_id}: ${extractMetaError(err)}`,
      );
      return {};
    }
  }

  /**
   * Page Stories returns a `media_id` only — fetch the media object to
   * pull out the playable URL + poster. Branches on `media_type`:
   *   - photo  → `/{media_id}?fields=images,picture` → largest images[].source
   *   - video  → `/{media_id}?fields=source,picture` → source URL + poster
   * Failures are logged at debug and degrade to empty mediaUrls so the
   * grid card still renders the type tag and permalink.
   */
  private async resolveStoryMedia(
    story: FacebookStory,
    accessToken: string,
    ctx: PlatformAdapterContext,
    accountId: bigint | undefined,
  ): Promise<{ mediaUrls: string[]; thumbnailUrl: string | null }> {
    if (!story.media_id) return { mediaUrls: [], thumbnailUrl: null };
    const isVideo = (story.media_type ?? '').toLowerCase() === 'video';

    try {
      if (isVideo) {
        const body = await this.client.call<FacebookVideoMedia>({
          endpoint: `/${story.media_id}`,
          params: { fields: 'source,picture' },
          accessToken,
          context: ctx,
          accountId,
        });
        const urls = body.source ? [body.source] : [];
        return { mediaUrls: urls, thumbnailUrl: body.picture ?? null };
      }

      const body = await this.client.call<FacebookPhotoMedia>({
        endpoint: `/${story.media_id}`,
        params: { fields: 'images,picture' },
        accessToken,
        context: ctx,
        accountId,
      });
      const sorted = (body.images ?? [])
        .slice()
        .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
      const largest = sorted[0];
      // Pick a card-friendly thumbnail (>=480px wide). Falls back to the
      // largest if no mid-size exists, then to the s130x130 `picture`.
      // The s130x130 alone looks blurry on retina cards (220px @ 2x = 440).
      const thumbCandidate =
        sorted.filter((i) => (i.width ?? 0) >= 480).slice(-1)[0] ?? largest;
      const fullUrl = largest?.source ?? body.picture ?? null;
      return {
        mediaUrls: fullUrl ? [fullUrl] : [],
        thumbnailUrl: thumbCandidate?.source ?? body.picture ?? null,
      };
    } catch (err) {
      this.logger.debug(
        `story media resolve failed media_id=${story.media_id} type=${story.media_type ?? '—'}: ${extractMetaError(err)}`,
      );
      return { mediaUrls: [], thumbnailUrl: null };
    }
  }
}
