// TikTok audience fetcher. v1.3.
//
// /business/get/ embeds audience_countries and audience_genders directly.
// `engaged_audience` and historical follower_count come back as a daily
// time-series under data.metrics. We surface that via accountInsights.

import { Inject, Injectable } from '@nestjs/common';
import type { AccountInsightsData, AudienceData } from '../../shared/platform-types';
import type {
  BoundTikTokClient,
  TikTokBusinessAccount,
} from '../../shared/tiktok-api';
import { extractAccountId } from '../../shared/tiktok-api';
import {
  parseAudienceCountries,
  parseAudienceGenders,
} from '../mapper/tiktok-audience.mapper';
import { buildTikTokContext } from '../tiktok.context';
import { TIKTOK_API_CLIENT } from '../tiktok.tokens';

const AUDIENCE_FIELDS = [
  'followers_count',
  'audience_countries',
  'audience_genders',
  'engaged_audience',
];

@Injectable()
export class TikTokAudienceFetcher {
  constructor(
    @Inject(TIKTOK_API_CLIENT) private readonly client: BoundTikTokClient,
  ) {}

  async fetch(
    accessToken: string,
    _canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AudienceData> {
    const ctx = buildTikTokContext(accessToken, metadata);
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
      accountInsights.followerCountSeries = series
        .filter((m) => typeof m.followers_count === 'number' && m.date)
        .map((m) => ({ endTime: m.date, value: m.followers_count as number }));
      const engaged = series.reduce((sum, m) => sum + (m.engaged_audience ?? 0), 0);
      accountInsights.accountsEngaged = engaged;
      accountInsights.periodDays = series.length;
    }

    return {
      genderDistribution: parseAudienceGenders(account),
      ageDistribution: [],               // not exposed by v1.3
      countryDistribution: parseAudienceCountries(account),
      cityDistribution: [],              // not exposed
      accountInsights,
      fetchedAt: new Date(),
    };
  }
}
