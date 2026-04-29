// Facebook post mappers — pure functions, no DI, no I/O. Phase D.
// Lifted verbatim from FacebookAdapter private methods. Behaviour identical;
// the snapshot tests in __tests__/facebook-post.mapper.spec.ts pin this.

import { createHash } from 'node:crypto';
import { MONGO_COLLECTIONS } from '@shared/database/mongo.service';
import type {
  ContentData,
  ContentMetrics,
  ContentType,
} from '../../shared/platform-types';
import type { GraphInsight } from '../../shared/meta-graph';
import type { FacebookPost } from '../facebook.types';

export function postToContent(post: FacebookPost): ContentData {
  const metrics = extractPostMetrics(post);
  const mediaUrls = extractMediaUrls(post);
  const contentType = detectPostContentType(post);
  const serialized = JSON.stringify(post);
  const hash = createHash('sha256').update(serialized).digest('hex');

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
    rawResponse: {
      collection: MONGO_COLLECTIONS.rawPlatformResponses,
      contentHash: hash,
    },
  };
}

export function extractPostMetrics(post: FacebookPost): ContentMetrics {
  const out: ContentMetrics = {};
  // Summary counts ride free on the /posts call. Insights enrichment
  // (mergePostInsights) may overwrite likes with the typed reactions
  // breakdown later — that's fine since the typed total equals this one.
  const commentsTotal = post.comments?.summary?.total_count;
  if (typeof commentsTotal === 'number') out.comments = commentsTotal;
  const reactionsTotal = post.reactions?.summary?.total_count;
  if (typeof reactionsTotal === 'number') out.likes = reactionsTotal;
  for (const insight of post.insights?.data ?? []) {
    const first = insight.values?.[0]?.value;
    if (insight.name === 'post_impressions' && typeof first === 'number') {
      out.impressions = first;
      out.reach = out.reach ?? first;
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
      // `post_media_view` is impressions. Meta removed per-post unique reach
      // in v22 (`post_impressions_unique` was deprecated) so we do NOT set
      // `reach` here — leaving it undefined is honest rather than pretending
      // impressions equals reach.
      post.metrics.impressions = first;
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
