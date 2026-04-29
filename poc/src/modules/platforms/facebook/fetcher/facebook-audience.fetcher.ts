// Facebook audience fetcher. Phase C.
//
// Pulls page-level demographic distributions and account-level insights
// for a Facebook Page. Meta sunsetted gender/age in 2024 with no successor;
// only country + city distributions are available on the modern
// `page_follows_country` / `_city` metrics. Activity counters
// (`page_media_view`, `page_views_total`, etc.) come back as a 28-day
// time series we sum, except for `page_follows` which is cumulative — we
// keep that as a series and derive the net delta.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BoundGraphClient } from '../../shared/meta-graph/graph-client';
import {
  GraphInsight,
  extractAccountId,
  extractMetaError,
} from '../../shared/meta-graph';
import { AdapterFetchError } from '../../shared/platform-adapter.port';
import type {
  AudienceData,
  DistributionBucket,
} from '../../shared/platform-types';
import { buildFacebookContext } from '../facebook.context';
import { FACEBOOK_GRAPH_CLIENT } from '../facebook.tokens';
import type { AccountInsightsCounterMap } from '../facebook.types';

@Injectable()
export class FacebookAudienceFetcher {
  private readonly logger = new Logger(FacebookAudienceFetcher.name);

  constructor(
    @Inject(FACEBOOK_GRAPH_CLIENT)
    private readonly client: BoundGraphClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AudienceData> {
    const ctx = buildFacebookContext(accessToken, canonicalId, metadata);
    const accountId = extractAccountId(metadata);

    const PERIOD_DAYS = 28;
    const until = Math.floor(Date.now() / 1000);
    const since = until - PERIOD_DAYS * 86_400;

    type MetricSpec = {
      name: string;
      mapTo?: keyof AccountInsightsCounterMap;
      timeSeries?: boolean;
      distribution?: 'country' | 'city';
    };
    const specs: MetricSpec[] = [
      { name: 'page_follows', mapTo: 'page_follows', timeSeries: true },
      { name: 'page_media_view', mapTo: 'impressions' },
      { name: 'page_total_media_view_unique', mapTo: 'reach' },
      { name: 'page_views_total', mapTo: 'profileViews' },
      { name: 'page_total_actions', mapTo: 'totalInteractions' },
      { name: 'page_follows_country', distribution: 'country' },
      { name: 'page_follows_city', distribution: 'city' },
    ];

    const results = await Promise.all(
      specs.map(async (spec) => {
        try {
          const body = await this.client.call<{ data?: GraphInsight[] }>({
            endpoint: `/${canonicalId}/insights`,
            params: { metric: spec.name, period: 'day', since, until },
            accessToken,
            context: ctx,
            accountId,
          });
          return { spec, body, error: null as string | null };
        } catch (err) {
          return {
            spec,
            body: null as { data?: GraphInsight[] } | null,
            error: extractMetaError(err),
          };
        }
      }),
    );

    const counters: AccountInsightsCounterMap = {
      impressions: 0,
      reach: 0,
      profileViews: 0,
      totalInteractions: 0,
      page_follows: 0,
    };
    const followerSeries: Array<{ endTime: string; value: number }> = [];
    const countryDistribution: DistributionBucket[] = [];
    const cityDistribution: DistributionBucket[] = [];
    const errors: string[] = [];

    for (const r of results) {
      if (r.error || !r.body) {
        errors.push(`${r.spec.name}: ${r.error ?? 'no body'}`);
        continue;
      }
      for (const insight of r.body.data ?? []) {
        const values = insight.values ?? [];

        if (r.spec.distribution) {
          const latest = values[values.length - 1]?.value;
          if (latest && typeof latest === 'object') {
            const bucket =
              r.spec.distribution === 'country'
                ? countryDistribution
                : cityDistribution;
            for (const [label, raw] of Object.entries(
              latest as Record<string, unknown>,
            )) {
              if (typeof raw === 'number') {
                bucket.push({ label, value: raw, unit: 'count' });
              }
            }
          }
          continue;
        }

        // `page_follows/day` is CUMULATIVE — store as a daily series and let
        // the consumer derive net change. Other counters are true daily
        // counts that are safely additive.
        let total = 0;
        for (const v of values) {
          if (typeof v.value === 'number') {
            if (r.spec.timeSeries && v.end_time) {
              followerSeries.push({ endTime: v.end_time, value: v.value });
            } else {
              total += v.value;
            }
          }
        }
        if (r.spec.mapTo && !r.spec.timeSeries) counters[r.spec.mapTo] += total;
      }
    }

    if (errors.length === specs.length) {
      throw new AdapterFetchError(
        'facebook',
        `/${canonicalId}/insights`,
        new Error('All audience metrics rejected'),
        `FB audience unavailable for ${canonicalId}. Graph rejected every metric: ${errors.join(
          ' | ',
        )}. Likely causes: (1) OAuth user has no ANALYZE task on this Page; (2) app lacks Advanced Access to 'read_insights' / 'pages_read_engagement'; (3) token missing those scopes.`,
      );
    }

    return {
      // Meta does NOT expose gender/age for FB Pages (no replacement metric
      // for the deprecated `page_fans_gender_age`).
      genderDistribution: [],
      ageDistribution: [],
      countryDistribution,
      cityDistribution,
      accountInsights: {
        periodDays: PERIOD_DAYS,
        impressions: counters.impressions,
        reach: counters.reach,
        profileViews: counters.profileViews,
        totalInteractions: counters.totalInteractions,
        followerCountSeries: followerSeries,
        extra: {
          page_follows_net_28d:
            followerSeries.length >= 2
              ? followerSeries[followerSeries.length - 1].value -
                followerSeries[0].value
              : 0,
          followers_count_current:
            followerSeries[followerSeries.length - 1]?.value ?? 0,
        },
      },
      fetchedAt: new Date(),
    };
  }
}
