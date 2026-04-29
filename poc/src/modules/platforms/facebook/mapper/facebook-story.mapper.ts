// Facebook story mappers — pure functions. Phase D.
// Lifted verbatim from FacebookAdapter private methods. The 9-metric set
// in mapStoryInsights mirrors what Meta exposes for Page stories today.

import { createHash } from 'node:crypto';
import { MONGO_COLLECTIONS } from '@shared/database/mongo.service';
import type { ContentData, ContentMetrics } from '../../shared/platform-types';
import type { GraphInsight } from '../../shared/meta-graph';
import type { FacebookStory } from '../facebook.types';

export function storyToContent(story: FacebookStory): ContentData {
  const serialized = JSON.stringify(story);
  const hash = createHash('sha256').update(serialized).digest('hex');
  const publishedAt = parseCreationTime(story.creation_time);

  return {
    platformContentId: story.post_id,
    contentType: 'story',
    caption: null,
    permalink: story.url ?? null,
    mediaUrls: [],
    thumbnailUrl: null,
    // No metrics yet — fetchStoryInsights() fills them in.
    metrics: {},
    publishedAt,
    fetchedAt: new Date(),
    mediaProductType: 'STORY',
    rawResponse: {
      collection: MONGO_COLLECTIONS.rawPlatformResponses,
      contentHash: hash,
    },
  };
}

/**
 * Story insights mapping — `GET /{post_id}/insights` with NO `metric` param.
 * Returns the 9 metrics Meta exposes for Page stories today (verified
 * against Meta's own validation error which lists the canonical set):
 *   page_story_impressions_by_story_id            -> impressions
 *   page_story_impressions_by_story_id_unique     -> reach
 *   pages_fb_story_replies                        -> extra.story_replies
 *   pages_fb_story_shares                         -> shares
 *   pages_fb_story_thread_lightweight_reactions   -> likes (quick reacts)
 *   pages_fb_story_sticker_interactions           -> extra.sticker_interactions
 *   story_interaction                             -> extra.total_interactions
 *   story_media_view                              -> views
 *   story_total_media_view_unique                 -> extra.unique_media_views
 */
export function mapStoryInsights(data: GraphInsight[]): Partial<ContentMetrics> {
  const out: Partial<ContentMetrics> = {};
  const extra: Record<string, number> = {};
  for (const insight of data) {
    const v =
      insight.values?.[insight.values.length - 1]?.value ??
      insight.values?.[0]?.value;
    if (typeof v !== 'number') continue;
    switch (insight.name) {
      case 'page_story_impressions_by_story_id':
        out.impressions = v;
        break;
      case 'page_story_impressions_by_story_id_unique':
        out.reach = v;
        break;
      case 'pages_fb_story_shares':
        out.shares = v;
        break;
      case 'pages_fb_story_thread_lightweight_reactions':
        out.likes = v;
        break;
      case 'story_media_view':
        out.views = v;
        break;
      case 'pages_fb_story_replies':
        extra['story_replies'] = v;
        break;
      case 'pages_fb_story_sticker_interactions':
        extra['sticker_interactions'] = v;
        break;
      case 'story_interaction':
        extra['total_interactions'] = v;
        break;
      case 'story_total_media_view_unique':
        extra['unique_media_views'] = v;
        break;
      default:
        extra[insight.name] = v;
    }
  }
  if (Object.keys(extra).length > 0) out.extra = extra;
  return out;
}

/**
 * Page Stories returns `creation_time` as a UNIX-seconds STRING despite docs
 * implying numeric. Accept both, plus ISO 8601 as a fallback.
 */
export function parseCreationTime(
  raw: string | number | undefined,
): Date | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return new Date(raw * 1000);
  }
  if (typeof raw === 'string') {
    if (/^\d{9,}$/.test(raw)) return new Date(Number(raw) * 1000);
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}
