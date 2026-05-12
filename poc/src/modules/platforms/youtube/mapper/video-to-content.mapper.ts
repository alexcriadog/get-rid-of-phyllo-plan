// videos.list item → canonical ContentData.
//
// `contentType` heuristic:
//   - `liveStreamingDetails` present                 → 'live'
//   - duration ≤ 60s and snippet has 'shorts' tag    → 'reel' (Shorts)
//   - everything else                                → 'video'
//
// `permalink` is reconstructed from videoId — YouTube doesn't return it.
// `mediaUrls` is the highest-resolution thumbnail (we don't ship video URLs;
// the UI uses an embed iframe via `embedUrl`).

import {
  type ContentData,
  type ContentMetrics,
  type ContentType,
} from '../../shared/platform-types';
import type { YoutubeVideo } from '../../shared/youtube-api/youtube-types';

export interface RawArchiveRef {
  collection: string;
  contentHash: string;
}

export function videoToContent(
  video: YoutubeVideo,
  rawResponse: RawArchiveRef = { collection: 'raw_platform_responses', contentHash: '' },
): ContentData {
  const snippet = video.snippet ?? {};
  const stats = video.statistics ?? {};
  const details = video.contentDetails ?? {};

  const id = video.id ?? '';
  const permalink = id ? `https://www.youtube.com/watch?v=${id}` : null;
  const embedUrl = id ? `https://www.youtube.com/embed/${id}` : null;

  const durationS = parseIso8601DurationSeconds(details.duration ?? null);
  const isLive = !!video.liveStreamingDetails;
  const tagsLower = (snippet.tags ?? []).map((t) => t.toLowerCase());
  const looksShort =
    durationS != null &&
    durationS > 0 &&
    durationS <= 60 &&
    (tagsLower.includes('shorts') || tagsLower.includes('#shorts'));
  const contentType: ContentType = isLive ? 'live' : looksShort ? 'reel' : 'video';

  const thumb =
    snippet.thumbnails?.maxres?.url ??
    snippet.thumbnails?.standard?.url ??
    snippet.thumbnails?.high?.url ??
    snippet.thumbnails?.medium?.url ??
    snippet.thumbnails?.default?.url ??
    null;

  const metrics: ContentMetrics = {
    likes: parseIntSafe(stats.likeCount) ?? undefined,
    comments: parseIntSafe(stats.commentCount) ?? undefined,
    views: parseIntSafe(stats.viewCount) ?? undefined,
    extra: {},
  };
  if (parseIntSafe(stats.favoriteCount) != null) {
    metrics.extra!['favorites'] = parseIntSafe(stats.favoriteCount)!;
  }
  if (durationS != null) {
    metrics.extra!['durationSeconds'] = durationS;
  }
  if (video.liveStreamingDetails?.concurrentViewers) {
    metrics.extra!['concurrentViewers'] =
      parseIntSafe(video.liveStreamingDetails.concurrentViewers) ?? 0;
  }

  const status = video.status ?? {};
  return {
    platformContentId: id,
    contentType,
    caption: composeCaption(snippet.title, snippet.description),
    permalink,
    mediaUrls: thumb ? [thumb] : [],
    thumbnailUrl: thumb,
    embedUrl,
    metrics,
    publishedAt: snippet.publishedAt ? safeDate(snippet.publishedAt) : null,
    fetchedAt: new Date(),
    mediaProductType: contentType === 'reel' ? 'SHORTS' : 'VIDEO',
    shortcode: id || null,
    tags: snippet.tags ?? null,
    categoryId: snippet.categoryId ?? null,
    defaultLanguage: snippet.defaultLanguage ?? null,
    defaultAudioLanguage: snippet.defaultAudioLanguage ?? null,
    definition: details.definition ?? null,
    dimension: details.dimension ?? null,
    hasCaptions: details.caption ?? null,
    licensedContent:
      typeof details.licensedContent === 'boolean' ? details.licensedContent : null,
    license: status.license ?? null,
    embeddable:
      typeof status.embeddable === 'boolean' ? status.embeddable : null,
    publicStatsViewable:
      typeof status.publicStatsViewable === 'boolean'
        ? status.publicStatsViewable
        : null,
    madeForKids:
      typeof status.madeForKids === 'boolean' ? status.madeForKids : null,
    privacyStatus: status.privacyStatus ?? null,
    liveBroadcastContent: snippet.liveBroadcastContent ?? null,
    uploadStatus: status.uploadStatus ?? null,
    duration: details.duration ?? null,
    topicCategories: video.topicDetails?.topicCategories ?? null,
    recordingDate: video.recordingDetails?.recordingDate ?? null,
    recordingLocation: video.recordingDetails?.location ?? null,
    liveStreamingDetails: video.liveStreamingDetails ?? null,
    rawResponse,
  };
}

function composeCaption(title?: string | null, description?: string | null): string | null {
  if (title && description) return `${title}\n\n${description}`;
  return title ?? description ?? null;
}

/** Parses ISO-8601 durations like `PT1H2M3S` → total seconds. Returns null on
 * unparseable input. */
export function parseIso8601DurationSeconds(d: string | null): number | null {
  if (!d) return null;
  const m =
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(d);
  if (!m) return null;
  const days = m[1] ? Number(m[1]) : 0;
  const hours = m[2] ? Number(m[2]) : 0;
  const minutes = m[3] ? Number(m[3]) : 0;
  const seconds = m[4] ? Number(m[4]) : 0;
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function parseIntSafe(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
  return null;
}

function safeDate(s: string): Date | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
