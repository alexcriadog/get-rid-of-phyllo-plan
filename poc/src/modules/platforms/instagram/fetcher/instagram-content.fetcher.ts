// Instagram content fetcher. Phase E.
//
// /media is the source of truth. Per-media insights are fetched as a
// separate call (saved/shares/views/reach/etc), with a fallback to
// `reach`-only when Meta rejects the metric set. profile_activity and
// navigation can't be batched and run as their own breakdown calls.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BoundGraphClient } from '../../shared/meta-graph/graph-client';
import type { PlatformAdapterContext } from '../../shared/platform-adapter.port';
import {
  GraphListResponse,
  extractAccountId,
  extractMetaError,
  parseNextUrl,
} from '../../shared/meta-graph';
import type {
  ContentData,
  ContentMetrics,
  FetchOpts,
} from '../../shared/platform-types';
import { DEFAULT_PAGE_SIZE } from '../instagram.constants';
import { buildInstagramContext } from '../instagram.context';
import { INSTAGRAM_GRAPH_CLIENT } from '../instagram.tokens';
import type { GraphMedia } from '../instagram.types';
import { mediaToContent } from '../mapper/instagram-media.mapper';
import {
  insightMetricsForMedia,
  mapInsightsData,
} from '../mapper/instagram-insights.mapper';

@Injectable()
export class InstagramContentFetcher {
  private readonly logger = new Logger(InstagramContentFetcher.name);

  constructor(
    @Inject(INSTAGRAM_GRAPH_CLIENT)
    private readonly client: BoundGraphClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    const limit = opts.limit ?? DEFAULT_PAGE_SIZE;
    const ctx = buildInstagramContext(accessToken, canonicalId, metadata);
    const accountId = extractAccountId(metadata);
    const collected: ContentData[] = [];

    // Rich field set for Graph v22 — every one rides on the same /media call
    // (zero extra cost). `children{…}` returns carousel subitems inline.
    // Impressions-class metrics aren't here: those require the per-media
    // /insights endpoint (1 extra call per post) and are intentionally
    // opt-in. See fetchContentInsights() for that path.
    //
    // Phase B.2 additions (probe-confirmed, see docs/ig-probe-results.md):
    //   shares_count, reposts_count, saved_count, total_like_count,
    //   total_comments_count, total_views_count, boost_ads_list,
    //   boost_eligibility_info, legacy_instagram_media_id.
    // Probe-rejected on our scope set, kept out:
    //   view_count (#36104 BD-only), copyright_check_information
    //   (video-only — re-probe later), branded_content_partner (#100
    //   retired by Meta), shopping_product_tag_eligibility (#10).
    let nextEndpoint = `/${canonicalId}/media`;
    let nextParams: Record<string, string | number | undefined> = {
      fields: [
        'id',
        'caption',
        'media_type',
        'media_url',
        'permalink',
        'timestamp',
        'thumbnail_url',
        'like_count',
        'comments_count',
        'is_shared_to_feed',
        'is_comment_enabled',
        'alt_text',
        'media_product_type',
        'shortcode',
        'owner{id,username}',
        'collaborators{id,username}',
        'children{id,media_type,media_url,thumbnail_url,permalink}',
        // Phase B.2 — free on the same /media call.
        'shares_count',
        'reposts_count',
        'saved_count',
        'total_like_count',
        'total_comments_count',
        'total_views_count',
        'boost_ads_list',
        'boost_eligibility_info',
        'legacy_instagram_media_id',
      ].join(','),
      limit: Math.min(limit, DEFAULT_PAGE_SIZE),
    };

    while (collected.length < limit && nextEndpoint) {
      const body = await this.client.call<GraphListResponse<GraphMedia>>({
        endpoint: nextEndpoint,
        params: nextParams,
        accessToken,
        context: ctx,
        accountId,
      });

      for (const media of body.data ?? []) {
        if (opts.since && media.timestamp) {
          const ts = new Date(media.timestamp);
          if (ts < opts.since) continue;
        }
        if (opts.until && media.timestamp) {
          const ts = new Date(media.timestamp);
          if (ts > opts.until) continue;
        }
        const base = mediaToContent(media);
        // +1 call per media for reach/saved/shares/views/etc.
        const enrich = await this.fetchContentInsights(
          accessToken,
          ctx,
          accountId,
          media,
        );
        collected.push({
          ...base,
          metrics: { ...base.metrics, ...enrich },
        });
        if (collected.length >= limit) break;
      }

      const nextUrl = body.paging?.next;
      if (!nextUrl || collected.length >= limit) break;

      const parsed = parseNextUrl(nextUrl);
      nextEndpoint = parsed.endpoint;
      nextParams = parsed.params;
    }

    return collected;
  }

