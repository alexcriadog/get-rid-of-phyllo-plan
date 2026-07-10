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
//   reposts  → metrics.shares        (closest analogue, kept for dashboard
//              compat) + metrics.extra.reposts (feeds /v1 repost_count)
//   quotes   → metrics.extra.quotes  (no canonical slot)
//   shares   → metrics.extra.shares  (native send/share count — distinct from
//              reposts; no canonical slot free, share_count is taken)
//   clicks   → metrics.extra.clicks  (link clicks — feeds /v1 click_count)

import { createHash } from 'node:crypto';
import { MONGO_COLLECTIONS } from '@shared/database/mongo.service';
import type {
  ContentChild,
  ContentData,
  ContentLocation,
  ContentMetrics,
  ContentPoll,
  ContentType,
  ReferencedContent,
} from '../../shared/platform-types';
import type {
  ThreadsInsight,
  ThreadsMediaType,
  ThreadsPollAttachment,
  ThreadsPost,
} from '../../shared/threads-api/threads-types';

export function threadsPostToContent(post: ThreadsPost): ContentData {
  const contentType = detectThreadsContentType(post.media_type);
  const mediaUrls = collectMediaUrls(post);
  const children = mapChildren(post);
  // A quote / repost often has no text or media of its own — surface the
  // referenced post so the UI can render it embedded instead of blank.
  const quotedPost = post.quoted_post
    ? toReferencedContent(post.quoted_post)
    : undefined;
  const repostedPost = post.reposted_post
    ? toReferencedContent(post.reposted_post)
    : undefined;
  const serialized = JSON.stringify(post);
  const hash = createHash('sha256').update(serialized).digest('hex');

  // Inline metric fields that some Threads endpoints expand alongside the
  // post envelope (older shape; insights endpoint is preferred). Captured
  // here so we don't lose data when the per-post enrichment fails.
  const metrics: ContentMetrics = {};
  if (typeof post.views === 'number') metrics.views = post.views;
  if (typeof post.likes === 'number') metrics.likes = post.likes;
  if (typeof post.replies === 'number') metrics.comments = post.replies;
  if (typeof post.reposts === 'number') {
    metrics.shares = post.reposts;
    metrics.extra = { ...(metrics.extra ?? {}), reposts: post.reposts };
  }
  if (typeof post.quotes === 'number') {
    metrics.extra = { ...(metrics.extra ?? {}), quotes: post.quotes };
  }
  if (typeof post.shares === 'number') {
    metrics.extra = { ...(metrics.extra ?? {}), shares: post.shares };
  }
  if (typeof post.clicks === 'number') {
    metrics.extra = { ...(metrics.extra ?? {}), clicks: post.clicks };
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
    quotedPost,
    repostedPost,
    topicTag: post.topic_tag ?? undefined,
    location: mapLocation(post),
    linkAttachmentUrl: post.link_attachment_url ?? undefined,
    gifUrl: post.gif_url ?? undefined,
    altText: post.alt_text ?? undefined,
    isSpoilerMedia: post.is_spoiler_media ?? undefined,
    poll: mapPoll(post.poll_attachment),
    rawResponse: {
      collection: MONGO_COLLECTIONS.rawPlatformResponses,
      contentHash: hash,
    },
  };
}

/**
 * `location{...}` is an edge — `{ data: [loc] }` with at most one entry
 * (verified live 2026-07-10). Flatten it to a single ContentLocation.
 */
function mapLocation(post: ThreadsPost): ContentLocation | undefined {
  const loc = post.location?.data?.[0];
  if (!loc?.id) return undefined;
  return {
    id: loc.id,
    name: loc.name ?? null,
    city: loc.city ?? null,
    country: loc.country ?? null,
    latitude: typeof loc.latitude === 'number' ? loc.latitude : null,
    longitude: typeof loc.longitude === 'number' ? loc.longitude : null,
    address: loc.address ?? null,
    postalCode: loc.postal_code ?? null,
  };
}

/** Compact the wire's flat option_a..option_d pairs into an options array. */
function mapPoll(poll?: ThreadsPollAttachment): ContentPoll | undefined {
  if (!poll) return undefined;
  const options: ContentPoll['options'] = [];
  const pairs: Array<[string | undefined, number | undefined]> = [
    [poll.option_a, poll.option_a_votes_percentage],
    [poll.option_b, poll.option_b_votes_percentage],
    [poll.option_c, poll.option_c_votes_percentage],
    [poll.option_d, poll.option_d_votes_percentage],
  ];
  for (const [label, pct] of pairs) {
    if (typeof label === 'string' && label.length > 0) {
      options.push({ label, votesPercentage: typeof pct === 'number' ? pct : null });
    }
  }
  if (options.length === 0) return undefined;
  return {
    options,
    expiresAt: poll.expiration_timestamp ?? null,
    totalVotes: typeof poll.total_votes === 'number' ? poll.total_votes : null,
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
        // Dual-write: metrics.shares keeps the historical dashboard mapping,
        // extra.reposts feeds the /v1 engagement.repost_count slot.
        item.metrics.shares = v;
        item.metrics.extra = { ...(item.metrics.extra ?? {}), reposts: v };
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

/** Flatten a quoted / reposted Threads post into the embeddable reference. */
function toReferencedContent(p: ThreadsPost): ReferencedContent {
  return {
    platformContentId: p.id,
    ownerHandle: p.username ?? null,
    caption: p.text ?? null,
    permalink: p.permalink ?? null,
    contentType: detectThreadsContentType(p.media_type),
    mediaUrls: collectMediaUrls(p),
    thumbnailUrl: p.thumbnail_url ?? p.media_url ?? null,
    publishedAt: p.timestamp ? safeDate(p.timestamp) : null,
  };
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
  // For a CAROUSEL_ALBUM, `children` holds every slide and the parent
  // `media_url` is just the cover — which is the SAME image as the first
  // child. Including both duplicated the first image (and pushed the real
  // last slide out of any downstream length cap). So: use children when
  // present, and fall back to the parent media_url only for single-media
  // posts (IMAGE / VIDEO, which have no children).
  const children = post.children?.data ?? [];
  if (children.length > 0) {
    return children
      .map((child) => child.media_url)
      .filter((url): url is string => !!url);
  }
  return post.media_url ? [post.media_url] : [];
}

function mapChildren(post: ThreadsPost): ContentChild[] {
  return (post.children?.data ?? []).map((child) => ({
    id: child.id,
    mediaType: detectThreadsContentType(child.media_type),
    mediaUrl: child.media_url ?? null,
    thumbnailUrl: child.thumbnail_url ?? null,
    permalink: child.permalink ?? null,
    altText: child.alt_text ?? null,
  }));
}

function safeDate(s: string): Date | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
