import type {
  AccountInsightsData,
  AudienceData,
  DemographicDistributions,
  DistributionBucket,
} from "@modules/platforms/shared/platform-types";
import type { SchemaContext } from "../context";
import type {
  ApiAudience,
  ApiAudienceAccountInsights,
  ApiAudienceDemographics,
  ApiCountryBucket,
  ApiCityBucket,
  ApiDailySeriesPoint,
  ApiGenderAgeBucket,
  ApiLabelBucket,
} from "../api-types";
import { apiAudienceId } from "../ids";
import { buildEnvelope } from "./envelope.mapper";
import { toPercentPairs } from "../buckets";
import { normalizeGender, splitGenderAge } from "../format";

export function countriesToApi(
  buckets: ReadonlyArray<DistributionBucket> | undefined,
): ApiCountryBucket[] {
  return toPercentPairs(buckets).map((b) => ({
    code: b.label.toUpperCase(),
    value: b.value,
  }));
}

export function citiesToApi(
  buckets: ReadonlyArray<DistributionBucket> | undefined,
): ApiCityBucket[] {
  return toPercentPairs(buckets).map((b) => ({
    name: b.label,
    value: b.value,
  }));
}

export function gendersToApi(
  buckets: ReadonlyArray<DistributionBucket> | undefined,
): ApiLabelBucket[] {
  return toPercentPairs(buckets).map((b) => ({
    label: normalizeGender(b.label),
    value: b.value,
  }));
}

export function agesToApi(
  buckets: ReadonlyArray<DistributionBucket> | undefined,
): ApiLabelBucket[] {
  return toPercentPairs(buckets).map((b) => ({
    label: b.label,
    value: b.value,
  }));
}

/** Plain label buckets (interests, LinkedIn facets) — no label rewriting. */
function labelsToApi(
  buckets: ReadonlyArray<DistributionBucket> | undefined,
): ApiLabelBucket[] {
  return toPercentPairs(buckets).map((b) => ({ label: b.label, value: b.value }));
}

/**
 * Build the InsightIQ joint gender×age distribution. We only have a true joint
 * when the platform emitted combined labels (e.g. "F.25-34"); otherwise the
 * separate breakdowns are carried in gender_distribution/age_distribution
 * (additive) and this returns []. See §10.3 — full joint needs normalizer
 * changes per platform.
 */
export function genderAgeToApi(
  gender: ReadonlyArray<DistributionBucket> | undefined,
  age: ReadonlyArray<DistributionBucket> | undefined,
): ApiGenderAgeBucket[] {
  const combined = [...(gender ?? []), ...(age ?? [])].filter(
    (b) => /[.:|,/]/.test(b.label) && /\d/.test(b.label),
  );
  if (combined.length === 0) return [];
  return toPercentPairs(combined).map((b) => {
    const { gender: g, age_range } = splitGenderAge(b.label);
    return { gender: g, age_range, value: b.value };
  });
}

/** Spread helper: emit `{ [key]: value }` only for a non-empty array. */
function whenFilled<T>(key: string, arr: T[] | undefined): Record<string, T[]> {
  return arr && arr.length > 0 ? { [key]: arr } : {};
}

function seriesToApi(
  points: ReadonlyArray<{ endTime: string; value: number }> | undefined,
): ApiDailySeriesPoint[] | undefined {
  if (!points || points.length === 0) return undefined;
  return points.map((p) => ({ end_time: p.endTime, value: p.value }));
}

/**
 * One demographic scope (reached / engaged) → API shape. Returns undefined
 * when the scope carries nothing at all, so the key stays absent rather than
 * serving an empty object.
 */
