// TikTok audience fetcher. v1.3.
//
// /business/get/ exposes:
//   - top-level demographics (audience_countries/cities/genders/ages)
//     gated behind a 100-follower threshold.
//   - lifetime aggregates (total_likes, videos_count).
//   - a daily time-series (`metrics[]`) covering the last ~7 days with
//     followers deltas, video views, profile views, CTAs, engaged audience,
//     and a 24-bucket per-hour activity heatmap.
// All of those land in AudienceData.

import { Inject, Injectable } from '@nestjs/common';
import type { AccountInsightsData, AudienceData } from '../../shared/platform-types';
import type {
  BoundTikTokClient,
  TikTokBusinessAccount,
} from '../../shared/tiktok-api';
import { extractAccountId } from '../../shared/tiktok-api';
import {
  extractDailySeries,
  parseAudienceActivity,
  parseAudienceAges,
  parseAudienceCities,
  parseAudienceCountries,
  parseAudienceGenders,
} from '../mapper/tiktok-audience.mapper';
import { buildTikTokContext } from '../tiktok.context';
import { TIKTOK_API_CLIENT } from '../tiktok.tokens';

const AUDIENCE_FIELDS = [
  // Lifetime aggregates
  'total_likes',
  'videos_count',
  'followers_count',
  // Demographics (gated behind 100-follower threshold)
  'audience_countries',
  'audience_cities',
  'audience_genders',
  'audience_ages',
  // Daily time-series fields (returned inside `metrics[]`)
  'engaged_audience',
  'video_views',
  'unique_video_views',
  'profile_views',
  'likes',
  'comments',
  'shares',
  'daily_total_followers',
  'daily_new_followers',
  'daily_lost_followers',
  'audience_activity',
  // Daily CTA series
  'bio_link_clicks',
  'email_clicks',
  'address_clicks',
  'phone_number_clicks',
  'app_download_clicks',
  'lead_submissions',
];

@Injectable()
export class TikTokAudienceFetcher {
  constructor(
    @Inject(TIKTOK_API_CLIENT) private readonly client: BoundTikTokClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AudienceData> {
    const ctx = buildTikTokContext(accessToken, canonicalId, metadata);
    const account = await this.client.call<TikTokBusinessAccount>({
      endpoint: '/business/get/',
      method: 'GET',
      fields: AUDIENCE_FIELDS,
      accessToken,
      context: ctx,
      accountId: extractAccountId(metadata),
    });

    const accountInsights: AccountInsightsData = {};
    const series = account.metrics ?? [];
    if (series.length > 0) {
      accountInsights.periodDays = series.length;
      // Followers — prefer daily_total_followers (real total at end of day);
      // fall back to legacy followers_count if TikTok still ships it that way.
      accountInsights.followerCountSeries = extractDailySeries(
        series,
        (m) => m.daily_total_followers ?? m.followers_count,
      );
      accountInsights.newFollowersSeries = extractDailySeries(series, (m) => m.daily_new_followers);
      accountInsights.lostFollowersSeries = extractDailySeries(series, (m) => m.daily_lost_followers);
      accountInsights.videoViewsSeries = extractDailySeries(series, (m) => m.video_views);
      accountInsights.uniqueVideoViewsSeries = extractDailySeries(series, (m) => m.unique_video_views);
      accountInsights.profileViewsSeries = extractDailySeries(series, (m) => m.profile_views);
      accountInsights.likesSeries = extractDailySeries(series, (m) => m.likes);
      accountInsights.commentsSeries = extractDailySeries(series, (m) => m.comments);
      accountInsights.sharesSeries = extractDailySeries(series, (m) => m.shares);
      accountInsights.engagedAudienceSeries = extractDailySeries(series, (m) => m.engaged_audience);
      accountInsights.bioLinkClicksSeries = extractDailySeries(series, (m) => m.bio_link_clicks);
      accountInsights.emailClicksSeries = extractDailySeries(series, (m) => m.email_clicks);
      accountInsights.phoneNumberClicksSeries = extractDailySeries(series, (m) => m.phone_number_clicks);
      accountInsights.addressClicksSeries = extractDailySeries(series, (m) => m.address_clicks);
      accountInsights.appDownloadClicksSeries = extractDailySeries(series, (m) => m.app_download_clicks);
      accountInsights.leadSubmissionsSeries = extractDailySeries(series, (m) => m.lead_submissions);
      // Period-aggregate scalars (sum across the window).
      const sumSeries = (pick: (m: typeof series[number]) => number | undefined): number =>
        series.reduce((acc, m) => acc + (pick(m) ?? 0), 0);
      accountInsights.accountsEngaged = sumSeries((m) => m.engaged_audience);
      accountInsights.views = sumSeries((m) => m.video_views);
      accountInsights.reach = sumSeries((m) => m.unique_video_views);
      accountInsights.profileViews = sumSeries((m) => m.profile_views);
      accountInsights.likes = sumSeries((m) => m.likes);
      accountInsights.comments = sumSeries((m) => m.comments);
      accountInsights.shares = sumSeries((m) => m.shares);
      // 24-bucket activity heatmap aggregated over the period.
      accountInsights.audienceActivity = parseAudienceActivity(account);
    }
    if (typeof account.total_likes === 'number') {
      accountInsights.lifetimeLikes = account.total_likes;
    }
    if (typeof account.videos_count === 'number') {
      accountInsights.videosCount = account.videos_count;
    }

    return {
      genderDistribution: parseAudienceGenders(account),
      ageDistribution: parseAudienceAges(account),
      countryDistribution: parseAudienceCountries(account),
      cityDistribution: parseAudienceCities(account),
      accountInsights,
      fetchedAt: new Date(),
    };
  }
}
