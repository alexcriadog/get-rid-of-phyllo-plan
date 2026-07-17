// TikTok v1.3 video mapper — pure functions.
// Field set verified against live API on 2026-04-29 (BC organic token).

import { createHash } from 'node:crypto';
import { MONGO_COLLECTIONS } from '@shared/database/mongo.service';
import type {
  ContentData,
  ContentInsights,
  ContentMetrics,
  DistributionBucket,
  SecondPercentage,
} from '../../shared/platform-types';
import type {
  TikTokAudienceBucket,
  TikTokAudienceTypeEntry,
  TikTokImpressionSource,
  TikTokSecondPercentage,
  TikTokVideo,
} from '../../shared/tiktok-api';

export function videoToContent(video: TikTokVideo): ContentData {
  const metrics = extractVideoMetrics(video);
  const insights = extractVideoInsights(video);
  const serialized = JSON.stringify(video);
  const hash = createHash('sha256').update(serialized).digest('hex');

  return {
    platformContentId: video.item_id,
    contentType: 'video',
    caption: video.caption ?? null,
    permalink: video.share_url ?? null,
    mediaUrls: [],                        // v1.3 doesn't expose full_video_url
    thumbnailUrl: video.thumbnail_url ?? null,
    embedUrl: video.embed_url ?? null,
    metrics,
    insights: hasAnyInsight(insights) ? insights : undefined,
    publishedAt: parseCreateTime(video.create_time),
    fetchedAt: new Date(),
    // Max-capture: fill the Phyllo-canonical slots instead of leaving them
    // null (docs/max-capture-all-platforms.md). video_duration is decimal
    // seconds; /v1 `duration` wants integer seconds. extra.video_duration_s
    // keeps the raw decimal for consumers that already read it.
    duration:
      typeof video.video_duration === 'number'
        ? String(Math.round(video.video_duration))
        : null,
    sponsored: typeof video.is_ad === 'boolean' ? video.is_ad : null,
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
  if (typeof video.reach === 'number') out.reach = video.reach;
  if (typeof video.likes === 'number') out.likes = video.likes;
  if (typeof video.comments === 'number') out.comments = video.comments;
  if (typeof video.shares === 'number') out.shares = video.shares;
  if (typeof video.favorites === 'number') out.saves = video.favorites;

  if (typeof video.video_duration === 'number') {
    extra['video_duration_s'] = video.video_duration;
  }
  if (typeof video.total_time_watched === 'number') {
    extra['total_time_watched_s'] = video.total_time_watched;
  }
  if (typeof video.average_time_watched === 'number') {
    extra['average_time_watched_s'] = video.average_time_watched;
  }
  if (typeof video.full_video_watched_rate === 'number') {
    extra['completion_rate'] = video.full_video_watched_rate;
  }
  if (typeof video.profile_views === 'number') {
    extra['profile_views'] = video.profile_views;
  }
  if (typeof video.new_followers === 'number') {
    extra['new_followers'] = video.new_followers;
  }
  // CTAs (per-post)
  if (typeof video.website_clicks === 'number') extra['website_clicks'] = video.website_clicks;
  if (typeof video.email_clicks === 'number') extra['email_clicks'] = video.email_clicks;
  if (typeof video.phone_number_clicks === 'number') extra['phone_number_clicks'] = video.phone_number_clicks;
  if (typeof video.address_clicks === 'number') extra['address_clicks'] = video.address_clicks;
  if (typeof video.app_download_clicks === 'number') extra['app_download_clicks'] = video.app_download_clicks;
  if (typeof video.lead_submissions === 'number') extra['lead_submissions'] = video.lead_submissions;

  if (Object.keys(extra).length > 0) out.extra = extra;
  return out;
}

function extractVideoInsights(video: TikTokVideo): ContentInsights {
  return {
    trafficSources: mapTrafficSources(video.impression_sources),
    retentionCurve: mapSecondCurve(video.video_view_retention),
    likesTimeline: mapSecondCurve(video.engagement_likes),
    audienceCountries: mapAudienceBuckets(video.audience_countries, (b) => b.country),
    audienceCities: mapAudienceBuckets(video.audience_cities, (b) => b.city),
    audienceGenders: mapAudienceBuckets(video.audience_genders, (b) => b.gender),
    audienceTypes: mapAudienceTypes(video.audience_types),
  };
}

function hasAnyInsight(i: ContentInsights): boolean {
  return Boolean(
    (i.trafficSources && i.trafficSources.length > 0) ||
    (i.retentionCurve && i.retentionCurve.length > 0) ||
    (i.likesTimeline && i.likesTimeline.length > 0) ||
    (i.audienceCountries && i.audienceCountries.length > 0) ||
    (i.audienceCities && i.audienceCities.length > 0) ||
    (i.audienceGenders && i.audienceGenders.length > 0) ||
    (i.audienceTypes && i.audienceTypes.length > 0),
  );
}

function mapTrafficSources(
  raw: TikTokImpressionSource[] | undefined,
): DistributionBucket[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  const out = raw
    .filter((b) => typeof b.percentage === 'number' && b.impression_source)
    .map((b) => ({
      label: b.impression_source,
      value: b.percentage,
      unit: 'percent' as const,
    }));
  return out.length > 0 ? out : undefined;
}

function mapSecondCurve(
  raw: TikTokSecondPercentage[] | undefined,
): SecondPercentage[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  const out: SecondPercentage[] = [];
  for (const entry of raw) {
    const second = Number(entry.second);
    if (!Number.isFinite(second)) continue;
    if (typeof entry.percentage !== 'number') continue;
    out.push({ second, percentage: entry.percentage });
  }
  // Sort ascending so the UI can render a left-to-right sparkline directly.
  out.sort((a, b) => a.second - b.second);
  return out.length > 0 ? out : undefined;
}

function mapAudienceBuckets(
  raw: TikTokAudienceBucket[] | undefined,
  pickLabel: (b: TikTokAudienceBucket) => string | undefined,
): DistributionBucket[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  const out = raw
    .filter((b) => typeof b.percentage === 'number' && pickLabel(b) != null)
    .map((b) => ({
      label: pickLabel(b) as string,
      value: b.percentage,
      unit: 'percent' as const,
    }));
  return out.length > 0 ? out : undefined;
}

function mapAudienceTypes(
  raw: TikTokAudienceTypeEntry[] | undefined,
): DistributionBucket[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  const out = raw
    .filter((b) => typeof b.percentage === 'number' && b.type)
    .map((b) => ({ label: b.type, value: b.percentage, unit: 'percent' as const }));
  return out.length > 0 ? out : undefined;
}

/** v1.3 returns create_time as a numeric STRING. Accept both. */
function parseCreateTime(raw: string | undefined): Date | null {
  if (!raw) return null;
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return Number.isFinite(n) ? new Date(n * 1000) : null;
}
