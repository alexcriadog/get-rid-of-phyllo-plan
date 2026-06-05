// LinkedIn audience fetcher — analytics aggregates + org demographics.
//
// Member (~17 calls): memberFollowersCount q=me + q=dateRange(30d), then
//   memberCreatorPostAnalytics one call PER metric per aggregation:
//   11× TOTAL + 4× DAILY (DAILY unsupported for the rest).
// Organization (~8-13 calls): follower gains (timeIntervals) + lifetime
//   follower demographics (7 facets, URNs decoded via standardized data) +
//   org-level share statistics (lifetime aggregate + daily series) + page
//   statistics (lifetime facets + daily series).
//
// Every call is best-effort — partial snapshots beat failed syncs. BUT if
// EVERY sub-call failed (typical when the Redis rate bucket is empty), the
// fetcher rethrows the last error instead of returning an empty snapshot:
// the worker then backs off and the previous (good) Mongo snapshot survives.
// Learned in prod 2026-06-05 — an all-denied sync upserted an empty audience
// snapshot over the populated one and blanked the dashboard.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AudienceData,
  DistributionBucket,
} from '../../shared/platform-types';
import type {
  BoundLinkedInClient,
  LinkedInCallContext,
} from '../../shared/linkedin-api/linkedin-client';
import type {
  LinkedInDateRange,
  LinkedInFollowerDemographicsElement,
  LinkedInMemberAnalyticsElement,
  LinkedInStandardizedEntity,
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
  type OrgAudienceSource,
  type OrgDemographics,
  type SimpleSeriesPoint,
} from '../mapper/linkedin-analytics.mapper';
import { LINKEDIN_API_CLIENT } from '../linkedin.tokens';

const TOP_BUCKETS = 25;

