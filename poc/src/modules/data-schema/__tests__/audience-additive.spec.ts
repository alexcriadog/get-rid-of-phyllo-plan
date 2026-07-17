// Additive keys on the served /v1 audience doc.
//
// 2026-07-17: the connector captured far more audience data than it served.
// `toApiAudience` mapped 5 InsightIQ fields and silently dropped:
//   - reachedDemographics / engagedDemographics (Instagram spends 12 Graph
//     calls fetching these across 2 timeframes),
//   - accountInsights (follower series, best-time-to-post heatmap, CTA
//     totals — every platform fills some of it),
//   - interests + the LinkedIn professional-graph facets.
// The showroom had finished panels for all of them that could never render
// (Reached/Engaged tabs permanently disabled) because the data died at this
// mapper.
//
// Contract under test:
//   1. A follower-only audience keeps its EXACT historical shape — additive
//      keys appear ONLY when the canonical AudienceData carries them.
//   2. Buckets inside the additive groups get the same 0..100 percent
//      normalization as the top-level ones.
//   3. Per-breakdown errors and the per-timeframe map survive the round trip,
//      so the UI can explain WHY a scope is empty.

import type {
  AudienceData,
  DemographicDistributions,
} from "@modules/platforms/shared/platform-types";
import type { SchemaContext } from "../context";
import { toApiAudience } from "../mappers/audience.mapper";

const ctx: SchemaContext = {
  accountPk: "2",
  platform: "instagram",
  endUserId: "user-1",
  endUserName: "camaleonic",
  platformUsername: "camaleonicanalytics",
  canonicalUserId: "17841400000000000",
  createdAt: new Date("2026-07-17T10:00:00.000Z"),
  updatedAt: new Date("2026-07-17T11:00:00.000Z"),
};

const ADDITIVE_KEYS = [
  "reached_demographics",
  "engaged_demographics",
  "account_insights",
  "interests",
  "industry_distribution",
  "seniority_distribution",
  "function_distribution",
  "company_size_distribution",
] as const;

function followersOnly(overrides: Partial<AudienceData> = {}): AudienceData {
  return {
    genderDistribution: [
      { label: "female", value: 60, unit: "count" },
      { label: "male", value: 40, unit: "count" },
    ],
    ageDistribution: [{ label: "25-34", value: 50, unit: "count" }],
    countryDistribution: [{ label: "ES", value: 90, unit: "count" }],
    cityDistribution: [{ label: "Madrid", value: 10, unit: "count" }],
    fetchedAt: new Date("2026-07-17T10:30:00.000Z"),
    ...overrides,
  };
}

describe("audience mapper — additive keys are only-when-present", () => {
  test("a follower-only audience emits no additive keys at all", () => {
    const out = toApiAudience(ctx, followersOnly()) as unknown as Record<
      string,
      unknown
    >;
    for (const key of ADDITIVE_KEYS) {
      expect(out).not.toHaveProperty(key);
    }
  });

  test("an empty reached group does not invent a key", () => {
    const out = toApiAudience(
      ctx,
      followersOnly({ reachedDemographics: {} }),
    ) as unknown as Record<string, unknown>;
    expect(out).not.toHaveProperty("reached_demographics");
  });
});

