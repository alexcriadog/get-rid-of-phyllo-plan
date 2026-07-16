// Facebook post mappers — pure functions, no DI, no I/O. Phase D.
// Lifted verbatim from FacebookAdapter private methods. Behaviour identical;
// the snapshot tests in __tests__/facebook-post.mapper.spec.ts pin this.

import { createHash } from 'node:crypto';
import { MONGO_COLLECTIONS } from '@shared/database/mongo.service';
import type {
  ContentChild,
  ContentData,
  ContentLocation,
  ContentMetrics,
  ContentType,
} from '../../shared/platform-types';
import type { GraphInsight } from '../../shared/meta-graph';
import type { FacebookPost } from '../facebook.types';

export function postToContent(post: FacebookPost): ContentData {
  const metrics = extractPostMetrics(post);
  const mediaUrls = extractMediaUrls(post);
  const contentType = detectPostContentType(post);
  const children = extractCarouselChildren(post);
  const serialized = JSON.stringify(post);
  const hash = createHash('sha256').update(serialized).digest('hex');

  const linkAttachment = extractLinkAttachment(post);

  return {
    platformContentId: post.id,
    contentType,
    caption: post.message ?? null,
    permalink: post.permalink_url ?? null,
    mediaUrls,
    thumbnailUrl: post.full_picture ?? null,
    metrics,
    publishedAt: post.created_time ? new Date(post.created_time) : null,
    fetchedAt: new Date(),
    children: children.length > 0 ? children : undefined,
    // Max-capture (docs/max-capture-all-platforms.md). All null-safe: the
    // fetcher degrades field-by-field when Graph rejects one, so any of
    // these may be absent.
    mediaProductType: post.status_type ? post.status_type.toUpperCase() : null,
    mentions: extractMessageTagNames(post),
    location: placeToLocation(post.place),
    linkAttachmentUrl: linkAttachment?.url ?? null,
    linkAttachmentTitle: linkAttachment?.title ?? null,
    // /posts returns published Page posts; the flag only matters when Graph
    // explicitly says false (scheduled/unpublished surfaced edge cases).
    privacyStatus: post.is_published === false ? 'unpublished' : null,
    rawResponse: {
      collection: MONGO_COLLECTIONS.rawPlatformResponses,
      contentHash: hash,
    },
  };
}

/**
 * Outbound link on link-share posts. Only attachments whose kind says
 * "link/share" qualify — photo/video posts keep their attachment URLs in
 * mediaUrls, never here. `unshimmed_url` is the real destination;
 * `url` is Facebook's l.php shim fallback.
 */
function extractLinkAttachment(
  post: FacebookPost,
): { url: string | null; title: string | null } | null {
  for (const a of post.attachments?.data ?? []) {
    const kind = (a.media_type ?? a.type ?? '').toLowerCase();
    if (kind.includes('link') || kind === 'share') {
      const url = a.unshimmed_url ?? a.url ?? null;
      const title = a.title ?? null;
      if (url || title) return { url, title };
    }
  }
  return null;
}

/** Distinct tagged names from message_tags (people/pages tagged in the text). */
function extractMessageTagNames(post: FacebookPost): string[] | null {
  const names = (post.message_tags ?? [])
    .map((t) => t.name)
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
  return names.length > 0 ? [...new Set(names)] : null;
}

/** Graph `place` → canonical tagged-location (same shape Threads uses). */
function placeToLocation(place: FacebookPost['place']): ContentLocation | null {
  if (!place?.id) return null;
  const loc = place.location ?? {};
  return {
    id: place.id,
    name: place.name ?? null,
    city: loc.city ?? null,
    country: loc.country ?? null,
    latitude: typeof loc.latitude === 'number' ? loc.latitude : null,
    longitude: typeof loc.longitude === 'number' ? loc.longitude : null,
    address: loc.street ?? null,
    postalCode: loc.zip ?? null,
  };
}

/**
 * Build a per-slide list for FB albums so the public UI's carousel modal
 * can render prev/next arrows (gated on `slides.length > 1`). FB exposes
 * carousels via the first attachment's `subattachments[]` — each one a
 * photo or video. We map them to the canonical `ContentChild` shape that
 * IG already populates.
 */
function extractCarouselChildren(post: FacebookPost): ContentChild[] {
  const out: ContentChild[] = [];
  const subs = post.attachments?.data?.[0]?.subattachments?.data ?? [];
  for (const sub of subs) {
    const mediaUrl = sub.media?.source ?? sub.media?.image?.src ?? sub.url ?? null;
    const subType = (sub.media_type ?? sub.type ?? '').toLowerCase();
    let kind: ContentType = 'image';
    if (subType.includes('video')) kind = 'video';
    else if (subType.includes('photo') || subType.includes('image')) kind = 'image';
    out.push({
      id: sub.target?.id ?? `${post.id}-sub-${out.length}`,
      mediaType: kind,
      mediaUrl,
      thumbnailUrl: sub.media?.image?.src ?? null,
      permalink: sub.url ?? null,
    });
  }
  return out;
}

