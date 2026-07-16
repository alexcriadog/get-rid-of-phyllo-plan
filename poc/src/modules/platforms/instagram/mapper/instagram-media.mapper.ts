// Instagram media mappers — pure functions. Phase E.

import { createHash } from 'node:crypto';
import { MONGO_COLLECTIONS } from '@shared/database/mongo.service';
import type {
  ContentChild,
  ContentData,
  ContentMetrics,
} from '../../shared/platform-types';
import { MEDIA_TYPE_MAP } from '../instagram.constants';
import type { GraphMedia } from '../instagram.types';

export function mediaToContent(media: GraphMedia): ContentData {
  const metrics = extractMetrics(media);
  // Reels carry media_type=VIDEO + media_product_type=REELS, so keying only on
  // media_type misclassifies them as plain 'video'. Prefer the product type so
  // reels map to 'reel' (→ InsightIQ type REELS, shown as a Reel not a Video).
  const type =
    media.media_product_type === 'REELS'
      ? 'reel'
      : (MEDIA_TYPE_MAP[media.media_type ?? ''] ?? 'other');
  const serialized = JSON.stringify(media);
  const hash = createHash('sha256').update(serialized).digest('hex');

  const rawChildren = media.children?.data ?? [];
  const children: ContentChild[] = rawChildren.map((c) => ({
    id: c.id,
    mediaType: MEDIA_TYPE_MAP[c.media_type ?? ''] ?? 'other',
    mediaUrl: c.media_url ?? null,
    thumbnailUrl: c.thumbnail_url ?? null,
    permalink: c.permalink ?? null,
  }));

  // For carousels, expose every child media URL in `mediaUrls[]` so
  // consumers that don't understand the `children` field still get
  // everything.
  const mediaUrls: string[] = [];
  if (children.length > 0) {
    for (const child of children) {
      if (child.mediaUrl) mediaUrls.push(child.mediaUrl);
    }
  } else if (media.media_url) {
    mediaUrls.push(media.media_url);
  }

  return {
    platformContentId: media.id,
    contentType: type,
    caption: media.caption ?? null,
    permalink: media.permalink ?? null,
    mediaUrls,
    thumbnailUrl: media.thumbnail_url ?? children[0]?.thumbnailUrl ?? null,
    metrics,
    publishedAt: media.timestamp ? new Date(media.timestamp) : null,
    fetchedAt: new Date(),
    children: children.length > 0 ? children : undefined,
    mediaProductType: media.media_product_type ?? null,
    shortcode: media.shortcode ?? null,
    isSharedToFeed:
      typeof media.is_shared_to_feed === 'boolean'
        ? media.is_shared_to_feed
        : null,
    ownerHandle: media.owner?.username ?? null,
    // Max-capture: fields the /media call already returns but we used to
    // leave in the raw blob only (docs/max-capture-all-platforms.md).
    altText: media.alt_text ?? null,
    isCommentEnabled:
      typeof media.is_comment_enabled === 'boolean'
        ? media.is_comment_enabled
        : null,
    collaborators: extractCollaborators(media),
    rawResponse: {
      collection: MONGO_COLLECTIONS.rawPlatformResponses,
      contentHash: hash,
    },
  };
}

/**
 * Co-author usernames on collab posts (fetched on the FB-graph flow only).
 * Null when the field is absent or carries no usable username — the /v1
 * `collaboration`/`authors` keys then stay null, exactly as before.
 */
function extractCollaborators(media: GraphMedia): string[] | null {
  const entries = media.collaborators?.data ?? [];
  const usernames = entries
    .map((c) => c.username)
    .filter((u): u is string => typeof u === 'string' && u.length > 0);
  return usernames.length > 0 ? usernames : null;
}

export function extractMetrics(media: GraphMedia): ContentMetrics {
  // v22 scalar fields live on the media object itself.
  //
  // Phase B.2: counts ride free on the /media call. fetchContentInsights()
  // may overwrite shares/saves later via the per-media /insights endpoint
  // (those numbers are typically equal to the free fields, but insights
  // includes attribution detail). Setting them here means a token without
  // `instagram_manage_insights` still produces non-zero shares/saves.
  const out: ContentMetrics = {};
  if (typeof media.like_count === 'number') out.likes = media.like_count;
  if (typeof media.comments_count === 'number') out.comments = media.comments_count;
  if (typeof media.shares_count === 'number') out.shares = media.shares_count;
  if (typeof media.saved_count === 'number') out.saves = media.saved_count;

  // Numeric overflow fields → metrics.extra. Non-numeric overflow fields
  // (boost_ads_list array, boost_eligibility_info object,
  // legacy_instagram_media_id string) live only in the rawResponse blob;
  // metrics.extra is Record<string, number> by contract.
  const extra: Record<string, number> = {};
  if (typeof media.reposts_count === 'number') extra.reposts = media.reposts_count;
  if (typeof media.total_like_count === 'number') extra.total_like_count = media.total_like_count;
  if (typeof media.total_comments_count === 'number') extra.total_comments_count = media.total_comments_count;
  if (typeof media.total_views_count === 'number') extra.total_views_count = media.total_views_count;
  if (Object.keys(extra).length > 0) out.extra = extra;

  return out;
}
