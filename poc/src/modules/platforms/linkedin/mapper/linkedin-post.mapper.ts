// /rest/posts element (+ optional totalShareStatistics + resolved media
// URLs) → canonical ContentData.
//
// Mapping decisions:
//  - permalink reconstructed as linkedin.com/feed/update/{urn} (works for
//    both share and ugcPost URNs).
//  - commentary arrives in LinkedIn's "Little" text format:
//    `{hashtag|\#|Tag}` for hashtags, `@[Name](urn:...)` for mentions and
//    backslash-escaped specials. decodeLittleText() renders it human-readable
//    and extracts the hashtag list into `tags`.
//  - media: posts only carry asset URNs (urn:li:image / urn:li:video /
//    urn:li:document); the fetcher resolves them via the Images/Videos APIs
//    and passes a urn→{url,thumbnail} map. contentType derives from the URN
//    prefix; multiImage → 'carousel' with children.
//  - metrics.views = impressionCount, metrics.reach = uniqueImpressionsCount,
//    clicks + engagement-rate land in metrics.extra.
//  - rawResponse follows the Twitch convention (RawArchiveRef param with the
//    shared-collection default) — the client archives the full page payload.

import type {
  ContentChild,
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

/** Resolved media asset (Images/Videos API downloadUrl + thumbnail). */
export interface LinkedInResolvedMedia {
  url?: string | null;
  thumbnail?: string | null;
  /** Video length in milliseconds (Videos API `duration`). */
  durationMs?: number | null;
}

const DEFAULT_ARCHIVE_REF: RawArchiveRef = {
  collection: 'raw_platform_responses',
  contentHash: '',
};

/**
 * Decode LinkedIn's "Little" commentary format into plain text:
 *   `{hashtag|\#|Tag}`        → `#Tag`   (collected into hashtags)
 *   `@[Name](urn:li:...)`     → `@Name`
 *   `\X` escapes              → `X`
 */
export function decodeLittleText(text: string): {
  text: string;
  hashtags: string[];
} {
  const hashtags: string[] = [];
  let out = text.replace(/\{hashtag\|\\#\|([^}]+)\}/g, (_m, tag: string) => {
    hashtags.push(tag);
    return `#${tag}`;
  });
  out = out.replace(/@\[([^\]]+)\]\(urn:[^)]*\)/g, '@$1');
  out = out.replace(/\\([(){}<>[\]|*~_@#\\])/g, '$1');
  return { text: out, hashtags };
}

function contentTypeOf(post: LinkedInPost): ContentType {
  if (post.content?.multiImage) return 'carousel';
  const mediaUrn = post.content?.media?.id ?? '';
  if (mediaUrn.startsWith('urn:li:video:')) return 'video';
  if (mediaUrn.startsWith('urn:li:image:')) return 'image';
  return 'other'; // documents, articles, plain text
}

export function linkedInPostToContent(
  post: LinkedInPost,
  stats: LinkedInTotalShareStatistics | null,
  raw: RawArchiveRef = DEFAULT_ARCHIVE_REF,
  mediaByUrn?: Map<string, LinkedInResolvedMedia>,
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

  const decoded = post.commentary ? decodeLittleText(post.commentary) : null;

  // Resolve media URLs from the asset map the fetcher built.
  const mediaUrls: string[] = [];
  let thumbnailUrl: string | null = null;
  let durationMs: number | null = null;
  let children: ContentChild[] | undefined;
  const lookup = (urn: string | undefined): LinkedInResolvedMedia | null =>
    urn ? (mediaByUrn?.get(urn) ?? null) : null;

  if (post.content?.multiImage?.images?.length) {
    children = [];
    for (const img of post.content.multiImage.images) {
      const resolved = lookup(img.id);
      if (resolved?.url) mediaUrls.push(resolved.url);
      children.push({
        id: img.id ?? '',
        mediaType: 'image',
        mediaUrl: resolved?.url ?? null,
        thumbnailUrl: resolved?.url ?? null,
      });
    }
    thumbnailUrl = mediaUrls[0] ?? null;
  } else if (post.content?.media?.id) {
    const resolved = lookup(post.content.media.id);
    if (resolved?.url) mediaUrls.push(resolved.url);
    thumbnailUrl = resolved?.thumbnail ?? resolved?.url ?? null;
    durationMs = resolved?.durationMs ?? null;
  }

  // Article/link shares (max-capture): reuse the same additive keys Threads
  // link posts use, so consumers read one field across platforms.
  const article = post.content?.article ?? null;

  return {
    platformContentId: post.id,
    contentType: contentTypeOf(post),
    caption: decoded?.text ?? null,
    permalink: `https://www.linkedin.com/feed/update/${post.id}`,
    mediaUrls,
    thumbnailUrl,
    metrics,
    publishedAt: publishedMs ? new Date(publishedMs) : null,
    fetchedAt: new Date(),
    privacyStatus: post.visibility ?? null,
    uploadStatus: post.lifecycleState ?? null,
    linkAttachmentUrl: article?.source ?? null,
    linkAttachmentTitle: article?.title ?? null,
    // /v1 `duration` wants integer seconds; Videos API returns milliseconds.
    duration: durationMs != null ? String(Math.round(durationMs / 1000)) : null,
    ...(decoded && decoded.hashtags.length > 0 ? { tags: decoded.hashtags } : {}),
    ...(children ? { children } : {}),
    rawResponse: raw,
  };
}
