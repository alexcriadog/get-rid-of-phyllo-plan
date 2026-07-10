// Threads audience / account-level insights fetcher.
//
// Endpoint: GET /{user-id}/threads_insights?metric=<name>[&breakdown=<dim>]
//
// Each metric is requested individually so a single rejection (e.g.
// follower_demographics needs ≥100 followers) doesn't poison the rest.
//
// Per developers.facebook.com/docs/threads/insights:
//   - follower_demographics supports breakdown ∈ {country, city, age, gender}.
//   - Only ONE breakdown per call → we issue four parallel calls, one per
//     dimension.
//   - The metric needs 100+ followers; below that, Threads returns code=801
//     subcode=4279032 ("No puedes obtener información demográfica de los
//     usuarios con menos de 100 seguidores"). We capture that signal as a
//     typed DemographicBreakdownError so the UI can explain the gap.
//   - The bucket map ships in `total_value.value` (the documented shape).
//     Older account snapshots also carried it inside `values[]`, so we read
//     both for resilience.
//
// Lifetime scalars (views/likes/replies/reposts/quotes) come either as
// `total_value.value` or a daily `values[]` we sum.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BoundThreadsClient } from '../../shared/threads-api/threads-client';
import { rethrowCritical } from '../../shared/fetch-guards';
import type {
  ThreadsApiResponse,
  ThreadsInsight,
} from '../../shared/threads-api/threads-types';
import {
  extractAccountId,
  extractGraphError,
  extractMetaError,
} from '../../shared/meta-graph';
import { AdapterFetchError } from '../../shared/platform-adapter.port';
import type {
  AudienceData,
  DemographicBreakdownError,
  DistributionBucket,
} from '../../shared/platform-types';
import { buildThreadsContext } from '../threads.context';
import { THREADS_API_CLIENT } from '../threads.tokens';

type ScalarKey = 'views' | 'likes' | 'replies' | 'reposts' | 'quotes' | 'clicks';
type Breakdown = 'country' | 'city' | 'gender' | 'age';

interface MetricSpec {
  name: string;
  /** Lifetime scalar mapped onto AudienceData/AccountInsightsData. */
  scalar?: ScalarKey;
  /** Time-series metric (followers_count is the only one). */
  series?: 'followers';
  /** Demographic breakdown — pulls a single bucket dimension at a time. */
  breakdown?: Breakdown;
}

const METRICS: MetricSpec[] = [
  { name: 'views', scalar: 'views' },
  { name: 'likes', scalar: 'likes' },
  { name: 'replies', scalar: 'replies' },
  { name: 'reposts', scalar: 'reposts' },
  { name: 'quotes', scalar: 'quotes' },
  // Link clicks across the account's posts (changelog 2025-07-02).
  { name: 'clicks', scalar: 'clicks' },
  { name: 'followers_count', series: 'followers' },
  // All four supported follower_demographics breakdowns. Each one is a
  // separate Threads call (the API only allows one breakdown per request).
  { name: 'follower_demographics', breakdown: 'country' },
  { name: 'follower_demographics', breakdown: 'city' },
  { name: 'follower_demographics', breakdown: 'age' },
  { name: 'follower_demographics', breakdown: 'gender' },
];

/** Threads error code/subcode pair returned when an account has <100 followers
 *  and tries to read follower_demographics. */
const DEMOGRAPHICS_THRESHOLD_CODE = 801;
const DEMOGRAPHICS_THRESHOLD_SUBCODE = 4279032;

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
          return {
            spec,
            body,
            error: null as string | null,
            errorMeta: null as { code?: number; subcode?: number; message: string } | null,
          };
        } catch (err) {
          rethrowCritical(err);
          const graph = extractGraphError(err);
          return {
            spec,
            body: null as ThreadsApiResponse<ThreadsInsight[]> | null,
            error: extractMetaError(err),
            errorMeta: graph,
          };
        }
      }),
    );

    const scalars: Partial<Record<ScalarKey, number>> = {};
    let followersCurrent: number | undefined;
    const followerCountSeries: Array<{ endTime: string; value: number }> = [];
    const distributions: Record<Breakdown, DistributionBucket[]> = {
      country: [],
      city: [],
      age: [],
      gender: [],
    };
    const breakdownErrors: DemographicBreakdownError[] = [];
    const errors: string[] = [];

    for (const r of results) {
      if (r.error || !r.body) {
        errors.push(`${r.spec.name}${r.spec.breakdown ? `[${r.spec.breakdown}]` : ''}: ${r.error ?? 'no body'}`);
        // For demographic calls, surface the failure to the UI as a typed
        // DemographicBreakdownError so we can show "needs 100 followers"
        // instead of an empty panel.
        if (r.spec.breakdown && r.errorMeta) {
          breakdownErrors.push({
            breakdown: r.spec.breakdown,
            message:
              r.errorMeta.code === DEMOGRAPHICS_THRESHOLD_CODE &&
              r.errorMeta.subcode === DEMOGRAPHICS_THRESHOLD_SUBCODE
                ? 'Threads requires 100+ followers before exposing follower demographics.'
                : r.errorMeta.message,
            code: r.errorMeta.code,
            subcode: r.errorMeta.subcode,
          });
        }
        continue;
      }
      const insights = r.body.data ?? [];
      for (const insight of insights) {
        if (r.spec.scalar) {
          // Threads returns scalar lifetime metrics two ways: either as
          // `total_value.value` (likes/replies/reposts/quotes) or as a daily
          // `values[]` time series that we sum (views — the only one that
          // ships as series in account insights today). Read both shapes.
          let v: number | undefined;
          if (typeof insight.total_value?.value === 'number') {
            v = insight.total_value.value;
          } else if (Array.isArray(insight.values)) {
            v = insight.values.reduce((sum, point) => {
              return typeof point.value === 'number' ? sum + point.value : sum;
            }, 0);
          }
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
        if (r.spec.breakdown) {
          // follower_demographics:
          //   - documented shape: total_value.value = { US: 1234, GB: 567 }
          //   - legacy shape:     values[last].value = same map
          // Read both for resilience.
          const buckets = extractBucketMap(insight);
          if (buckets) {
            for (const [label, raw] of Object.entries(buckets)) {
              if (typeof raw === 'number') {
                distributions[r.spec.breakdown].push({
                  label,
                  value: raw,
                  unit: 'count',
                });
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
    if (typeof scalars.clicks === 'number') extra.clicks = scalars.clicks;

    return {
      countryDistribution: distributions.country,
      cityDistribution: distributions.city,
      ageDistribution: distributions.age,
      genderDistribution: distributions.gender,
      // The Threads demographics product is "followers" (not reached/engaged
      // like IG). We surface per-breakdown failures via reachedDemographics
      // so the UI can render "needs 100 followers" hints next to the
      // empty-state panels.
      reachedDemographics:
        breakdownErrors.length > 0 ? { errors: breakdownErrors } : undefined,
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

/**
 * Extract the bucket map ({US: 12, GB: 7, ...}) from a follower_demographics
 * insight regardless of whether Threads returned it under `total_value.value`
 * (the documented shape) or `values[last].value` (an older shape).
 */
function extractBucketMap(
  insight: ThreadsInsight,
): Record<string, unknown> | null {
  const totalVal = (insight.total_value as { value?: unknown } | undefined)?.value;
  if (totalVal && typeof totalVal === 'object') {
    return totalVal as Record<string, unknown>;
  }
  const last = insight.values?.[insight.values.length - 1]?.value;
  if (last && typeof last === 'object') {
    return last as Record<string, unknown>;
  }
  return null;
}
