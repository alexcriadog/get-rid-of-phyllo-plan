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
  const type = MEDIA_TYPE_MAP[media.media_type ?? ''] ?? 'other';
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
    rawResponse: {
      collection: MONGO_COLLECTIONS.rawPlatformResponses,
      contentHash: hash,
    },
  };
}

export function extractMetrics(media: GraphMedia): ContentMetrics {
  // v22 scalar fields live on the media object itself.
  const out: ContentMetrics = {};
  if (typeof media.like_count === 'number') out.likes = media.like_count;
  if (typeof media.comments_count === 'number') out.comments = media.comments_count;
  return out;
}
