// /rest/posts element (+ optional totalShareStatistics) → canonical
// ContentData.
//
// Mapping decisions:
//  - permalink reconstructed as linkedin.com/feed/update/{urn} (works for
//    both share and ugcPost URNs).
//  - metrics.views = impressionCount, metrics.reach = uniqueImpressionsCount,
//    clicks + engagement-rate land in metrics.extra.
//  - contentType: single media id → 'image' (LinkedIn doesn't tell image vs
//    video without decorating the media URN — videos are a follow-up),
//    multiImage → 'carousel', article/text → 'other'.
//  - rawResponse follows the Twitch convention (RawArchiveRef param with the
//    shared-collection default) — the client archives the full page payload.

import type {
  ContentData,
  ContentType,
} from '../../shared/platform-types';
import type {
  LinkedInPost,
  LinkedInTotalShareStatistics,
} from '../../shared/linkedin-api/linkedin-types';

export interface RawArchiveRef {
  collection: string;
  contentHash: string;
}

const DEFAULT_ARCHIVE_REF: RawArchiveRef = {
  collection: 'raw_platform_responses',
  contentHash: '',
};

function contentTypeOf(post: LinkedInPost): ContentType {
  if (post.content?.multiImage) return 'carousel';
  if (post.content?.media) return 'image';
  return 'other';
}

export function linkedInPostToContent(
  post: LinkedInPost,
  stats: LinkedInTotalShareStatistics | null,
  raw: RawArchiveRef = DEFAULT_ARCHIVE_REF,
): ContentData {
  const publishedMs = post.publishedAt ?? post.createdAt ?? null;
  const metrics: ContentData['metrics'] = {};
  if (stats) {
    if (typeof stats.impressionCount === 'number')
      metrics.views = stats.impressionCount;
    if (typeof stats.uniqueImpressionsCount === 'number')
      metrics.reach = stats.uniqueImpressionsCount;
    if (typeof stats.likeCount === 'number') metrics.likes = stats.likeCount;
    if (typeof stats.commentCount === 'number')
      metrics.comments = stats.commentCount;
    if (typeof stats.shareCount === 'number') metrics.shares = stats.shareCount;
    const extra: Record<string, number> = {};
    if (typeof stats.clickCount === 'number') extra['clicks'] = stats.clickCount;
    if (typeof stats.engagement === 'number')
      extra['engagementRate'] = stats.engagement;
    if (Object.keys(extra).length > 0) metrics.extra = extra;
  }

  return {
    platformContentId: post.id,
    contentType: contentTypeOf(post),
    caption: post.commentary ?? null,
    permalink: `https://www.linkedin.com/feed/update/${post.id}`,
    mediaUrls: [],
    metrics,
    publishedAt: publishedMs ? new Date(publishedMs) : null,
    fetchedAt: new Date(),
    privacyStatus: post.visibility ?? null,
    uploadStatus: post.lifecycleState ?? null,
    rawResponse: raw,
  };
}