describe("audience mapper — reached / engaged demographics", () => {
  const reached: DemographicDistributions = {
    genderDistribution: [
      { label: "female", value: 30, unit: "count" },
      { label: "male", value: 10, unit: "count" },
    ],
    countryDistribution: [{ label: "ES", value: 40, unit: "count" }],
    byTimeframe: {
      this_week: {
        genderDistribution: [{ label: "female", value: 1, unit: "count" }],
      },
      this_month: {
        genderDistribution: [
          { label: "female", value: 30, unit: "count" },
          { label: "male", value: 10, unit: "count" },
        ],
        countryDistribution: [{ label: "ES", value: 40, unit: "count" }],
      },
    },
  };

  test("reached demographics land under reached_demographics as percentages", () => {
    const out = toApiAudience(ctx, followersOnly({ reachedDemographics: reached }));
    const rd = out.reached_demographics!;
    expect(rd.gender_distribution).toEqual([
      { label: "FEMALE", value: 75 },
      { label: "MALE", value: 25 },
    ]);
    expect(rd.countries).toEqual([{ code: "ES", value: 100 }]);
  });

  test("the per-timeframe map survives so the UI can pivot windows", () => {
    const out = toApiAudience(ctx, followersOnly({ reachedDemographics: reached }));
    const byTf = out.reached_demographics!.by_timeframe!;
    expect(Object.keys(byTf).sort()).toEqual(["this_month", "this_week"]);
    expect(byTf.this_month!.gender_distribution).toEqual([
      { label: "FEMALE", value: 75 },
      { label: "MALE", value: 25 },
    ]);
    expect(byTf.this_week!.gender_distribution).toEqual([
      { label: "FEMALE", value: 100 },
    ]);
  });

  test("engaged demographics use the same shape", () => {
    const out = toApiAudience(
      ctx,
      followersOnly({
        engagedDemographics: {
          ageDistribution: [{ label: "25-34", value: 4, unit: "count" }],
        },
      }),
    );
    expect(out.engaged_demographics!.age_distribution).toEqual([
      { label: "25-34", value: 100 },
    ]);
    expect(out).not.toHaveProperty("reached_demographics");
  });

  test("per-breakdown errors survive so the UI can explain an empty scope", () => {
    const out = toApiAudience(
      ctx,
      followersOnly({
        reachedDemographics: {
          errors: [
            {
              breakdown: "city",
              message: "Not enough users in this segment",
              code: 100,
              subcode: 2108006,
            },
          ],
        },
      }),
    );
    expect(out.reached_demographics!.errors).toEqual([
      {
        breakdown: "city",
        message: "Not enough users in this segment",
        code: 100,
        subcode: 2108006,
      },
    ]);
  });
});

describe("audience mapper — account insights", () => {
  test("scalars, series and the activity heatmap are served in snake_case", () => {
    const out = toApiAudience(
      ctx,
      followersOnly({
        accountInsights: {
          periodDays: 28,
          reach: 1200,
          accountsEngaged: 300,
          profileViews: 42,
          lifetimeLikes: 999,
          followerCountSeries: [{ endTime: "2026-07-16", value: 84 }],
          audienceActivity: [{ hour: 21, count: 7 }],
          audienceActivityWeekly: [{ dayOfWeek: 2, hour: 21, count: 3 }],
          extra: { followers_count_current: 84 },
        },
      }),
    );
    const ai = out.account_insights!;
    expect(ai.period_days).toBe(28);
    expect(ai.reach).toBe(1200);
    expect(ai.accounts_engaged).toBe(300);
    expect(ai.profile_views).toBe(42);
    expect(ai.lifetime_likes).toBe(999);
    expect(ai.follower_count_series).toEqual([
      { end_time: "2026-07-16", value: 84 },
    ]);
    expect(ai.audience_activity).toEqual([{ hour: 21, count: 7 }]);
    expect(ai.audience_activity_weekly).toEqual([
      { day_of_week: 2, hour: 21, count: 3 },
    ]);
    expect(ai.extra).toEqual({ followers_count_current: 84 });
  });

  test("absent insight fields stay absent (no null padding)", () => {
    const out = toApiAudience(
      ctx,
      followersOnly({ accountInsights: { reach: 5 } }),
    );
    const ai = out.account_insights! as Record<string, unknown>;
    expect(ai.reach).toBe(5);
    expect(ai).not.toHaveProperty("likes");
    expect(ai).not.toHaveProperty("follower_count_series");
    expect(ai).not.toHaveProperty("extra");
  });

  test("an empty insights object does not invent a key", () => {
    const out = toApiAudience(
      ctx,
      followersOnly({ accountInsights: {} }),
    ) as unknown as Record<string, unknown>;
    expect(out).not.toHaveProperty("account_insights");
  });
});

describe("audience mapper — interests and professional facets", () => {
  test("LinkedIn facets and interests are percent-normalized when present", () => {
    const out = toApiAudience(
      ctx,
      followersOnly({
        interests: [{ label: "Technology", value: 3, unit: "count" }],
        industryDistribution: [
          { label: "Software", value: 3, unit: "count" },
          { label: "Media", value: 1, unit: "count" },
        ],
        seniorityDistribution: [{ label: "Senior", value: 2, unit: "count" }],
      }),
    );
    expect(out.interests).toEqual([{ label: "Technology", value: 100 }]);
    expect(out.industry_distribution).toEqual([
      { label: "Software", value: 75 },
      { label: "Media", value: 25 },
    ]);
    expect(out.seniority_distribution).toEqual([{ label: "Senior", value: 100 }]);
    expect(out).not.toHaveProperty("function_distribution");
  });
});
