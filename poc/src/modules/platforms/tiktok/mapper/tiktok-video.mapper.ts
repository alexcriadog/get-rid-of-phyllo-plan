// TikTok v1.3 video mapper — pure functions.
// Verified field names against live API 2026-04-29.

import { createHash } from 'node:crypto';
import { MONGO_COLLECTIONS } from '@shared/database/mongo.service';
import type { ContentData, ContentMetrics } from '../../shared/platform-types';
import type { TikTokVideo } from '../../shared/tiktok-api';

export function videoToContent(video: TikTokVideo): ContentData {
  const metrics = extractVideoMetrics(video);
  const serialized = JSON.stringify(video);
  const hash = createHash('sha256').update(serialized).digest('hex');

  return {
    platformContentId: video.item_id,
    contentType: 'video',
    caption: video.caption ?? null,
    permalink: video.share_url ?? null,
    mediaUrls: [],                        // v1.3 doesn't expose full_video_url
    thumbnailUrl: video.thumbnail_url ?? null,
    metrics,
    publishedAt: parseCreateTime(video.create_time),
    fetchedAt: new Date(),
    rawResponse: {
      collection: MONGO_COLLECTIONS.rawPlatformResponses,
      contentHash: hash,
    },
  };
}

export function extractVideoMetrics(video: TikTokVideo): ContentMetrics {
  const out: ContentMetrics = {};
  const extra: Record<string, number> = {};

  if (typeof video.video_views === 'number') out.views = video.video_views;
  if (typeof video.likes === 'number') out.likes = video.likes;
  if (typeof video.comments === 'number') out.comments = video.comments;
  if (typeof video.shares === 'number') out.shares = video.shares;
  if (typeof video.video_duration === 'number') {
    extra['video_duration_s'] = video.video_duration;
  }
  if (Object.keys(extra).length > 0) out.extra = extra;
  return out;
}

/** v1.3 returns create_time as a numeric STRING. Accept both. */
function parseCreateTime(raw: string | undefined): Date | null {
  if (!raw) return null;
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return Number.isFinite(n) ? new Date(n * 1000) : null;
}
