// Instagram insights mappers — pure functions. Phase E.
//
// Critical: per-media-type metric sets are STRICT. Meta rejects the whole
// batch if any metric isn't valid for the type, and breakdown-restricted
// metrics (`profile_activity`, `navigation`) can't be combined with
// anything else — those are fetched separately in the content fetcher.

import type { ContentMetrics } from '../../shared/platform-types';
import type { GraphMedia } from '../instagram.types';

export function insightMetricsForMedia(media: GraphMedia): string[] {
  // Graph v22 quirks:
  //   • `impressions` was REMOVED in v22 for all IG media (use `reach` /
  //     `views` instead).
  //   • `saved` is valid for IMAGE/CAROUSEL/VIDEO/REELS but NOT for STORY.
  //   • `views` is valid for VIDEO/REELS/STORY, NOT IMAGE/CAROUSEL.
  //   • REELS does NOT accept `follows` / `profile_visits` / `profile_activity`
  //     — those exist only on FEED and STORY.
  const pt = (media.media_product_type ?? '').toUpperCase();
  const mt = (media.media_type ?? '').toUpperCase();

  if (pt === 'STORY' || mt === 'STORY') {
    return [
      'reach',
      'replies',
      'shares',
      'total_interactions',
      'follows',
      'profile_visits',
    ];
  }
  if (pt === 'REELS') {
    return [
      'reach',
      'saved',
      'likes',
      'comments',
      'shares',
      'total_interactions',
      'views',
    ];
  }
  if (mt === 'VIDEO') {
    return [
      'reach',
      'saved',
      'likes',
      'comments',
      'shares',
      'total_interactions',
      'views',
      'follows',
      'profile_visits',
    ];
  }
  // IMAGE / CAROUSEL_ALBUM / FEED
  return [
    'reach',
    'saved',
    'likes',
    'comments',
    'shares',
    'total_interactions',
    'follows',
    'profile_visits',
  ];
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
      case 'impressions':
        out.impressions = first;
        break;
      default:
        extra[entry.name] = first;
    }
  }
  if (Object.keys(extra).length > 0) out.extra = extra;
  return out;
}
