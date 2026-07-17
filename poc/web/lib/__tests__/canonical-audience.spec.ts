// Canonical `audience` doc → the account page's view shape.
//
// The account page mapped the canonical doc inline and only picked up 4
// fields, so the Reached/Engaged tabs and the best-time-to-post heatmap could
// never render — even for Instagram, which pays 12 Graph calls for exactly
// that data.
//
// Contract under test:
//   1. The four follower-level distributions keep their existing mapping
//      (label/value, values left at the canonical 0..100 scale — the page
//      re-normalizes by the sum).
//   2. The additive keys (reached/engaged/account_insights) are read back into
//      camelCase, including the per-timeframe map and the error lists.
//   3. Docs written before 2026-07-17 (no additive keys) degrade to exactly
//      the old shape — no crash, no invented empties.

import { describe, expect, it } from 'vitest';
import { canonicalToAudience } from '../canonical-audience';

describe('canonicalToAudience — legacy docs', () => {
  it('maps the four follower distributions and nothing else', () => {
    const out = canonicalToAudience({
      doc: {
        countries: [{ code: 'ES', value: 62 }],
        cities: [{ name: 'Madrid', value: 5 }],
        gender_distribution: [{ label: 'FEMALE', value: 26.09 }],
        age_distribution: [{ label: '25-34', value: 42.79 }],
      },
      updated_at: '2026-07-17T08:00:00.000Z',
    });

    expect(out.countryDistribution).toEqual([{ label: 'ES', value: 62 }]);
    expect(out.cityDistribution).toEqual([{ label: 'Madrid', value: 5 }]);
    expect(out.genderDistribution).toEqual([{ label: 'FEMALE', value: 26.09 }]);
    expect(out.ageDistribution).toEqual([{ label: '25-34', value: 42.79 }]);
    expect(out.reachedDemographics).toBeUndefined();
    expect(out.engagedDemographics).toBeUndefined();
    expect(out.accountInsights).toBeUndefined();
  });

  it('survives an empty doc', () => {
    const out = canonicalToAudience({ doc: {} });
    expect(out.countryDistribution).toEqual([]);
    expect(out.genderDistribution).toEqual([]);
    expect(out.accountInsights).toBeUndefined();
  });

  it('survives a missing doc', () => {
    const out = canonicalToAudience({});
    expect(out.countryDistribution).toEqual([]);
  });
});

describe('canonicalToAudience — reached / engaged scopes', () => {
  const doc = {
    countries: [],
    reached_demographics: {
      gender_distribution: [
        { label: 'FEMALE', value: 75 },
        { label: 'MALE', value: 25 },
      ],
      countries: [{ code: 'ES', value: 100 }],
      by_timeframe: {
        this_week: {
          gender_distribution: [{ label: 'FEMALE', value: 100 }],
        },
        this_month: {
          gender_distribution: [
            { label: 'FEMALE', value: 75 },
            { label: 'MALE', value: 25 },
          ],
          cities: [{ name: 'Madrid', value: 40 }],
        },
      },
    },
    engaged_demographics: {
      errors: [
        {
          breakdown: 'city',
          message: 'Not enough users in this segment',
          code: 100,
          subcode: 2108006,
        },
      ],
    },
  };

  it('reads the reached scope back into camelCase', () => {
    const out = canonicalToAudience({ doc });
    expect(out.reachedDemographics!.genderDistribution).toEqual([
      { label: 'FEMALE', value: 75 },
      { label: 'MALE', value: 25 },
    ]);
    expect(out.reachedDemographics!.countryDistribution).toEqual([
      { label: 'ES', value: 100 },
    ]);
  });

  it('reads the per-timeframe map so the window selector works', () => {
    const out = canonicalToAudience({ doc });
    const byTf = out.reachedDemographics!.byTimeframe!;
    expect(Object.keys(byTf).sort()).toEqual(['this_month', 'this_week']);
    expect(byTf.this_week!.genderDistribution).toEqual([
      { label: 'FEMALE', value: 100 },
    ]);
    expect(byTf.this_month!.cityDistribution).toEqual([
      { label: 'Madrid', value: 40 },
    ]);
  });

  it('keeps per-breakdown errors so the UI can explain an empty scope', () => {
    const out = canonicalToAudience({ doc });
    expect(out.engagedDemographics!.errors).toEqual([
      {
        breakdown: 'city',
        message: 'Not enough users in this segment',
        code: 100,
        subcode: 2108006,
      },
    ]);
  });
});

describe('canonicalToAudience — account insights', () => {
  it('reads scalars, series and both activity heatmaps', () => {
    const out = canonicalToAudience({
      doc: {
        account_insights: {
          period_days: 28,
          reach: 1200,
          accounts_engaged: 300,
          profile_views: 42,
          follower_count_series: [{ end_time: '2026-07-16', value: 84 }],
          audience_activity: [{ hour: 21, count: 7 }],
          audience_activity_weekly: [{ day_of_week: 2, hour: 21, count: 3 }],
          extra: { followers_count_current: 84 },
        },
      },
    });

    const ai = out.accountInsights!;
    expect(ai.periodDays).toBe(28);
    expect(ai.reach).toBe(1200);
    expect(ai.accountsEngaged).toBe(300);
    expect(ai.profileViews).toBe(42);
    expect(ai.followerCountSeries).toEqual([
      { endTime: '2026-07-16', value: 84 },
    ]);
    expect(ai.audienceActivity).toEqual([{ hour: 21, count: 7 }]);
    expect(ai.audienceActivityWeekly).toEqual([
      { dayOfWeek: 2, hour: 21, count: 3 },
    ]);
    expect(ai.extra).toEqual({ followers_count_current: 84 });
  });

  it('leaves absent metrics absent', () => {
    const out = canonicalToAudience({
      doc: { account_insights: { reach: 5 } },
    });
    expect(out.accountInsights!.reach).toBe(5);
    expect(out.accountInsights!.likes).toBeUndefined();
    expect(out.accountInsights!.followerCountSeries).toBeUndefined();
  });
});
