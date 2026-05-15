// Helix VOD / clip payloads → canonical ContentData.
//
// We surface BOTH VODs and clips through `engagement_new`. They share most
// fields but diverge on a few:
//   - VODs (type=archive): muted_segments, stream_id, Helix-format duration
//     string ('3h12m4s'). contentType = 'video'.
//   - Clips: vod_offset (seconds into the source VOD), creator_id (who
//     clipped it — viral signal), embed_url. contentType = 'clip'.
//
// `clip` is a new ContentType union member (added to platform-types.ts);
// the frontend renders clips like reels.

import type {
  ContentData,
  ContentMetrics,
} from '../../shared/platform-types';
import type {
  TwitchClip,
  TwitchVideo,
} from '../../shared/twitch-api/twitch-types';

export interface RawArchiveRef {
  collection: string;
  contentHash: string;
}

const DEFAULT_ARCHIVE_REF: RawArchiveRef = {
  collection: 'raw_platform_responses',
  contentHash: '',
};

export function videoToContent(
  video: TwitchVideo,
  raw: RawArchiveRef = DEFAULT_ARCHIVE_REF,
): ContentData {
  const id = video.id ?? '';
  const permalink = id ? `https://www.twitch.tv/videos/${id}` : null;
  const durationS = parseHelixDurationSeconds(video.duration);
  // Twitch's player embed requires a `parent` domain param at runtime, so
  // we leave the embedUrl bare and let the UI append `&parent=<host>`.
  const embedUrl = id ? `https://player.twitch.tv/?video=${id}` : null;

  const metrics: ContentMetrics = {
    views: video.view_count ?? undefined,
    extra: {
      kind: encodeKind('vod'),
    },
  };
  if (durationS != null) metrics.extra!['durationSeconds'] = durationS;
  if (Array.isArray(video.muted_segments)) {
    const total = video.muted_segments.reduce(
      (acc, m) => acc + (typeof m.duration === 'number' ? m.duration : 0),
      0,
    );
    if (total > 0) metrics.extra!['mutedSegmentsTotalSeconds'] = total;
    metrics.extra!['mutedSegmentsCount'] = video.muted_segments.length;
  }

  return {
    platformContentId: id,
    contentType: 'video',
    caption: composeCaption(video.title, video.description),
    permalink,
    mediaUrls: video.thumbnail_url ? [video.thumbnail_url] : [],
    thumbnailUrl: video.thumbnail_url || null,
    embedUrl,
    metrics,
    publishedAt: safeDate(video.published_at ?? video.created_at),
    fetchedAt: new Date(),
    mediaProductType: 'VOD',
    shortcode: id || null,
    tags: null,
    // Twitch VODs don't carry per-VOD game/category data via Helix; the game
    // visible on the channel is current-state, not per-VOD.
    categoryId: null,
    defaultLanguage: video.language || null,
    duration: video.duration || null,
    privacyStatus: video.viewable || null,
    liveBroadcastContent: 'none',
    rawResponse: raw,
  };
}

export function clipToContent(
  clip: TwitchClip,
  raw: RawArchiveRef = DEFAULT_ARCHIVE_REF,
): ContentData {
  const id = clip.id ?? '';
  const permalink = clip.url ?? (id ? `https://clips.twitch.tv/${id}` : null);

  const metrics: ContentMetrics = {
    views: clip.view_count ?? undefined,
    extra: {
      kind: encodeKind('clip'),
    },
  };
  if (typeof clip.duration === 'number') {
    metrics.extra!['durationSeconds'] = clip.duration;
  }
  if (typeof clip.vod_offset === 'number') {
    metrics.extra!['vodOffsetSeconds'] = clip.vod_offset;
  }

  return {
    platformContentId: id,
    contentType: 'clip',
    caption: clip.title || null,
    permalink,
    mediaUrls: clip.thumbnail_url ? [clip.thumbnail_url] : [],
    thumbnailUrl: clip.thumbnail_url || null,
    embedUrl: clip.embed_url || null,
    metrics,
    publishedAt: safeDate(clip.created_at),
    fetchedAt: new Date(),
    mediaProductType: 'CLIP',
    shortcode: id || null,
    tags: null,
    categoryId: clip.game_id || null,
    defaultLanguage: clip.language || null,
    ownerHandle: clip.creator_name || null,
    liveBroadcastContent: 'none',
    rawResponse: raw,
  };
}

/** Encodes VOD vs clip into metrics.extra (which is Record<string, number>).
 * 0 = vod, 1 = clip. The frontend reads this to branch rendering. */
function encodeKind(kind: 'vod' | 'clip'): number {
  return kind === 'vod' ? 0 : 1;
}

/** Parses Helix-style durations like '3h12m4s' → total seconds. Returns null
 * on unparseable input. */
export function parseHelixDurationSeconds(
  d: string | null | undefined,
): number | null {
  if (!d) return null;
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(d);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const hours = m[1] ? Number(m[1]) : 0;
  const minutes = m[2] ? Number(m[2]) : 0;
  const seconds = m[3] ? Number(m[3]) : 0;
  return hours * 3600 + minutes * 60 + seconds;
}

function composeCaption(
  title?: string | null,
  description?: string | null,
): string | null {
  const t = title?.trim() || null;
  const d = description?.trim() || null;
  if (t && d) return `${t}\n\n${d}`;
  return t ?? d ?? null;
}

function safeDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
