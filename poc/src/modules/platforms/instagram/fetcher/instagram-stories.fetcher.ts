// Instagram stories fetcher. Phase E.

import { Inject, Injectable } from '@nestjs/common';
import type { BoundGraphClient } from '../../shared/meta-graph/graph-client';
import {
  GraphListResponse,
  extractAccountId,
} from '../../shared/meta-graph';
import type { ContentData } from '../../shared/platform-types';
import { buildInstagramContext } from '../instagram.context';
import { INSTAGRAM_GRAPH_CLIENT } from '../instagram.tokens';
import type { GraphMedia } from '../instagram.types';
import { mediaToContent } from '../mapper/instagram-media.mapper';
import { InstagramContentFetcher } from './instagram-content.fetcher';

@Injectable()
export class InstagramStoriesFetcher {
  constructor(
    @Inject(INSTAGRAM_GRAPH_CLIENT)
    private readonly client: BoundGraphClient,
    private readonly contentFetcher: InstagramContentFetcher,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    const ctx = buildInstagramContext(accessToken, canonicalId, metadata);
    const accountId = extractAccountId(metadata);
    const body = await this.client.call<GraphListResponse<GraphMedia>>({
      endpoint: `/${canonicalId}/stories`,
      params: {
        // `thumbnail_url` is needed so VIDEO stories render a poster in the
        // grid; IG only populates it for video-type media.
        fields: 'id,media_type,media_url,thumbnail_url,permalink,timestamp',
      },
      accessToken,
      context: ctx,
      accountId,
    });

    const out: ContentData[] = [];
    for (const media of body.data ?? []) {
      const base = { ...mediaToContent(media), contentType: 'story' as const };
      // +1 call per story for reach / replies / navigation. We reuse the
      // content fetcher's insight-batch logic for the breakdown handling.
      const enrich = await this.contentFetcher.fetchContentInsights(
        accessToken,
        ctx,
        accountId,
        { ...media, media_product_type: 'STORY' },
      );
      out.push({ ...base, metrics: { ...base.metrics, ...enrich } });
    }
    return out;
  }
}
