// Threads post mappers — pure functions, no DI, no I/O.
// Mirrors facebook-post.mapper.ts. Behaviour:
//   threadsPostToContent  — ThreadsPost → ContentData (canonical shape).
//   mergeThreadsPostInsights — merges /{id}/insights metric values into
//     ContentData.metrics in-place.
//
// Threads metric → canonical metric mapping:
//   views    → metrics.views
//   likes    → metrics.likes
//   replies  → metrics.comments      (Threads' comment product is "replies")
//   reposts  → metrics.shares        (closest analogue)
//   quotes   → metrics.extra.quotes  (no canonical slot)

import { createHash } from 'node:crypto';
import { MONGO_COLLECTIONS } from '@shared/database/mongo.service';
import type {
  ContentChild,
  ContentData,
  ContentMetrics,
  ContentType,
} from '../../shared/platform-types';
import type {
  ThreadsInsight,
  ThreadsMediaType,
  ThreadsPost,
} from '../../shared/threads-api/threads-types';

export function threadsPostToContent(post: ThreadsPost): ContentData {
  const contentType = detectThreadsContentType(post.media_type);
  const mediaUrls = collectMediaUrls(post);
  const children = mapChildren(post);
  const serialized = JSON.stringify(post);
  const hash = createHash('sha256').update(serialized).digest('hex');

  // Inline metric fields that some Threads endpoints expand alongside the
  // post envelope (older shape; insights endpoint is preferred). Captured
  // here so we don't lose data when the per-post enrichment fails.
  const metrics: ContentMetrics = {};
  if (typeof post.views === 'number') metrics.views = post.views;
  if (typeof post.likes === 'number') metrics.likes = post.likes;
  if (typeof post.replies === 'number') metrics.comments = post.replies;
  if (typeof post.reposts === 'number') metrics.shares = post.reposts;
  if (typeof post.quotes === 'number') {
    metrics.extra = { ...(metrics.extra ?? {}), quotes: post.quotes };
  }

  return {
    platformContentId: post.id,
    contentType,
    caption: post.text ?? null,
    permalink: post.permalink ?? null,
    mediaUrls,
    thumbnailUrl: post.thumbnail_url ?? post.media_url ?? null,
    metrics,
    publishedAt: post.timestamp ? safeDate(post.timestamp) : null,
    fetchedAt: new Date(),
    children: children.length > 0 ? children : undefined,
    shortcode: post.shortcode ?? null,
    ownerHandle: post.username ?? null,
    rawResponse: {
      collection: MONGO_COLLECTIONS.rawPlatformResponses,
      contentHash: hash,
    },
  };
}

export function mergeThreadsPostInsights(
  item: ContentData,
  insights: ThreadsInsight[],
): void {
  for (const insight of insights) {
    const v = readInsightScalar(insight);
    if (typeof v !== 'number') continue;
    switch (insight.name) {
      case 'views':
        item.metrics.views = v;
        break;
      case 'likes':
        item.metrics.likes = v;
        break;
      case 'replies':
        item.metrics.comments = v;
        break;
      case 'reposts':
        item.metrics.shares = v;
        break;
      case 'quotes':
        item.metrics.extra = { ...(item.metrics.extra ?? {}), quotes: v };
        break;
      default:
        item.metrics.extra = { ...(item.metrics.extra ?? {}), [insight.name]: v };
    }
  }
}

/**
 * Threads' per-post insights endpoint returns lifetime metrics in the
 * `values` array (single entry, no `total_value`); some account-level
 * endpoints populate `total_value.value` instead. Read both shapes so the
 * same mapper handles both.
 */
function readInsightScalar(insight: ThreadsInsight): number | undefined {
  if (typeof insight.total_value?.value === 'number') {
    return insight.total_value.value;
  }
  const series = insight.values;
  if (Array.isArray(series) && series.length > 0) {
    const last = series[series.length - 1]?.value;
    if (typeof last === 'number') return last;
  }
  return undefined;
}

function detectThreadsContentType(media?: ThreadsMediaType): ContentType {
  switch (media) {
    case 'IMAGE':
      return 'image';
    case 'VIDEO':
      return 'video';
    case 'CAROUSEL_ALBUM':
      return 'carousel';
    case 'TEXT_POST':
    case 'REPOST_FACADE':
    case 'AUDIO':
    default:
      return 'other';
  }
}

function collectMediaUrls(post: ThreadsPost): string[] {
  const urls: string[] = [];
  if (post.media_url) urls.push(post.media_url);
  for (const child of post.children?.data ?? []) {
    if (child.media_url) urls.push(child.media_url);
  }
  return urls;
}

function mapChildren(post: ThreadsPost): ContentChild[] {
  return (post.children?.data ?? []).map((child) => ({
    id: child.id,
    mediaType: detectThreadsContentType(child.media_type),
    mediaUrl: child.media_url ?? null,
    thumbnailUrl: child.thumbnail_url ?? null,
    permalink: child.permalink ?? null,
  }));
}

function safeDate(s: string): Date | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