export function extractPostMetrics(post: FacebookPost): ContentMetrics {
  const out: ContentMetrics = {};
  // Summary counts ride free on the /posts call. Insights enrichment
  // (mergePostInsights) may overwrite likes with the typed reactions
  // breakdown later — that's fine since the typed total equals this one.
  // Video views are stamped onto metrics later by the fetcher's
  // enrichWithVideoViews step (single /{page_id}/videos batch call).
  const commentsTotal = post.comments?.summary?.total_count;
  if (typeof commentsTotal === 'number') out.comments = commentsTotal;
  const reactionsTotal = post.reactions?.summary?.total_count;
  if (typeof reactionsTotal === 'number') out.likes = reactionsTotal;
  // Max-capture: native share count rides free on the extended /posts call
  // and fills the Phyllo-canonical share_count slot (was always null on FB).
  const sharesCount = post.shares?.count;
  if (typeof sharesCount === 'number') out.shares = sharesCount;
  for (const insight of post.insights?.data ?? []) {
    const first = insight.values?.[0]?.value;
    // post_impressions retired 2025-11-15. Replacement post_media_view
    // is handled in mergePostInsights → metrics.views (not here).
    if (
      insight.name === 'post_reactions_by_type_total' &&
      first !== null &&
      typeof first === 'object'
    ) {
      const reactions = first as Record<string, number>;
      const total = Object.values(reactions).reduce(
        (sum, v) => (typeof v === 'number' ? sum + v : sum),
        0,
      );
      out.likes = total;
      const extra = out.extra ?? {};
      for (const [k, v] of Object.entries(reactions)) {
        if (typeof v === 'number') extra[`reaction_${k}`] = v;
      }
      out.extra = extra;
    } else if (typeof first === 'number') {
      const extra = out.extra ?? {};
      extra[insight.name] = first;
      out.extra = extra;
    }
  }
  return out;
}

export function extractMediaUrls(post: FacebookPost): string[] {
  const urls: string[] = [];
  const attachments = post.attachments?.data ?? [];
  for (const a of attachments) {
    const src = a.media?.source ?? a.media?.image?.src ?? a.url;
    if (typeof src === 'string' && src.length > 0) {
      urls.push(src);
    }
    for (const sub of a.subattachments?.data ?? []) {
      const subSrc = sub.media?.source ?? sub.media?.image?.src ?? sub.url;
      if (typeof subSrc === 'string' && subSrc.length > 0) {
        urls.push(subSrc);
      }
    }
  }
  if (urls.length === 0 && post.full_picture) {
    urls.push(post.full_picture);
  }
  return urls;
}

export function detectPostContentType(post: FacebookPost): ContentType {
  const first = post.attachments?.data?.[0];
  if (!first) return post.full_picture ? 'image' : 'other';
  const mediaType = (first.media_type ?? first.type ?? '').toLowerCase();
  if (mediaType.includes('video')) return 'video';
  if (mediaType.includes('album')) return 'carousel';
  if (mediaType.includes('photo') || mediaType.includes('image')) return 'image';
  return post.full_picture ? 'image' : 'other';
}

export function mergePostInsights(post: ContentData, data: GraphInsight[]): void {
  const extra = post.metrics.extra ?? {};
  for (const insight of data) {
    const values = insight.values ?? [];
    const first = values[values.length - 1]?.value ?? values[0]?.value;
    if (insight.name === 'post_media_view' && typeof first === 'number') {
      // Meta retired `post_impressions*` on 2025-11-15 and rebranded
      // the replacement field as "Views". The wire-format metric is
      // `post_media_view`; surface it as `metrics.views`.
      post.metrics.views = first;
    } else if (
      insight.name === 'post_total_media_view_unique' &&
      typeof first === 'number'
    ) {
      // Replaces the retired `post_impressions_unique` (Jun-15-2025).
      // Meta documents this as the canonical reach metric in v25 —
      // unique users who saw the post.
      post.metrics.reach = first;
    } else if (
      insight.name === 'post_reactions_by_type_total' &&
      first !== null &&
      typeof first === 'object'
    ) {
      const reactions = first as Record<string, number>;
      const total = Object.values(reactions).reduce(
        (sum, v) => (typeof v === 'number' ? sum + v : sum),
        0,
      );
      post.metrics.likes = total;
      for (const [k, v] of Object.entries(reactions)) {
        if (typeof v === 'number') extra[`reaction_${k}`] = v;
      }
    } else if (
      insight.name === 'post_clicks_by_type' &&
      first !== null &&
      typeof first === 'object'
    ) {
      const clicks = first as Record<string, number>;
      for (const [k, v] of Object.entries(clicks)) {
        if (typeof v === 'number') extra[`click_${k.replace(/\s+/g, '_')}`] = v;
      }
    } else if (
      insight.name === 'post_activity_by_action_type' &&
      first !== null &&
      typeof first === 'object'
    ) {
      const activity = first as Record<string, number>;
      for (const [k, v] of Object.entries(activity)) {
        if (typeof v === 'number') extra[`activity_${k.replace(/\s+/g, '_')}`] = v;
      }
    } else if (typeof first === 'number') {
      extra[insight.name] = first;
    }
  }
  post.metrics.extra = extra;
}

/** Page profile picture extractor — used by FacebookProfileFetcher. */
export function extractPictureUrl(picture: unknown): string | null {
  if (!picture || typeof picture !== 'object') return null;
  const data = (picture as { data?: { url?: string } }).data;
  if (data && typeof data.url === 'string') return data.url;
  return null;
}