  async fetchContentInsights(
    accessToken: string,
    context: PlatformAdapterContext,
    accountId: bigint | undefined,
    media: GraphMedia,
  ): Promise<Partial<ContentMetrics>> {
    const metrics = insightMetricsForMedia(media);
    if (metrics.length === 0) return {};

    const ctx = `media=${media.id} type=${media.media_type ?? '—'}/${media.media_product_type ?? '—'}`;
    const pt = (media.media_product_type ?? '').toUpperCase();
    const mt = (media.media_type ?? '').toUpperCase();
    const isStory = pt === 'STORY' || mt === 'STORY';
    const isReels = pt === 'REELS';
    const isFeed = !isStory && !isReels;

    const baseData = await this.fetchInsightsBatch(
      accessToken,
      context,
      accountId,
      media.id,
      metrics,
      ctx,
    );

    // profile_activity needs breakdown=action_type and is only valid for
    // FEED and STORY (not REELS). navigation needs breakdown=story_navigation_action_type
    // and is STORY-only.
    const breakdownCalls: Array<Promise<Record<string, number>>> = [];
    if (isFeed || isStory) {
      breakdownCalls.push(
        this.fetchInsightBreakdown(
          accessToken,
          context,
          accountId,
          media.id,
          'profile_activity',
          'action_type',
          ctx,
        ),
      );
    }
    if (isStory) {
      breakdownCalls.push(
        this.fetchInsightBreakdown(
          accessToken,
          context,
          accountId,
          media.id,
          'navigation',
          'story_navigation_action_type',
          ctx,
        ),
      );
    }
    const breakdownResults = await Promise.all(breakdownCalls);

    const out = mapInsightsData(baseData);
    const mergedExtra: Record<string, number> = { ...(out.extra ?? {}) };
    for (const result of breakdownResults) {
      Object.assign(mergedExtra, result);
    }
    if (Object.keys(mergedExtra).length > 0) out.extra = mergedExtra;
    return out;
  }

  private async fetchInsightsBatch(
    accessToken: string,
    context: PlatformAdapterContext,
    accountId: bigint | undefined,
    mediaId: string,
    metrics: string[],
    ctx: string,
  ): Promise<Array<{ name: string; values?: Array<{ value: unknown }> }>> {
    const fetchOnce = async (metricList: string[]) =>
      this.client.call<{
        data?: Array<{ name: string; values?: Array<{ value: unknown }> }>;
      }>({
        endpoint: `/${mediaId}/insights`,
        params: { metric: metricList.join(',') },
        accessToken,
        context,
        accountId,
      });

    try {
      const body = await fetchOnce(metrics);
      const data = body.data ?? [];
      if (data.length === 0) {
        this.logger.warn(`insights returned zero metrics (${ctx})`);
      }
      return data;
    } catch (err) {
      // `reach` is valid for every IG media type (STORY/REELS/VIDEO/IMAGE/
      // CAROUSEL_ALBUM), so this fallback never 400s on a metric mismatch.
      this.logger.warn(
        `insights primary failed (${ctx}) attempted=[${metrics.join(',')}]: ${extractMetaError(err)} — retrying with reach`,
      );
      try {
        const body = await fetchOnce(['reach']);
        return body.data ?? [];
      } catch (err2) {
        this.logger.warn(
          `insights fallback failed (${ctx}): ${extractMetaError(err2)}`,
        );
        return [];
      }
    }
  }

  /**
   * Single-metric insights call with a required breakdown. Used for
   * `profile_activity` (action_type) and `navigation`
   * (story_navigation_action_type) — neither can be batched with other
   * metrics. Returns flattened keys like
   * `profile_activity__bio_link_clicked` ready to merge into `extra`, plus
   * the metric total under its own name. Failures are swallowed and logged
   * so they never break the parent insights call.
   */
  private async fetchInsightBreakdown(
    accessToken: string,
    context: PlatformAdapterContext,
    accountId: bigint | undefined,
    mediaId: string,
    metric: string,
    breakdown: string,
    ctx: string,
  ): Promise<Record<string, number>> {
    try {
      const body = await this.client.call<{
        data?: Array<{
          name: string;
          values?: Array<{ value: unknown }>;
          total_value?: {
            value?: number;
            breakdowns?: Array<{
              dimension_keys: string[];
              results: Array<{ dimension_values: string[]; value: number }>;
            }>;
          };
        }>;
      }>({
        endpoint: `/${mediaId}/insights`,
        params: { metric, breakdown, metric_type: 'total_value' },
        accessToken,
        context,
        accountId,
      });

      const out: Record<string, number> = {};
      for (const entry of body.data ?? []) {
        const total = entry.total_value?.value;
        if (typeof total === 'number') out[metric] = total;
        const rows = entry.total_value?.breakdowns?.[0]?.results ?? [];
        for (const r of rows) {
          const label = (r.dimension_values ?? []).join('|');
          if (!label || typeof r.value !== 'number') continue;
          out[`${metric}__${label.toLowerCase()}`] = r.value;
        }
        if (out[metric] === undefined) {
          const fallback = entry.values?.[0]?.value;
          if (typeof fallback === 'number') out[metric] = fallback;
        }
      }
      return out;
    } catch (err) {
      this.logger.warn(
        `insights breakdown ${metric}/${breakdown} failed (${ctx}): ${extractMetaError(err)}`,
      );
      return {};
    }
  }
}
