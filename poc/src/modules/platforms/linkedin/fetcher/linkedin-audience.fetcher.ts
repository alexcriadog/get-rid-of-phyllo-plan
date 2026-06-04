// LinkedIn audience fetcher — analytics aggregates, no demographics.
//
// Member (~11 calls): memberFollowersCount q=me + q=dateRange(30d), then
//   memberCreatorPostAnalytics one call PER metric per aggregation:
//   5× TOTAL + 4× DAILY (DAILY unsupported for MEMBERS_REACHED).
//   Every metric is best-effort — partial results beat a failed sync.
// Organization (1 call): organizationalEntityFollowerStatistics
//   timeIntervals daily gains.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AudienceData } from '../../shared/platform-types';
import type {
  BoundLinkedInClient,
  LinkedInCallContext,
} from '../../shared/linkedin-api/linkedin-client';
import type {
  LinkedInDateRange,
  LinkedInMemberAnalyticsElement,
} from '../../shared/linkedin-api/linkedin-types';
import { extractAccountId } from '../../shared/meta-graph';
import {
  buildLinkedInContext,
  linkedInKind,
  organizationUrn,
} from '../linkedin.context';
import {
  ANALYTICS_PERIOD_DAYS,
  MEMBER_METRICS_DAILY,
  MEMBER_METRICS_TOTAL,
} from '../linkedin.constants';
import {
  buildMemberAudience,
  buildOrgAudience,
  type SimpleSeriesPoint,
} from '../mapper/linkedin-analytics.mapper';
import { LINKEDIN_API_CLIENT } from '../linkedin.tokens';

@Injectable()
export class LinkedInAudienceFetcher {
  private readonly logger = new Logger(LinkedInAudienceFetcher.name);

  constructor(
    @Inject(LINKEDIN_API_CLIENT)
    private readonly client: BoundLinkedInClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AudienceData> {
    const accountId = extractAccountId(metadata);
    const ctx = buildLinkedInContext(accessToken, canonicalId);
    const callCtx: LinkedInCallContext = {
      accessToken,
      context: ctx,
      accountId,
    };

    if (linkedInKind(metadata) === 'organization') {
      return this.fetchOrg(callCtx, canonicalId, metadata);
    }
    return this.fetchMember(callCtx, canonicalId);
  }

  private async fetchMember(
    callCtx: LinkedInCallContext,
    canonicalId: string,
  ): Promise<AudienceData> {
    const end = new Date();
    const start = new Date(end.getTime() - ANALYTICS_PERIOD_DAYS * 86_400_000);

    const lifetimeFollowers = await this.client
      .getMemberFollowersCount(callCtx)
      .then((r) => {
        const v = r.elements?.[0]?.memberFollowersCount;
        return typeof v === 'number' ? v : null;
      })
      .catch((err) => {
        this.warn('memberFollowersCount(me)', canonicalId, err);
        return null;
      });

    const followersDaily = await this.client
      .getMemberFollowersDaily({ ...callCtx, start, end })
      .then((r) =>
        (r.elements ?? [])
          .filter((e) => typeof e.memberFollowersCount === 'number')
          .map((e) => ({
            date: dateOf(e.dateRange),
            value: e.memberFollowersCount as number,
          }))
          .filter((p) => p.date !== ''),
      )
      .catch((err) => {
        this.warn('memberFollowersCount(dateRange)', canonicalId, err);
        return [] as SimpleSeriesPoint[];
      });

    const totals: Record<string, number> = {};
    for (const metric of MEMBER_METRICS_TOTAL) {
      const value = await this.client
        .getMemberPostAnalytics({
          ...callCtx,
          queryType: metric,
          aggregation: 'TOTAL',
          start,
          end,
        })
        .then((r) => sumCounts(r.elements))
        .catch((err) => {
          this.warn(`postAnalytics(${metric},TOTAL)`, canonicalId, err);
          return null;
        });
      if (value != null) totals[metric] = value;
    }

    const daily: Record<string, SimpleSeriesPoint[]> = {};
    for (const metric of MEMBER_METRICS_DAILY) {
      const series = await this.client
        .getMemberPostAnalytics({
          ...callCtx,
          queryType: metric,
          aggregation: 'DAILY',
          start,
          end,
        })
        .then((r) =>
          (r.elements ?? [])
            .filter((e) => typeof e.count === 'number')
            .map((e) => ({
              date: dateOf(e.dateRange),
              value: e.count as number,
            }))
            .filter((p) => p.date !== ''),
        )
        .catch((err) => {
          this.warn(`postAnalytics(${metric},DAILY)`, canonicalId, err);
          return [] as SimpleSeriesPoint[];
        });
      daily[metric] = series;
    }

    return buildMemberAudience({
      periodDays: ANALYTICS_PERIOD_DAYS,
      lifetimeFollowers,
      followersDaily,
      totals,
      daily,
    });
  }

  private async fetchOrg(
    callCtx: LinkedInCallContext,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AudienceData> {
    const orgUrn = organizationUrn(canonicalId, metadata);
    const endMs = Date.now();
    const startMs = endMs - ANALYTICS_PERIOD_DAYS * 86_400_000;

    const gains = await this.client
      .getOrganizationFollowerGains({ ...callCtx, orgUrn, startMs, endMs })
      .then((r) =>
        (r.elements ?? [])
          .filter((e) => e.timeRange?.start != null)
          .map((e) => ({
            date: new Date(e.timeRange?.start as number)
              .toISOString()
              .slice(0, 10),
            organic: e.followerGains?.organicFollowerGain ?? 0,
            paid: e.followerGains?.paidFollowerGain ?? 0,
          })),
      )
      .catch((err) => {
        this.warn('orgFollowerGains', orgUrn, err);
        return [];
      });

    return buildOrgAudience({
      periodDays: ANALYTICS_PERIOD_DAYS,
      followerGainsDaily: gains,
    });
  }

  private warn(what: string, id: string, err: unknown): void {
    this.logger.warn(
      `${what} failed for ${id}: ${
        err instanceof Error ? err.message : String(err)
      } — partial audience snapshot`,
    );
  }
}

function dateOf(range: LinkedInDateRange | undefined): string {
  const s = range?.start;
  if (!s) return '';
  const mm = String(s.month).padStart(2, '0');
  const dd = String(s.day).padStart(2, '0');
  return `${s.year}-${mm}-${dd}`;
}

function sumCounts(
  elements: LinkedInMemberAnalyticsElement[] | undefined,
): number | null {
  if (!elements || elements.length === 0) return null;
  let sum = 0;
  let any = false;
  for (const e of elements) {
    if (typeof e.count === 'number') {
      sum += e.count;
      any = true;
    }
  }
  return any ? sum : null;
}
