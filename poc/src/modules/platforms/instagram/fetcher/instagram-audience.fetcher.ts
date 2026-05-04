// Instagram audience fetcher. Phase E.
//
// IG audience is 14+ Graph calls split across three demographic flavours
// and an account-level totals + follower_count series. Each flavour is
// 4 per-breakdown calls (age, gender, country, city). Failures inside a
// flavour are non-fatal — the breakdowns that succeed still flow through.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BoundGraphClient } from '../../shared/meta-graph/graph-client';
import type { PlatformAdapterContext } from '../../shared/platform-adapter.port';
import {
  GraphInsight,
  extractAccountId,
  extractGraphError,
} from '../../shared/meta-graph';
import type {
  AccountInsightsData,
  AudienceData,
  DemographicDistributions,
} from '../../shared/platform-types';
import { buildInstagramContext } from '../instagram.context';
import { INSTAGRAM_GRAPH_CLIENT } from '../instagram.tokens';
import { parseFollowerDemographics } from '../mapper/instagram-audience.mapper';

@Injectable()
export class InstagramAudienceFetcher {
  private readonly logger = new Logger(InstagramAudienceFetcher.name);

  constructor(
    @Inject(INSTAGRAM_GRAPH_CLIENT)
    private readonly client: BoundGraphClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AudienceData> {
    const ctx = buildInstagramContext(accessToken, canonicalId, metadata);
    const accountId = extractAccountId(metadata);

    // 1. Follower demographics (4 per-breakdown calls).
    const follower = await this.fetchDemographics(
      'follower_demographics',
      accessToken,
      canonicalId,
      ctx,
      accountId,
    );

    // 2. Reached-audience demographics (4 more per-breakdown calls).
    const reached = await this.fetchDemographics(
      'reached_audience_demographics',
      accessToken,
      canonicalId,
      ctx,
      accountId,
    );

    // 3. Engaged-audience demographics (4 more).
    const engaged = await this.fetchDemographics(
      'engaged_audience_demographics',
      accessToken,
      canonicalId,
      ctx,
      accountId,
    );

    // 4. Account-level daily totals + follower-count time series (2 calls).
    const accountInsights = await this.fetchAccountInsights(
      accessToken,
      canonicalId,
      ctx,
      accountId,
    );

    return {
      genderDistribution: follower.genderDistribution ?? [],
      ageDistribution: follower.ageDistribution ?? [],
      countryDistribution: follower.countryDistribution ?? [],
      cityDistribution: follower.cityDistribution ?? [],
      reachedDemographics: reached,
      engagedDemographics: engaged,
      accountInsights,
      fetchedAt: new Date(),
    };
  }

  private async fetchDemographics(
    metric: string,
    accessToken: string,
    canonicalId: string,
    context: PlatformAdapterContext,
    accountId: bigint | undefined,
  ): Promise<DemographicDistributions> {
    const breakdowns: Array<'age' | 'gender' | 'country' | 'city'> = [
      'age',
      'gender',
      'country',
      'city',
    ];
    const out: DemographicDistributions = {};
    const errors: NonNullable<DemographicDistributions['errors']> = [];
    // `follower_demographics` is lifetime-snapshot and rejects `timeframe`.
    // `reached_audience_demographics` and `engaged_audience_demographics`
    // are derived over a window and REQUIRE `timeframe` (Graph error #100
    // otherwise). v20+ retired last_14_days / last_30_days / last_90_days;
    // current valid values are `this_week`, `this_month`, `prev_month`.
    const needsTimeframe = metric !== 'follower_demographics';
    for (const breakdown of breakdowns) {
      try {
        const body = await this.client.call<{ data?: GraphInsight[] }>({
          endpoint: `/${canonicalId}/insights`,
          params: {
            metric,
            period: 'lifetime',
            metric_type: 'total_value',
            breakdown,
            ...(needsTimeframe ? { timeframe: 'this_month' } : {}),
          },
          accessToken,
          context,
          accountId,
        });
        const buckets = parseFollowerDemographics(body.data ?? []);
        if (breakdown === 'age') out.ageDistribution = buckets;
        else if (breakdown === 'gender') out.genderDistribution = buckets;
        else if (breakdown === 'country') out.countryDistribution = buckets;
        else if (breakdown === 'city') out.cityDistribution = buckets;
      } catch (err) {
        const detail = extractGraphError(err);
        this.logger.debug(
          `${metric} breakdown=${breakdown} failed: ${detail.message}`,
        );
        errors.push({ breakdown, ...detail });
      }
    }
    if (errors.length > 0) out.errors = errors;
    return out;
  }

  /**
   * Account-level insights — daily totals over 28 days plus the
   * follower_count time series. Returns a partial shape; missing metrics
   * (e.g. because a CTA isn't configured) are simply absent.
   */
  private async fetchAccountInsights(
    accessToken: string,
    canonicalId: string,
    context: PlatformAdapterContext,
    accountId: bigint | undefined,
  ): Promise<AccountInsightsData> {
    const PERIOD_DAYS = 28;
    const until = Math.floor(Date.now() / 1000);
    const since = until - PERIOD_DAYS * 86_400;

    const out: AccountInsightsData = { periodDays: PERIOD_DAYS };
    const extra: Record<string, number> = {};

    // Totals with metric_type=total_value (single call with the whole list).
    // Meta rejects the entire batch if any metric is invalid for the v22
    // account-level endpoint, so this list must match the documented set.
    // Removed in v22 (caused #100 metric[i] errors): impressions,
    // email_contacts, phone_call_clicks, text_message_clicks,
    // get_directions_clicks. Use `profile_links_taps` (broken-down by
    // contact button type via `breakdown=contact_button_type`) if those
    // CTA-click totals come back into scope.
    const totalMetrics = [
      'reach',
      'accounts_engaged',
      'total_interactions',
      'likes',
      'comments',
      'saves',
      'shares',
      'replies',
      'views',
      'profile_views',
      'website_clicks',
    ];
    try {
      const body = await this.client.call<{
        data?: Array<{ name: string; total_value?: { value: number } }>;
      }>({
        endpoint: `/${canonicalId}/insights`,
        params: {
          metric: totalMetrics.join(','),
          period: 'day',
          metric_type: 'total_value',
          since,
          until,
        },
        accessToken,
        context,
        accountId,
      });

      for (const entry of body.data ?? []) {
        const v = entry.total_value?.value;
        if (typeof v !== 'number') continue;
        switch (entry.name) {
          case 'reach':
            out.reach = v;
            break;
          case 'impressions':
            out.impressions = v;
            break;
          case 'accounts_engaged':
            out.accountsEngaged = v;
            break;
          case 'total_interactions':
            out.totalInteractions = v;
            break;
          case 'likes':
            out.likes = v;
            break;
          case 'comments':
            out.comments = v;
            break;
          case 'saves':
            out.saves = v;
            break;
          case 'shares':
            out.shares = v;
            break;
          case 'replies':
            out.replies = v;
            break;
          case 'views':
            out.views = v;
            break;
          case 'profile_views':
            out.profileViews = v;
            break;
          case 'website_clicks':
            out.websiteClicks = v;
            break;
          case 'email_contacts':
            out.emailContacts = v;
            break;
          case 'phone_call_clicks':
            out.phoneCallClicks = v;
            break;
          case 'text_message_clicks':
            out.textMessageClicks = v;
            break;
          case 'get_directions_clicks':
            out.getDirectionsClicks = v;
            break;
          default:
            extra[entry.name] = v;
        }
      }
    } catch (err) {
      this.logger.debug(
        `account total_value insights failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Follower-count time series (period=day, no metric_type).
    try {
      const body = await this.client.call<{
        data?: Array<{
          name: string;
          values?: Array<{ value: unknown; end_time?: string }>;
        }>;
      }>({
        endpoint: `/${canonicalId}/insights`,
        params: {
          metric: 'follower_count',
          period: 'day',
          since,
          until,
        },
        accessToken,
        context,
        accountId,
      });
      const entry = (body.data ?? []).find((d) => d.name === 'follower_count');
      if (entry) {
        out.followerCountSeries = (entry.values ?? [])
          .filter((v) => typeof v.value === 'number' && !!v.end_time)
          .map((v) => ({ endTime: v.end_time as string, value: v.value as number }));
      }
    } catch (err) {
      this.logger.debug(
        `follower_count series failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // online_followers — when followers are online, by hour. Drives the
    // "best time to post" heatmap on the dashboard. Returns a values[]
    // entry per day where `value` is a `{ "0": n, "1": n, ..., "23": n }`
    // map. We aggregate (sum) across all days so the period total drops
    // into a 24-bucket array.
    try {
      const body = await this.client.call<{
        data?: Array<{
          name: string;
          values?: Array<{ value: unknown }>;
        }>;
      }>({
        endpoint: `/${canonicalId}/insights`,
        params: {
          metric: 'online_followers',
          period: 'lifetime',
          since,
          until,
        },
        accessToken,
        context,
        accountId,
      });
      const entry = (body.data ?? []).find((d) => d.name === 'online_followers');
      if (entry) {
        // Two parallel accumulators: a flat 24-bucket total (legacy) and a
        // 7×24 grid keyed by JS `Date.getUTCDay()` (0=Sunday … 6=Saturday).
        // The end_time on each value entry tells us which weekday that day's
        // map belongs to, so we can split a Tuesday peak from a Sunday peak.
        const totals = new Array<number>(24).fill(0);
        const weekly: number[][] = Array.from({ length: 7 }, () =>
          new Array<number>(24).fill(0),
        );
        for (const v of (entry.values ?? []) as Array<{
          value?: unknown;
          end_time?: string;
        }>) {
          if (!v.value || typeof v.value !== 'object') continue;
          const dow =
            typeof v.end_time === 'string'
              ? new Date(v.end_time).getUTCDay()
              : NaN;
          for (const [hourStr, raw] of Object.entries(
            v.value as Record<string, unknown>,
          )) {
            const hour = Number(hourStr);
            if (!Number.isFinite(hour) || hour < 0 || hour > 23) continue;
            if (typeof raw !== 'number') continue;
            totals[hour] += raw;
            if (Number.isFinite(dow) && dow >= 0 && dow <= 6) {
              weekly[dow][hour] += raw;
            }
          }
        }
        if (totals.some((n) => n > 0)) {
          out.audienceActivity = totals.map((count, hour) => ({ hour, count }));
        }
        const weeklyFlat: Array<{ dayOfWeek: number; hour: number; count: number }> = [];
        for (let dow = 0; dow < 7; dow++) {
          for (let hour = 0; hour < 24; hour++) {
            const c = weekly[dow][hour];
            if (c > 0) weeklyFlat.push({ dayOfWeek: dow, hour, count: c });
          }
        }
        if (weeklyFlat.length > 0) out.audienceActivityWeekly = weeklyFlat;
      }
    } catch (err) {
      this.logger.debug(
        `online_followers failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // profile_links_taps — clicks on the contact buttons on the IG profile,
    // broken down by which button (CALL / TEXT / EMAIL / DIRECTIONS / WEBSITE).
    // Replaces the old per-button scalar metrics that v22 removed.
    try {
      const body = await this.client.call<{
        data?: Array<{
          name: string;
          total_value?: {
            value?: number;
            breakdowns?: Array<{
              results?: Array<{
                dimension_values?: string[];
                value?: number;
              }>;
            }>;
          };
        }>;
      }>({
        endpoint: `/${canonicalId}/insights`,
        params: {
          metric: 'profile_links_taps',
          period: 'day',
          metric_type: 'total_value',
          breakdown: 'contact_button_type',
          since,
          until,
        },
        accessToken,
        context,
        accountId,
      });
      const entry = (body.data ?? []).find(
        (d) => d.name === 'profile_links_taps',
      );
      const tv = entry?.total_value;
      if (typeof tv?.value === 'number') {
        extra.profile_links_taps_total = tv.value;
      }
      for (const bd of tv?.breakdowns ?? []) {
        for (const row of bd.results ?? []) {
          const button = row.dimension_values?.[0];
          if (!button || typeof row.value !== 'number') continue;
          // e.g. profile_links_taps_call, ..._email, ..._directions
          extra[`profile_links_taps_${button.toLowerCase()}`] = row.value;
        }
      }
    } catch (err) {
      this.logger.debug(
        `profile_links_taps failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (Object.keys(extra).length > 0) out.extra = extra;
    return out;
  }
}
