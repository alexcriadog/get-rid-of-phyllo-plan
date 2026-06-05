// memberFollowersCount + memberCreatorPostAnalytics → canonical AudienceData,
// and the org analytics bundle (follower demographics + share-stats aggregate
// + page statistics + follower gains) → canonical AudienceData.
//
// Member: LinkedIn exposes NO follower demographics for members, so the
// distribution arrays stay empty and everything lands in accountInsights:
//   - followerCountSeries ← memberFollowersCount?q=dateRange (daily)
//   - views/likes/comments/shares/reach/saves/profileViews ← per-metric TOTALs
//     (saves ← POST_SAVE, profileViews ← PROFILE_VIEW_FROM_CONTENT; metrics
//     without a canonical slot land in extra: linkClicks, postSends,
//     premiumCtaClicks, followersFromContent)
//   - daily IMPRESSION series → videoViewsSeries (documented trade-off:
//     the only "views per day" slot in the canonical shape).
//
// Org: follower demographics fill the canonical country distribution plus
// the professional-graph facets (industry/seniority/function/companySize);
// page-visitor countries land in reachedDemographics; org-level share
// statistics fill the engagement totals + daily series; page views map to
// profileViews(+Series) — "people who viewed the page" ≈ profile views.

import type {
  AudienceData,
  DailySeriesPoint,
  DistributionBucket,
} from '../../shared/platform-types';

export interface SimpleSeriesPoint {
  /** YYYY-MM-DD */
  date: string;
  value: number;
}

type MemberMetric =
  | 'IMPRESSION'
  | 'REACTION'
  | 'COMMENT'
  | 'RESHARE'
  | 'MEMBERS_REACHED'
  | 'POST_SAVE'
  | 'POST_SEND'
  | 'LINK_CLICKS'
  | 'PREMIUM_CTA_CLICKS'
  | 'FOLLOWER_GAINED_FROM_CONTENT'
  | 'PROFILE_VIEW_FROM_CONTENT';

export interface MemberAudienceSource {
  periodDays: number;
  lifetimeFollowers: number | null;
  followersDaily: SimpleSeriesPoint[];
  totals: Partial<Record<MemberMetric, number>>;
  daily: Partial<
    Record<'IMPRESSION' | 'REACTION' | 'COMMENT' | 'RESHARE', SimpleSeriesPoint[]>
  >;
}

function toSeries(
  points: SimpleSeriesPoint[] | undefined,
): DailySeriesPoint[] | undefined {
  if (!points || points.length === 0) return undefined;
  return points.map((p) => ({ endTime: p.date, value: p.value }));
}

export function buildMemberAudience(src: MemberAudienceSource): AudienceData {
  const extra: Record<string, number> = {};
  if (src.lifetimeFollowers != null) {
    extra['lifetimeFollowers'] = src.lifetimeFollowers;
  }
  if (src.totals.LINK_CLICKS != null) extra['linkClicks'] = src.totals.LINK_CLICKS;
  if (src.totals.POST_SEND != null) extra['postSends'] = src.totals.POST_SEND;
  if (src.totals.PREMIUM_CTA_CLICKS != null)
    extra['premiumCtaClicks'] = src.totals.PREMIUM_CTA_CLICKS;
  if (src.totals.FOLLOWER_GAINED_FROM_CONTENT != null)
    extra['followersFromContent'] = src.totals.FOLLOWER_GAINED_FROM_CONTENT;

  return {
    genderDistribution: [],
    ageDistribution: [],
    countryDistribution: [],
    cityDistribution: [],
    accountInsights: {
      periodDays: src.periodDays,
      views: src.totals.IMPRESSION,
      likes: src.totals.REACTION,
      comments: src.totals.COMMENT,
      shares: src.totals.RESHARE,
      reach: src.totals.MEMBERS_REACHED,
      saves: src.totals.POST_SAVE,
      profileViews: src.totals.PROFILE_VIEW_FROM_CONTENT,
      followerCountSeries: toSeries(src.followersDaily),
      videoViewsSeries: toSeries(src.daily.IMPRESSION),
      likesSeries: toSeries(src.daily.REACTION),
      commentsSeries: toSeries(src.daily.COMMENT),
      sharesSeries: toSeries(src.daily.RESHARE),
      ...(Object.keys(extra).length > 0 ? { extra } : {}),
    },
    fetchedAt: new Date(),
  };
}

export interface OrgDemographics {
  country?: DistributionBucket[];
  industry?: DistributionBucket[];
  seniority?: DistributionBucket[];
  function?: DistributionBucket[];
  companySize?: DistributionBucket[];
}

export interface OrgAudienceSource {
  periodDays: number;
  followerGainsDaily: Array<{ date: string; organic: number; paid: number }>;
  demographics?: OrgDemographics;
  engagementTotals?: {
    views?: number;
    reach?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    clicks?: number;
    engagementRate?: number;
  };
  engagementDaily?: Partial<
    Record<'IMPRESSION' | 'REACTION' | 'COMMENT' | 'RESHARE', SimpleSeriesPoint[]>
  >;
  pageViews?: {
    total?: number;
    desktop?: number;
    mobile?: number;
    daily?: SimpleSeriesPoint[];
    visitorCountries?: DistributionBucket[];
  };
}

export function buildOrgAudience(src: OrgAudienceSource): AudienceData {
  const extra: Record<string, number> = {};
  if (src.engagementTotals?.clicks != null)
    extra['clicks'] = src.engagementTotals.clicks;
  if (src.engagementTotals?.engagementRate != null)
    extra['engagementRate'] = src.engagementTotals.engagementRate;
  if (src.pageViews?.desktop != null)
    extra['desktopPageViews'] = src.pageViews.desktop;
  if (src.pageViews?.mobile != null)
    extra['mobilePageViews'] = src.pageViews.mobile;

  return {
    genderDistribution: [],
    ageDistribution: [],
    countryDistribution: src.demographics?.country ?? [],
    cityDistribution: [],
    ...(src.demographics?.industry
      ? { industryDistribution: src.demographics.industry }
      : {}),
    ...(src.demographics?.seniority
      ? { seniorityDistribution: src.demographics.seniority }
      : {}),
    ...(src.demographics?.function
      ? { functionDistribution: src.demographics.function }
      : {}),
    ...(src.demographics?.companySize
      ? { companySizeDistribution: src.demographics.companySize }
      : {}),
    ...(src.pageViews?.visitorCountries?.length
      ? {
          reachedDemographics: {
            countryDistribution: src.pageViews.visitorCountries,
          },
        }
      : {}),
    accountInsights: {
      periodDays: src.periodDays,
      views: src.engagementTotals?.views,
      reach: src.engagementTotals?.reach,
      likes: src.engagementTotals?.likes,
      comments: src.engagementTotals?.comments,
      shares: src.engagementTotals?.shares,
      profileViews: src.pageViews?.total,
      profileViewsSeries: toSeries(src.pageViews?.daily),
      videoViewsSeries: toSeries(src.engagementDaily?.IMPRESSION),
      likesSeries: toSeries(src.engagementDaily?.REACTION),
      commentsSeries: toSeries(src.engagementDaily?.COMMENT),
      sharesSeries: toSeries(src.engagementDaily?.RESHARE),
      newFollowersSeries: src.followerGainsDaily.length
        ? src.followerGainsDaily.map((p) => ({
            endTime: p.date,
            value: p.organic + p.paid,
          }))
        : undefined,
      ...(Object.keys(extra).length > 0 ? { extra } : {}),
    },
    fetchedAt: new Date(),
  };
}
