import {
  type AnalyticsBundle,
  analyticsToAudience,
} from '../mapper/analytics-to-audience.mapper';

const dailyReport = {
  columnHeaders: [
    { name: 'day' },
    { name: 'views' },
    { name: 'estimatedMinutesWatched' },
    { name: 'subscribersGained' },
    { name: 'subscribersLost' },
    { name: 'likes' },
    { name: 'comments' },
    { name: 'shares' },
  ],
  rows: [
    ['2026-04-01', 1000, 200, 50, 5, 80, 12, 3],
    ['2026-04-02', 1200, 240, 60, 8, 100, 15, 5],
  ] as Array<Array<string | number>>,
};

const demoReport = {
  columnHeaders: [
    { name: 'ageGroup' },
    { name: 'gender' },
    { name: 'viewerPercentage' },
  ],
  rows: [
    ['age25-34', 'male', 30],
    ['age25-34', 'female', 25],
    ['age35-44', 'male', 20],
    ['age35-44', 'female', 25],
  ] as Array<Array<string | number>>,
};

const geoReport = {
  columnHeaders: [
    { name: 'country' },
    { name: 'views' },
    { name: 'estimatedMinutesWatched' },
  ],
  rows: [
    ['US', 5000, 1200],
    ['ES', 3000, 800],
  ] as Array<Array<string | number>>,
};

describe('analyticsToAudience', () => {
  it('merges 6 reports into AudienceData', () => {
    const bundle: AnalyticsBundle = {
      daily: dailyReport,
      demo: demoReport,
      geo: geoReport,
      traffic: null,
      devices: null,
      monetization: null,
      errors: [],
    };
    const out = analyticsToAudience(bundle);

    expect(out.genderDistribution.find((b) => b.label === 'M')?.value).toBe(50);
    expect(out.genderDistribution.find((b) => b.label === 'F')?.value).toBe(50);
    expect(out.ageDistribution.find((b) => b.label === '25-34')?.value).toBe(55);
    expect(out.ageDistribution.find((b) => b.label === '35-44')?.value).toBe(45);

    expect(out.countryDistribution.length).toBe(2);
    expect(out.countryDistribution[0].label).toBe('US');
    expect(out.countryDistribution[0].value).toBe(5000);

    expect(out.accountInsights?.views).toBe(2200);
    expect(out.accountInsights?.likes).toBe(180);
    expect(out.accountInsights?.commentsSeries?.length).toBe(2);
  });

  it('records errors in engagedDemographics when buckets missing', () => {
    const bundle: AnalyticsBundle = {
      daily: null,
      demo: null,
      geo: null,
      traffic: null,
      devices: null,
      monetization: null,
      errors: [],
    };
    const out = analyticsToAudience(bundle);
    expect(out.genderDistribution).toHaveLength(0);
    expect(out.engagedDemographics?.errors?.length).toBeGreaterThan(0);
  });
});
