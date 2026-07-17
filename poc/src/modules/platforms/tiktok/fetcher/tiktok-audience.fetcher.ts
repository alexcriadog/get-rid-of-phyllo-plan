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
import type {
  AccountInsightsData,
  AudienceData,
  DemographicBreakdownError,
  DistributionBucket,
} from '../../shared/platform-types';
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

/**
 * TikTok exposes demographics only once an account reaches this many
 * followers. Below it the API returns EMPTY arrays rather than an error, so
 * "empty" is ambiguous downstream — we disambiguate it here (see
 * buildThresholdErrors).
 */
const DEMOGRAPHICS_FOLLOWER_THRESHOLD = 100;

const DEMOGRAPHIC_BREAKDOWNS: ReadonlyArray<
  DemographicBreakdownError['breakdown']
> = ['age', 'city', 'country', 'gender'];

/**
 * TikTok refuses demographics below the follower threshold by returning empty
 * arrays with no error attached. The showroom can't tell that apart from "not
 * synced yet", so it rendered a blank panel. We report the reason on
 * `followerDemographicsErrors` — not the reachedDemographics slot the Threads
 * fetcher borrows, because that would offer a "Reached" tab for a scope TikTok
 * has no concept of.
 *
 * Only claim the threshold when we can actually prove it: TikTok must have
 * told us the follower count AND it must be under the bar. An empty response
 * from a large account is a different (unknown) problem and must not be
 * mislabelled.
 *
 * The message deliberately omits the live count: canonical docs keep
 * last-known-good, so text that stops being emitted lingers. The current
 * headcount rides on accountInsights.extra.followers_count_current instead,
 * which every sync rewrites.
 */
function buildThresholdErrors(
  followersCount: number | undefined,
  distributions: ReadonlyArray<DistributionBucket[]>,
): DemographicBreakdownError[] {
  const allEmpty = distributions.every((d) => d.length === 0);
  const belowThreshold =
    typeof followersCount === 'number' &&
    followersCount < DEMOGRAPHICS_FOLLOWER_THRESHOLD;
  if (!allEmpty || !belowThreshold) return [];

  const message =
    `TikTok exposes audience demographics only once an account reaches ` +
    `${DEMOGRAPHICS_FOLLOWER_THRESHOLD} followers.`;
  return DEMOGRAPHIC_BREAKDOWNS.map((breakdown) => ({ breakdown, message }));
}

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
      // followerCountSeries is a DELTA series (see AccountInsightsData) — the
      // showroom sums it for "daily net change". TikTok's
      // daily_total_followers is a running total at end of day, so it must NOT
      // go here; the net delta is new − lost. The running total is served as
      // extra.followers_count_current below.
      accountInsights.followerCountSeries = extractDailySeries(
        series,
        (m) => (m.daily_new_followers ?? 0) - (m.daily_lost_followers ?? 0),
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
    // The live follower total, so the UI can say how far an account is from
    // the demographics threshold. `followerCountSeries` above is the daily
    // series and is empty for accounts TikTok returns no `metrics[]` for.
    if (typeof account.followers_count === 'number') {
      accountInsights.extra = {
        ...accountInsights.extra,
        followers_count_current: account.followers_count,
      };
    }

    const genderDistribution = parseAudienceGenders(account);
    const ageDistribution = parseAudienceAges(account);
    const countryDistribution = parseAudienceCountries(account);
    const cityDistribution = parseAudienceCities(account);

    const thresholdErrors = buildThresholdErrors(account.followers_count, [
      genderDistribution,
      ageDistribution,
      countryDistribution,
      cityDistribution,
    ]);

    return {
      genderDistribution,
      ageDistribution,
      countryDistribution,
      cityDistribution,
      ...(thresholdErrors.length > 0
        ? { followerDemographicsErrors: thresholdErrors }
        : {}),
      accountInsights,
      fetchedAt: new Date(),
    };
  }
}
