// Facebook video mappers — pure functions. Phase D.
//
// `mergeVideoInsights` is alive, called by FacebookContentFetcher when a
// post turns out to be a pure video (numeric id, not the composite
// {page_id}_{post_id} form).
//
// `videoToContent` and `extractVideoMetrics` were called only by the
// dead `fetchVideos` path which is gone. They survive here because the
// Phase 0 pinning test still exercises them; final deletion happens with
// the test cleanup in a follow-up.

import { createHash } from 'node:crypto';
import { MONGO_COLLECTIONS } from '@shared/database/mongo.service';
import type { ContentData, ContentMetrics } from '../../shared/platform-types';
import type { GraphInsight } from '../../shared/meta-graph';
import type { FacebookVideo } from '../facebook.types';

export function videoToContent(video: FacebookVideo): ContentData {
  const metrics = extractVideoMetrics(video);
  const mediaUrls = video.source ? [video.source] : [];
  const serialized = JSON.stringify(video);
  const hash = createHash('sha256').update(serialized).digest('hex');

  return {
    platformContentId: video.id,
    contentType: 'video',
    caption: video.description ?? null,
    permalink: video.permalink_url ?? null,
    mediaUrls,
    thumbnailUrl: null,
    metrics,
    publishedAt: video.created_time ? new Date(video.created_time) : null,
    fetchedAt: new Date(),
    rawResponse: {
      collection: MONGO_COLLECTIONS.rawPlatformResponses,
      contentHash: hash,
    },
  };
}

export function extractVideoMetrics(video: FacebookVideo): ContentMetrics {
  const out: ContentMetrics = {};
  for (const insight of video.video_insights?.data ?? []) {
    const first = insight.values?.[0]?.value;
    if (typeof first !== 'number') continue;
    if (insight.name === 'total_video_views') {
      out.views = first;
    } else {
      const extra = out.extra ?? {};
      extra[insight.name] = first;
      out.extra = extra;
    }
  }
  return out;
}

export function mergeVideoInsights(item: ContentData, data: GraphInsight[]): void {
  const extra = item.metrics.extra ?? {};
  for (const insight of data) {
    const values = insight.values ?? [];
    const first = values[values.length - 1]?.value ?? values[0]?.value;
    if (insight.name === 'total_video_views' && typeof first === 'number') {
      item.metrics.views = first;
    } else if (
      insight.name === 'total_video_views_unique' &&
      typeof first === 'number'
    ) {
      item.metrics.reach = first;
    } else if (
      insight.name === 'total_video_impressions' &&
      typeof first === 'number'
    ) {
      // Meta retired post_impressions and rebranded as "Views".
      // total_video_views already maps to `views` above; only fall
      // back to total_video_impressions when total_video_views was
      // absent for this video.
      if (item.metrics.views === undefined) {
        item.metrics.views = first;
      }
    } else if (
      insight.name === 'total_video_reactions_by_type_total' &&
      first !== null &&
      typeof first === 'object'
    ) {
      const reactions = first as Record<string, number>;
      const total = Object.values(reactions).reduce(
        (sum, v) => (typeof v === 'number' ? sum + v : sum),
        0,
      );
      item.metrics.likes = total;
      for (const [k, v] of Object.entries(reactions)) {
        if (typeof v === 'number') extra[`reaction_${k}`] = v;
      }
    } else if (typeof first === 'number') {
      extra[insight.name] = first;
    }
  }
  item.metrics.extra = extra;
}