type FacetCollection = 'industries' | 'functions' | 'seniorities' | 'geo';

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

  // ─── member ──────────────────────────────────────────────────────────────

  private async fetchMember(
    callCtx: LinkedInCallContext,
    canonicalId: string,
  ): Promise<AudienceData> {
    const end = new Date();
    const start = new Date(end.getTime() - ANALYTICS_PERIOD_DAYS * 86_400_000);
    let okCalls = 0;
    let lastErr: unknown = null;

    const lifetimeFollowers = await this.client
      .getMemberFollowersCount(callCtx)
      .then((r) => {
        okCalls += 1;
        const v = r.elements?.[0]?.memberFollowersCount;
        return typeof v === 'number' ? v : null;
      })
      .catch((err) => {
        lastErr = err;
        this.warn('memberFollowersCount(me)', canonicalId, err);
        return null;
      });

    const followersDaily = await this.client
      .getMemberFollowersDaily({ ...callCtx, start, end })
      .then((r) => {
        okCalls += 1;
        return (r.elements ?? [])
          .filter((e) => typeof e.memberFollowersCount === 'number')
          .map((e) => ({
            date: dateOf(e.dateRange),
            value: e.memberFollowersCount as number,
          }))
          .filter((p) => p.date !== '');
      })
      .catch((err) => {
        lastErr = err;
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
        .then((r) => {
          okCalls += 1;
          return sumCounts(r.elements);
        })
        .catch((err) => {
          lastErr = err;
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
        .then((r) => {
          okCalls += 1;
          return (r.elements ?? [])
            .filter((e) => typeof e.count === 'number')
            .map((e) => ({
              date: dateOf(e.dateRange),
              value: e.count as number,
            }))
            .filter((p) => p.date !== '');
        })
        .catch((err) => {
          lastErr = err;
          this.warn(`postAnalytics(${metric},DAILY)`, canonicalId, err);
          return [] as SimpleSeriesPoint[];
        });
      daily[metric] = series;
    }

    if (okCalls === 0 && lastErr) {
      // Nothing succeeded — back off rather than blank the stored snapshot.
      throw lastErr;
    }

    return buildMemberAudience({
      periodDays: ANALYTICS_PERIOD_DAYS,
      lifetimeFollowers,
      followersDaily,
      totals,
      daily,
    });
  }

  // ─── organization ────────────────────────────────────────────────────────

  private async fetchOrg(
    callCtx: LinkedInCallContext,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AudienceData> {
    const orgUrn = organizationUrn(canonicalId, metadata);
    const endMs = Date.now();
    const startMs = endMs - ANALYTICS_PERIOD_DAYS * 86_400_000;
    let okCalls = 0;
    let lastErr: unknown = null;

    const gains = await this.client
      .getOrganizationFollowerGains({ ...callCtx, orgUrn, startMs, endMs })
      .then((r) => {
        okCalls += 1;
        return (r.elements ?? [])
          .filter((e) => e.timeRange?.start != null)
          .map((e) => ({
            date: dayOfMs(e.timeRange?.start as number),
            organic: e.followerGains?.organicFollowerGain ?? 0,
            paid: e.followerGains?.paidFollowerGain ?? 0,
          }));
      })
      .catch((err) => {
        lastErr = err;
        this.warn('orgFollowerGains', orgUrn, err);
        return [];
      });

    const demographics = await this.fetchOrgDemographics(callCtx, orgUrn);
    if (demographics) okCalls += 1;

    // Org-level engagement — lifetime aggregate (totals) + daily series.
    const src: OrgAudienceSource = {
      periodDays: ANALYTICS_PERIOD_DAYS,
      followerGainsDaily: gains,
      demographics,
    };

    await this.client
      .getShareStatisticsAggregate({ ...callCtx, orgUrn })
      .then((r) => {
        okCalls += 1;
        const t = r.elements?.[0]?.totalShareStatistics;
        if (!t) return;
        src.engagementTotals = {
          views: t.impressionCount,
          reach: t.uniqueImpressionsCount,
          likes: t.likeCount,
          comments: t.commentCount,
          shares: t.shareCount,
          clicks: t.clickCount,
          engagementRate: t.engagement,
        };
      })
      .catch((err) => {
        lastErr = err;
        this.warn('shareStats(lifetime)', orgUrn, err);
      });

    await this.client
      .getShareStatisticsAggregate({ ...callCtx, orgUrn, startMs, endMs })
      .then((r) => {
        okCalls += 1;
        const daily: NonNullable<OrgAudienceSource['engagementDaily']> = {
          IMPRESSION: [],
          REACTION: [],
          COMMENT: [],
          RESHARE: [],
        };
        for (const e of r.elements ?? []) {
          const t = e.totalShareStatistics;
          const startTime = e.timeRange?.start;
          if (!t || startTime == null) continue;
          const date = dayOfMs(startTime);
          if (typeof t.impressionCount === 'number')
            daily.IMPRESSION!.push({ date, value: t.impressionCount });
          if (typeof t.likeCount === 'number')
            daily.REACTION!.push({ date, value: t.likeCount });
          if (typeof t.commentCount === 'number')
            daily.COMMENT!.push({ date, value: t.commentCount });
          if (typeof t.shareCount === 'number')
            daily.RESHARE!.push({ date, value: t.shareCount });
        }
        src.engagementDaily = daily;
      })
      .catch((err) => {
        lastErr = err;
        this.warn('shareStats(daily)', orgUrn, err);
      });

    // Page statistics — lifetime facets + daily views series.
    await this.client
      .getOrganizationPageStatistics({ ...callCtx, orgUrn })
      .then(async (r) => {
        okCalls += 1;
        const el = r.elements?.[0];
        if (!el) return;
        const views = el.totalPageStatistics?.views;
        src.pageViews = {
          total: views?.allPageViews?.pageViews,
          desktop: views?.allDesktopPageViews?.pageViews,
          mobile: views?.allMobilePageViews?.pageViews,
        };
        // Visitor demographics — the 5 facets of the Page admin card
        // (Location / Industry / Seniority / Job function / Company size),
        // all carried in this same lifetime response.
        const visitorFacet = async (
          rows:
            | Array<
                {
                  pageStatistics?: {
                    views?: { allPageViews?: { pageViews?: number } };
                  };
                } & Record<string, unknown>
              >
            | undefined,
          keyField: string,
          collection: FacetCollection | null,
        ): Promise<DistributionBucket[] | undefined> => {
          const items = (rows ?? [])
            .map((r) => ({
              key:
                typeof r[keyField] === 'string' ? (r[keyField] as string) : '',
              value: r.pageStatistics?.views?.allPageViews?.pageViews ?? 0,
            }))
            .filter((r) => r.key && r.value > 0);
          if (items.length === 0) return undefined;
          let names = new Map<string, string>();
          if (collection) {
            names = await this.decodeNames(
              callCtx,
              collection,
              items.map((i) => i.key),
            );
          }
          return toBuckets(
            items.map((i) => ({
              label: names.get(i.key) ?? urnTail(i.key),
              value: i.value,
            })),
          );
        };

        src.pageViews.visitorCountries = await visitorFacet(
          el.pageStatisticsByGeoCountry,
          'geo',
          'geo',
        );
        src.pageViews.visitorIndustries = await visitorFacet(
          el.pageStatisticsByIndustryV2,
          'industryV2',
          'industries',
        );
        src.pageViews.visitorSeniorities = await visitorFacet(
          el.pageStatisticsBySeniority,
          'seniority',
          'seniorities',
        );
        src.pageViews.visitorFunctions = await visitorFacet(
          el.pageStatisticsByFunction,
          'function',
          'functions',
        );
        src.pageViews.visitorCompanySizes = await visitorFacet(
          el.pageStatisticsByStaffCountRange,
          'staffCountRange',
          null,
        );
      })
      .catch((err) => {
        lastErr = err;
        this.warn('pageStats(lifetime)', orgUrn, err);
      });

    await this.client
      .getOrganizationPageStatistics({ ...callCtx, orgUrn, startMs, endMs })
      .then((r) => {
        okCalls += 1;
        const daily = (r.elements ?? [])
          .filter((e) => e.timeRange?.start != null)
          .map((e) => ({
            date: dayOfMs(e.timeRange?.start as number),
            value: e.totalPageStatistics?.views?.allPageViews?.pageViews ?? 0,
          }));
        if (daily.length > 0) {
          src.pageViews = { ...(src.pageViews ?? {}), daily };
        }
      })
      .catch((err) => {
        lastErr = err;
        this.warn('pageStats(daily)', orgUrn, err);
      });

    if (okCalls === 0 && lastErr) {
      // Nothing succeeded — back off rather than blank the stored snapshot.
      throw lastErr;
    }

    return buildOrgAudience(src);
  }

  /** Lifetime follower demographics, URNs decoded to display names. */
  private async fetchOrgDemographics(
    callCtx: LinkedInCallContext,
    orgUrn: string,
  ): Promise<OrgDemographics | undefined> {
    let el: LinkedInFollowerDemographicsElement | undefined;
    try {
      const res = await this.client.getOrganizationFollowerDemographics({
        ...callCtx,
        orgUrn,
      });
      el = res.elements?.[0];
    } catch (err) {
      this.warn('followerDemographics', orgUrn, err);
      return undefined;
    }
    if (!el) return undefined;

    const facet = async (
      rows:
        | Array<
            { followerCounts?: { organicFollowerCount?: number } } & Record<
              string,
              unknown
            >
          >
        | undefined,
      urnField: string,
      collection: FacetCollection | null,
    ): Promise<DistributionBucket[] | undefined> => {
      const items = (rows ?? [])
        .map((r) => ({
          key: typeof r[urnField] === 'string' ? (r[urnField] as string) : '',
          value: r.followerCounts?.organicFollowerCount ?? 0,
        }))
        .filter((r) => r.key && r.value > 0);
      if (items.length === 0) return undefined;
      let names = new Map<string, string>();
      if (collection) {
        names = await this.decodeNames(
          callCtx,
          collection,
          items.map((i) => i.key),
        );
      }
      return toBuckets(
        items.map((i) => ({
          label: names.get(i.key) ?? urnTail(i.key),
          value: i.value,
        })),
      );
    };

    return {
      country: await facet(el.followerCountsByGeoCountry, 'geo', 'geo'),
      industry: await facet(
        el.followerCountsByIndustry,
        'industry',
        'industries',
      ),
      seniority: await facet(
        el.followerCountsBySeniority,
        'seniority',
        'seniorities',
      ),
      function: await facet(
        el.followerCountsByFunction,
        'function',
        'functions',
      ),
      // Enum strings, no decoration needed.
      companySize: await facet(
        el.followerCountsByStaffCountRange,
        'staffCountRange',
        null,
      ),
    };
  }

  /** Decode standardized-data URNs → display names. Best-effort. */
  private async decodeNames(
    callCtx: LinkedInCallContext,
    collection: FacetCollection,
    urns: string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const ids = [...new Set(urns.map(urnTail))].filter(Boolean);
    if (ids.length === 0) return out;
    try {
      const res = await this.client.getStandardizedNames({
        ...callCtx,
        collection,
        ids,
      });
      for (const [id, entity] of Object.entries(res.results ?? {})) {
        const name = entityName(entity);
        if (!name) continue;
        // Key back by full URN for caller convenience.
        for (const urn of urns) {
          if (urnTail(urn) === id) out.set(urn, name);
        }
      }
    } catch (err) {
      this.warn(`decode(${collection})`, ids.join(','), err);
    }
    return out;
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

function dayOfMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function urnTail(urn: string): string {
  return urn.split(':').pop() ?? urn;
}

function entityName(e: LinkedInStandardizedEntity): string | null {
  if (e.localizedName) return e.localizedName;
  if (e.defaultLocalizedName?.value) return e.defaultLocalizedName.value;
  const localized = e.name?.localized;
  if (localized) {
    const first = Object.values(localized)[0];
    if (typeof first === 'string') return first;
  }
  return null;
}

function toBuckets(
  items: Array<{ label: string; value: number }>,
): DistributionBucket[] {
  return items
    .sort((a, b) => b.value - a.value)
    .slice(0, TOP_BUCKETS)
    .map((i) => ({ label: i.label, value: i.value, unit: 'count' as const }));
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
