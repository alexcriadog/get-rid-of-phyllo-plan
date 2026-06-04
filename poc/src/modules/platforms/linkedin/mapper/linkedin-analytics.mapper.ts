// memberFollowersCount + memberCreatorPostAnalytics → canonical AudienceData,
// and organizationalEntityFollowerStatistics → canonical AudienceData.
//
// LinkedIn exposes NO follower demographics for members, so the four
// distribution arrays stay empty and everything lands in accountInsights:
//   - followerCountSeries ← memberFollowersCount?q=dateRange (daily)
//   - views/likes/comments/shares/reach ← per-metric TOTAL calls
//   - likesSeries/commentsSeries/sharesSeries ← per-metric DAILY calls
//   - daily IMPRESSION series → videoViewsSeries. Documented trade-off:
//     AccountInsightsData has no generic daily views-series field and
//     videoViewsSeries is the only "views per day" slot in the canonical
//     shape. The admin UI labels it "views".

import type {
  AudienceData,
  DailySeriesPoint,
} from '../../shared/platform-types';

export interface SimpleSeriesPoint {
  /** YYYY-MM-DD */
  date: string;
  value: number;
}

export interface MemberAudienceSource {
  periodDays: number;
  lifetimeFollowers: number | null;
  followersDaily: SimpleSeriesPoint[];
  totals: Partial<
    Record<
      'IMPRESSION' | 'REACTION' | 'COMMENT' | 'RESHARE' | 'MEMBERS_REACHED',
      number
    >
  >;
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

export interface OrgAudienceSource {
  periodDays: number;
  followerGainsDaily: Array<{ date: string; organic: number; paid: number }>;
}

export function buildOrgAudience(src: OrgAudienceSource): AudienceData {
  return {
    genderDistribution: [],
    ageDistribution: [],
    countryDistribution: [],
    cityDistribution: [],
    accountInsights: {
      periodDays: src.periodDays,
      newFollowersSeries: src.followerGainsDaily.length
        ? src.followerGainsDaily.map((p) => ({
            endTime: p.date,
            value: p.organic + p.paid,
          }))
        : undefined,
    },
    fetchedAt: new Date(),
  };
}
