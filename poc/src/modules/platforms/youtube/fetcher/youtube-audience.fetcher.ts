// YouTube audience fetcher.
//
// Fans out 6 Analytics reports.query calls in parallel via Promise.allSettled
// (so one rejection doesn't poison the others), then merges via the
// analyticsToAudience mapper.
//
// Default window: last 90 days. Override via metadata.periodDays. The
// analytics API has a 24-72h freshness lag so we shift the end date back
// 1 day to avoid querying not-yet-finalized data.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AudienceData,
  DemographicBreakdownError,
} from '../../shared/platform-types';
import type { BoundYoutubeClient } from '../../shared/youtube-api/youtube-client';
import type { YoutubeAnalyticsReport } from '../../shared/youtube-api/youtube-types';
import { extractAccountId } from '../../shared/meta-graph';
import { buildYoutubeContext } from '../youtube.context';
import {
  type AnalyticsBundle,
  analyticsToAudience,
} from '../mapper/analytics-to-audience.mapper';
import { YOUTUBE_API_CLIENT } from '../youtube.tokens';
import { rethrowCritical } from '../../shared/fetch-guards';

const DEFAULT_PERIOD_DAYS = 90;

@Injectable()
export class YoutubeAudienceFetcher {
  private readonly logger = new Logger(YoutubeAudienceFetcher.name);

  constructor(
    @Inject(YOUTUBE_API_CLIENT)
    private readonly client: BoundYoutubeClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AudienceData> {
    const accountId = extractAccountId(metadata);
    const ctx = buildYoutubeContext(accessToken, canonicalId, metadata);
    const periodDays =
      typeof metadata?.['periodDays'] === 'number'
        ? (metadata['periodDays'] as number)
        : DEFAULT_PERIOD_DAYS;
    const { startDate, endDate } = computeWindow(periodDays);

    const baseArgs = {
      accessToken,
      context: ctx,
      accountId,
      ids: 'channel==MINE',
      startDate,
      endDate,
    } as const;

    const [
      dailyR,
      demoR,
      geoR,
      trafficR,
      devicesR,
      monetR,
    ] = await Promise.allSettled([
      this.client.analyticsQuery({
        ...baseArgs,
        metrics:
          'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,dislikes,comments,shares',
        dimensions: 'day',
        sort: 'day',
      }),
      this.client.analyticsQuery({
        ...baseArgs,
        metrics: 'viewerPercentage',
        dimensions: 'ageGroup,gender',
        sort: 'gender,ageGroup',
      }),
      this.client.analyticsQuery({
        ...baseArgs,
        metrics: 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained',
        dimensions: 'country',
        sort: '-views',
        maxResults: 200,
      }),
      this.client.analyticsQuery({
        ...baseArgs,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'insightTrafficSourceType',
        sort: '-views',
      }),
      this.client.analyticsQuery({
        ...baseArgs,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'deviceType',
        sort: '-views',
      }),
      this.client.analyticsQuery({
        ...baseArgs,
        metrics:
          'estimatedRevenue,estimatedAdRevenue,estimatedRedPartnerRevenue,grossRevenue,cpm,playbackBasedCpm,monetizedPlaybacks,adImpressions',
        dimensions: 'day',
        sort: 'day',
      }),
    ]);

    const errors: Array<{ breakdown: string; message: string }> = [];
    const bundle: AnalyticsBundle = {
      daily: pick(dailyR, 'daily', errors),
      demo: pick(demoR, 'demo', errors),
      geo: pick(geoR, 'geo', errors),
      traffic: pick(trafficR, 'traffic', errors),
      devices: pick(devicesR, 'devices', errors),
      monetization: pick(monetR, 'monetization', errors),
      errors: bundleErrorsFromAdapter(errors),
    };

    if (errors.length > 0) {
      this.logger.debug(
        `youtube audience: ${errors.length} bucket(s) failed: ${errors
          .map((e) => `${e.breakdown}=${e.message}`)
          .join('; ')}`,
      );
    }
    return analyticsToAudience(bundle);
  }
}

function pick(
  result: PromiseSettledResult<YoutubeAnalyticsReport>,
  bucket: string,
  errors: Array<{ breakdown: string; message: string }>,
): YoutubeAnalyticsReport | null {
  if (result.status === 'fulfilled') return result.value;
  // Rate-limit / revoked-token rejections must abort the sync — recording
  // them as a null bucket would blank the stored audience snapshot.
  rethrowCritical(result.reason);
  errors.push({
    breakdown: bucket,
    message: result.reason instanceof Error ? result.reason.message : String(result.reason),
  });
  return null;
}

function bundleErrorsFromAdapter(
  errors: Array<{ breakdown: string; message: string }>,
): DemographicBreakdownError[] {
  return errors.map((e) => ({
    breakdown:
      e.breakdown === 'demo'
        ? 'age'
        : e.breakdown === 'geo'
          ? 'country'
          : (e.breakdown as 'age' | 'gender' | 'country' | 'city'),
    message: e.message,
  }));
}

function computeWindow(periodDays: number): { startDate: string; endDate: string } {
  const now = new Date();
  const end = new Date(now.getTime() - 24 * 3_600_000);
  const start = new Date(end.getTime() - periodDays * 86_400_000);
  return {
    startDate: yyyymmdd(start),
    endDate: yyyymmdd(end),
  };
}

function yyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
