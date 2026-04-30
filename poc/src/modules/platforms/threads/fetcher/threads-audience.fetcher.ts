// Threads audience / account-level insights fetcher.
//
// Endpoint: GET /{user-id}/threads_insights?metric=<name>
//
// Each metric is requested individually so a single rejection (e.g.
// follower_demographics requires 100+ followers) doesn't poison the rest.
// Behaviour mirrors facebook-audience.fetcher.ts:
//   - One request per metric, run in parallel.
//   - Per-metric errors are collected; if every metric failed we throw an
//     AdapterFetchError with the diagnostic bundle.
//   - Lifetime scalars are read from `total_value.value`.
//   - Time-series metrics are read from `values[]` (only `followers_count`
//     uses this shape today).
//
// follower_demographics is the only distribution Threads exposes today, and
// only for accounts > 100 followers. We request it with breakdown=country.
// gender / age / city need separate calls with different breakdown values;
// when supported by the account, the same request shape applies.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BoundThreadsClient } from '../../shared/threads-api/threads-client';
import type {
  ThreadsApiResponse,
  ThreadsInsight,
} from '../../shared/threads-api/threads-types';
import { extractAccountId, extractMetaError } from '../../shared/meta-graph';
import { AdapterFetchError } from '../../shared/platform-adapter.port';
import type {
  AudienceData,
  DistributionBucket,
} from '../../shared/platform-types';
import { buildThreadsContext } from '../threads.context';
import { THREADS_API_CLIENT } from '../threads.tokens';

type ScalarKey = 'views' | 'likes' | 'replies' | 'reposts' | 'quotes';

interface MetricSpec {
  name: string;
  /** Lifetime scalar mapped onto AudienceData/AccountInsightsData. */
  scalar?: ScalarKey;
  /** Time-series metric (followers_count is the only one). */
  series?: 'followers';
  /** Demographic breakdown — pulls a single bucket dimension at a time. */
  breakdown?: 'country' | 'city' | 'gender' | 'age';
}

const METRICS: MetricSpec[] = [
  { name: 'views', scalar: 'views' },
  { name: 'likes', scalar: 'likes' },
  { name: 'replies', scalar: 'replies' },
  { name: 'reposts', scalar: 'reposts' },
  { name: 'quotes', scalar: 'quotes' },
  { name: 'followers_count', series: 'followers' },
  { name: 'follower_demographics', breakdown: 'country' },
];

@Injectable()
export class ThreadsAudienceFetcher {
  private readonly logger = new Logger(ThreadsAudienceFetcher.name);

  constructor(
    @Inject(THREADS_API_CLIENT)
    private readonly client: BoundThreadsClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AudienceData> {
    const ctx = buildThreadsContext(accessToken, canonicalId, metadata);
    const accountId = extractAccountId(metadata);

    const results = await Promise.all(
      METRICS.map(async (spec) => {
        try {
          const params: Record<string, string | number> = { metric: spec.name };
          if (spec.breakdown) params.breakdown = spec.breakdown;
          const body = await this.client.call<ThreadsApiResponse<ThreadsInsight[]>>({
            endpoint: `/${canonicalId}/threads_insights`,
            params,
            accessToken,
            context: ctx,
            accountId,
          });
          return { spec, body, error: null as string | null };
        } catch (err) {
          return {
            spec,
            body: null as ThreadsApiResponse<ThreadsInsight[]> | null,
            error: extractMetaError(err),
          };
        }
      }),
    );

    const scalars: Partial<Record<ScalarKey, number>> = {};
    let followersCurrent: number | undefined;
    const followerCountSeries: Array<{ endTime: string; value: number }> = [];
    const countryDistribution: DistributionBucket[] = [];
    const errors: string[] = [];

    for (const r of results) {
      if (r.error || !r.body) {
        errors.push(`${r.spec.name}: ${r.error ?? 'no body'}`);
        continue;
      }
      const insights = r.body.data ?? [];
      for (const insight of insights) {
        if (r.spec.scalar) {
          const v = insight.total_value?.value;
          if (typeof v === 'number') {
            scalars[r.spec.scalar] = (scalars[r.spec.scalar] ?? 0) + v;
          }
          continue;
        }
        if (r.spec.series === 'followers') {
          // Threads returns followers_count as either total_value (current
          // count) or a values[] series. Capture both shapes.
          if (typeof insight.total_value?.value === 'number') {
            followersCurrent = insight.total_value.value;
          }
          for (const v of insight.values ?? []) {
            if (typeof v.value === 'number' && v.end_time) {
              followerCountSeries.push({ endTime: v.end_time, value: v.value });
            }
          }
          continue;
        }
        if (r.spec.breakdown === 'country') {
          // follower_demographics returns a values[] entry whose `value` is
          // a bucket map { US: 1234, GB: 567 }.
          const last = insight.values?.[insight.values.length - 1]?.value;
          if (last && typeof last === 'object') {
            for (const [label, raw] of Object.entries(
              last as Record<string, unknown>,
            )) {
              if (typeof raw === 'number') {
                countryDistribution.push({ label, value: raw, unit: 'count' });
              }
            }
          }
        }
      }
    }

    if (errors.length === METRICS.length) {
      throw new AdapterFetchError(
        'threads',
        `/${canonicalId}/threads_insights`,
        new Error('All Threads insights metrics rejected'),
        `Threads audience unavailable for ${canonicalId}. Insights API rejected every metric: ${errors.join(
          ' | ',
        )}. Likely causes: (1) token missing 'threads_manage_insights' scope; (2) account < 100 followers (follower_demographics gate); (3) brand-new account with no inventory.`,
      );
    }
    if (errors.length > 0) {
      this.logger.warn(
        `Threads audience partial for ${canonicalId}: ${errors.join(' | ')}`,
      );
    }

    const lastFollowerSample = followerCountSeries[followerCountSeries.length - 1]?.value;
    const followersFinal = followersCurrent ?? lastFollowerSample;
    const extra: Record<string, number> = {};
    if (typeof followersFinal === 'number') {
      extra.followers_count_current = followersFinal;
    }
    if (typeof scalars.reposts === 'number') extra.reposts = scalars.reposts;
    if (typeof scalars.quotes === 'number') extra.quotes = scalars.quotes;

    return {
      // Threads exposes only country (and only when the account has ≥ 100
      // followers) — leave the rest empty, the support matrix declares it.
      genderDistribution: [],
      ageDistribution: [],
      countryDistribution,
      cityDistribution: [],
      accountInsights: {
        views: scalars.views,
        likes: scalars.likes,
        replies: scalars.replies,
        followerCountSeries: followerCountSeries.length > 0 ? followerCountSeries : undefined,
        extra: Object.keys(extra).length > 0 ? extra : undefined,
      },
      fetchedAt: new Date(),
    };
  }
}
