// Instagram insights mappers — pure functions. Phase E + Phase A refactor.
//
// Per-media metrics are declared as a single typed table (IG_MEDIA_METRICS).
// `insightMetricsForMedia()` is a filter over that table by media bucket, so
// adding a metric in Phase B is a one-row append. The order in the table
// IS the wire order — snapshot tests pin per-type sequences.
//
// Critical Meta v22 quirks captured by the appliesTo lists:
//   • `impressions` was REMOVED for all IG media (use `views` instead).
//   • `saved` is valid for IMAGE/CAROUSEL/VIDEO/REELS but NOT for STORY.
//   • `views` is valid for VIDEO/REELS, NOT IMAGE/CAROUSEL/STORY.
//   • REELS does NOT accept `follows` / `profile_visits` / `profile_activity`.
//   • `replies` is STORY-only.

import type { ContentMetrics } from '../../shared/platform-types';
import type { GraphMedia } from '../instagram.types';

/**
 * Canonical IG media bucket. Derived from `media_type` + `media_product_type`
 * by `bucketFor()`. Used as the discriminator on every metric spec entry.
 */
export type IgMediaBucket =
  | 'IMAGE'
  | 'CAROUSEL_ALBUM'
  | 'VIDEO'
  | 'REELS'
  | 'STORY';

export interface MetricSpec {
  name: string;
  appliesTo: ReadonlyArray<IgMediaBucket>;
  /** When set, this metric must be its own /insights call with `breakdown=…`. */
  breakdown?: string;
  /** When set, the call needs `metric_type=total_value`. */
  requiresMetricType?: 'total_value';
  /**
   * Phase B/C maturity flag. `core` ships unconditionally; `experimental`
   * metrics are gated behind feature flags or skipped on rejection.
   */
  feature?: 'core' | 'experimental';
}

/**
 * Single source of truth for per-media insight metrics. The order is the
 * wire order — snapshot tests in __tests__/instagram-insights.mapper.spec.ts
 * pin per-type sequences derived from this table.
 *
 * Phase A: shipping baseline.
 * Phase B: appends the metrics confirmed by docs/ig-probe-results.md against
 * Camaleonic Analytics on Graph v22.
 */
export const IG_MEDIA_METRICS: ReadonlyArray<MetricSpec> = [
  // `reach` is universally valid and serves as the fallback in
  // fetchInsightsBatch when the primary set is rejected. Keep it first.
  { name: 'reach', appliesTo: ['IMAGE', 'CAROUSEL_ALBUM', 'VIDEO', 'REELS', 'STORY'], feature: 'core' },
  { name: 'replies', appliesTo: ['STORY'], feature: 'core' },
  { name: 'saved', appliesTo: ['IMAGE', 'CAROUSEL_ALBUM', 'VIDEO', 'REELS'], feature: 'core' },
  { name: 'likes', appliesTo: ['IMAGE', 'CAROUSEL_ALBUM', 'VIDEO', 'REELS'], feature: 'core' },
  { name: 'comments', appliesTo: ['IMAGE', 'CAROUSEL_ALBUM', 'VIDEO', 'REELS'], feature: 'core' },
  { name: 'shares', appliesTo: ['IMAGE', 'CAROUSEL_ALBUM', 'VIDEO', 'REELS', 'STORY'], feature: 'core' },
  { name: 'total_interactions', appliesTo: ['IMAGE', 'CAROUSEL_ALBUM', 'VIDEO', 'REELS', 'STORY'], feature: 'core' },
  // Phase B: probe confirmed FEED CAROUSEL also accepts `views` (returned
  // 120 on a real post). Old spec restricted this to VIDEO/REELS only.
  { name: 'views', appliesTo: ['IMAGE', 'CAROUSEL_ALBUM', 'VIDEO', 'REELS'], feature: 'core' },
  { name: 'follows', appliesTo: ['IMAGE', 'CAROUSEL_ALBUM', 'VIDEO', 'STORY'], feature: 'core' },
  { name: 'profile_visits', appliesTo: ['IMAGE', 'CAROUSEL_ALBUM', 'VIDEO', 'STORY'], feature: 'core' },
  // Phase B (REELS-only). Probe confirmed all three return real numbers.
  // Land in metrics.extra (no canonical promotion) — non-numeric values
  // are dropped by mapInsightsData's typeof check.
  //   ig_reels_avg_watch_time       — average watch time per view (ms)
  //   ig_reels_video_view_total_time — total watch time across all views (ms)
  //   reels_skip_rate                — % viewers who skipped (0-100)
  { name: 'ig_reels_avg_watch_time', appliesTo: ['REELS'], feature: 'core' },
  { name: 'ig_reels_video_view_total_time', appliesTo: ['REELS'], feature: 'core' },
  { name: 'reels_skip_rate', appliesTo: ['REELS'], feature: 'core' },
];

export function bucketFor(media: GraphMedia): IgMediaBucket {
  const pt = (media.media_product_type ?? '').toUpperCase();
  const mt = (media.media_type ?? '').toUpperCase();
  if (pt === 'STORY' || mt === 'STORY') return 'STORY';
  if (pt === 'REELS') return 'REELS';
  if (mt === 'VIDEO') return 'VIDEO';
  if (mt === 'CAROUSEL_ALBUM') return 'CAROUSEL_ALBUM';
  return 'IMAGE';
}

export function insightMetricsForMedia(media: GraphMedia): string[] {
  const bucket = bucketFor(media);
  return IG_MEDIA_METRICS.filter(
    (spec) => !spec.breakdown && spec.appliesTo.includes(bucket),
  ).map((spec) => spec.name);
}

export function mapInsightsData(
  data: Array<{ name: string; values?: Array<{ value: unknown }> }>,
): Partial<ContentMetrics> {
  const out: Partial<ContentMetrics> = {};
  const extra: Record<string, number> = {};
  for (const entry of data) {
    const first = entry.values?.[0]?.value;
    if (typeof first !== 'number') continue;
    switch (entry.name) {
      case 'reach':
        out.reach = first;
        break;
      case 'saved':
        out.saves = first;
        break;
      case 'shares':
        out.shares = first;
        break;
      case 'views':
        out.views = first;
        break;
      // IG retired post-level `impressions` in v22 — rebranded as
      // "Views" (handled above). Legacy case removed.
      default:
        extra[entry.name] = first;
    }
  }
  if (Object.keys(extra).length > 0) out.extra = extra;
  return out;
}