function demographicsToApi(
  group: DemographicDistributions | undefined,
): ApiAudienceDemographics | undefined {
  if (!group) return undefined;

  const byTimeframe: Record<string, ApiAudienceDemographics> = {};
  for (const [window, variant] of Object.entries(group.byTimeframe ?? {})) {
    const mapped = demographicsToApi(variant);
    if (mapped) byTimeframe[window] = mapped;
  }

  const out: ApiAudienceDemographics = {
    ...whenFilled("countries", countriesToApi(group.countryDistribution)),
    ...whenFilled("cities", citiesToApi(group.cityDistribution)),
    ...whenFilled(
      "gender_age_distribution",
      genderAgeToApi(group.genderDistribution, group.ageDistribution),
    ),
    ...whenFilled("gender_distribution", gendersToApi(group.genderDistribution)),
    ...whenFilled("age_distribution", agesToApi(group.ageDistribution)),
    ...whenFilled("errors", group.errors ? [...group.errors] : undefined),
    ...(Object.keys(byTimeframe).length > 0 ? { by_timeframe: byTimeframe } : {}),
  };
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Scalar insight fields → snake_case. */
const INSIGHT_SCALARS: ReadonlyArray<
  [keyof AccountInsightsData, keyof ApiAudienceAccountInsights]
> = [
  ["periodDays", "period_days"],
  ["reach", "reach"],
  ["accountsEngaged", "accounts_engaged"],
  ["totalInteractions", "total_interactions"],
  ["likes", "likes"],
  ["comments", "comments"],
  ["saves", "saves"],
  ["shares", "shares"],
  ["replies", "replies"],
  ["views", "views"],
  ["profileViews", "profile_views"],
  ["websiteClicks", "website_clicks"],
  ["emailContacts", "email_contacts"],
  ["phoneCallClicks", "phone_call_clicks"],
  ["textMessageClicks", "text_message_clicks"],
  ["getDirectionsClicks", "get_directions_clicks"],
  ["lifetimeLikes", "lifetime_likes"],
  ["videosCount", "videos_count"],
];

/** Daily-series fields → snake_case. */
const INSIGHT_SERIES: ReadonlyArray<
  [keyof AccountInsightsData, keyof ApiAudienceAccountInsights]
> = [
  ["followerCountSeries", "follower_count_series"],
  ["newFollowersSeries", "new_followers_series"],
  ["lostFollowersSeries", "lost_followers_series"],
  ["videoViewsSeries", "video_views_series"],
  ["uniqueVideoViewsSeries", "unique_video_views_series"],
  ["profileViewsSeries", "profile_views_series"],
  ["likesSeries", "likes_series"],
  ["commentsSeries", "comments_series"],
  ["sharesSeries", "shares_series"],
  ["engagedAudienceSeries", "engaged_audience_series"],
  ["bioLinkClicksSeries", "bio_link_clicks_series"],
  ["emailClicksSeries", "email_clicks_series"],
  ["phoneNumberClicksSeries", "phone_number_clicks_series"],
  ["addressClicksSeries", "address_clicks_series"],
  ["appDownloadClicksSeries", "app_download_clicks_series"],
  ["leadSubmissionsSeries", "lead_submissions_series"],
];

/**
 * AccountInsightsData → API shape. Every field is only-when-present: absent
 * metrics stay absent instead of being padded with nulls, so a consumer can
 * tell "platform didn't return it" from "platform returned zero".
 */
function accountInsightsToApi(
  insights: AccountInsightsData | undefined,
): ApiAudienceAccountInsights | undefined {
  if (!insights) return undefined;
  const out: Record<string, unknown> = {};

  for (const [from, to] of INSIGHT_SCALARS) {
    const v = insights[from];
    if (typeof v === "number") out[to] = v;
  }
  for (const [from, to] of INSIGHT_SERIES) {
    const mapped = seriesToApi(
      insights[from] as
        | ReadonlyArray<{ endTime: string; value: number }>
        | undefined,
    );
    if (mapped) out[to] = mapped;
  }
  if (insights.audienceActivity && insights.audienceActivity.length > 0) {
    out.audience_activity = insights.audienceActivity.map((b) => ({
      hour: b.hour,
      count: b.count,
    }));
  }
  if (
    insights.audienceActivityWeekly &&
    insights.audienceActivityWeekly.length > 0
  ) {
    out.audience_activity_weekly = insights.audienceActivityWeekly.map((b) => ({
      day_of_week: b.dayOfWeek,
      hour: b.hour,
      count: b.count,
    }));
  }
  if (insights.extra && Object.keys(insights.extra).length > 0) {
    out.extra = { ...insights.extra };
  }

  return Object.keys(out).length > 0
    ? (out as ApiAudienceAccountInsights)
    : undefined;
}

/**
 * AudienceData → InsightIQ audience document (§4.3).
 *
 * The five InsightIQ fields are always emitted — that shape is the contract.
 * Everything past them is ADDITIVE and only-when-present: reached/engaged
 * scopes, account insights, interests and the LinkedIn professional facets
 * appear only for the platforms that fill them. Before 2026-07-17 this mapper
 * dropped all of it, so data the connector paid Graph calls for never reached
 * /v1 or the showroom.
 */
export function toApiAudience(
  ctx: SchemaContext,
  audience: AudienceData,
): ApiAudience {
  const id = apiAudienceId(ctx.accountPk);
  const env = buildEnvelope(ctx, id, {
    updatedAt: audience.fetchedAt ?? ctx.updatedAt,
  });
  const reached = demographicsToApi(audience.reachedDemographics);
  const engaged = demographicsToApi(audience.engagedDemographics);
  const accountInsights = accountInsightsToApi(audience.accountInsights);

  return {
    ...env,
    countries: countriesToApi(audience.countryDistribution),
    cities: citiesToApi(audience.cityDistribution),
    gender_age_distribution: genderAgeToApi(
      audience.genderDistribution,
      audience.ageDistribution,
    ),
    gender_distribution: gendersToApi(audience.genderDistribution),
    age_distribution: agesToApi(audience.ageDistribution),
    ...(reached ? { reached_demographics: reached } : {}),
    ...(engaged ? { engaged_demographics: engaged } : {}),
    ...(accountInsights ? { account_insights: accountInsights } : {}),
    ...whenFilled("interests", labelsToApi(audience.interests)),
    ...whenFilled(
      "industry_distribution",
      labelsToApi(audience.industryDistribution),
    ),
    ...whenFilled(
      "seniority_distribution",
      labelsToApi(audience.seniorityDistribution),
    ),
    ...whenFilled(
      "function_distribution",
      labelsToApi(audience.functionDistribution),
    ),
    ...whenFilled(
      "company_size_distribution",
      labelsToApi(audience.companySizeDistribution),
    ),
  };
}
