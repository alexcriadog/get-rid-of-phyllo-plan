// TikTok audience: the demographics are gated behind a 100-follower threshold
// and TikTok signals a refusal by returning EMPTY arrays — no error, no code.
// Verified in prod 2026-07-17: accounts 9 (29 followers) and 14 (84 followers)
// both got `audience_ages: [], audience_countries: [], audience_genders: []`.
//
// An empty array is indistinguishable from "no data yet" downstream, so the
// showroom rendered a blank Demographics panel with nothing to explain it.
// The reason goes in `followerDemographicsErrors` — NOT the reachedDemographics
// slot the Threads fetcher borrows, because that flips the account page's
// `hasReached` and offers a "Reached" tab for a scope TikTok does not have
// (its support matrix has follower distributions only).

import { TikTokAudienceFetcher } from '../tiktok-audience.fetcher';

function makeClient(body: unknown) {
  return { call: jest.fn(async () => body) } as never;
}

const ACCESS = 'tok';
const CANON = '_000abc';
const META = { business_id: '_000abc' };

describe('TikTokAudienceFetcher — sub-threshold accounts', () => {
  it('explains the 100-follower threshold when demographics come back empty', async () => {
    const client = makeClient({
      followers_count: 29,
      audience_ages: [],
      audience_cities: [],
      audience_countries: [],
      audience_genders: [],
    });

    const audience = await new TikTokAudienceFetcher(client).fetch(ACCESS, CANON, META);

    const errors = audience.followerDemographicsErrors ?? [];
    expect(errors.map((e) => e.breakdown).sort()).toEqual([
      'age',
      'city',
      'country',
      'gender',
    ]);
    for (const e of errors) {
      expect(e.message).toContain('100');
    }
    // TikTok has no reached/engaged scope — claiming one would offer the UI a
    // tab that cannot exist.
    expect(audience.reachedDemographics).toBeUndefined();
    expect(audience.engagedDemographics).toBeUndefined();
  });

  it('keeps the message timeless — the live count goes in extra, not the text', async () => {
    // coalesce-merge keeps last-known-good, so a key that stops being emitted
    // survives forever. A message saying "this account has 84" would still be
    // on screen years later; the count must come from extra, which is
    // rewritten on every sync.
    const client = makeClient({
      followers_count: 84,
      audience_ages: [],
      audience_cities: [],
      audience_countries: [],
      audience_genders: [],
    });

    const audience = await new TikTokAudienceFetcher(client).fetch(ACCESS, CANON, META);

    for (const e of audience.followerDemographicsErrors ?? []) {
      expect(e.message).not.toContain('84');
    }
  });

  it('surfaces the live follower count so the UI can show how far off it is', async () => {
    const client = makeClient({
      followers_count: 84,
      audience_ages: [],
      audience_cities: [],
      audience_countries: [],
      audience_genders: [],
    });

    const audience = await new TikTokAudienceFetcher(client).fetch(ACCESS, CANON, META);

    expect(audience.accountInsights?.extra?.followers_count_current).toBe(84);
  });
});

describe('TikTokAudienceFetcher — followerCountSeries carries DELTAS', () => {
  // AccountInsightsData.followerCountSeries is a daily-DELTA series: the
  // showroom sums it for "Followers · daily net change" and back-walks the
  // cumulative line from the current total. TikTok's `daily_total_followers`
  // is the opposite — a running total at end of day — so feeding it straight
  // through made the panel sum every day's headcount (a 1.2k account would
  // report ~+8,400 new followers in a week).
  const withSeries = (metrics: unknown[]) => ({
    followers_count: 1200,
    audience_ages: [{ age: '25-34', percentage: 0.6 }],
    audience_cities: [],
    audience_countries: [],
    audience_genders: [],
    metrics,
  });

  it('derives the net delta from new/lost, not the running total', async () => {
    const client = makeClient(
      withSeries([
        {
          date: '2026-07-15',
          daily_total_followers: 1190,
          daily_new_followers: 12,
          daily_lost_followers: 2,
        },
        {
          date: '2026-07-16',
          daily_total_followers: 1200,
          daily_new_followers: 15,
          daily_lost_followers: 5,
        },
      ]),
    );

    const audience = await new TikTokAudienceFetcher(client).fetch(ACCESS, CANON, META);

    expect(audience.accountInsights?.followerCountSeries).toEqual([
      { endTime: '2026-07-15', value: 10 },
      { endTime: '2026-07-16', value: 10 },
    ]);
    // The running total is still available, just not as the delta series.
    expect(audience.accountInsights?.extra?.followers_count_current).toBe(1200);
  });

  it('reports a negative day when an account loses followers', async () => {
    const client = makeClient(
      withSeries([
        {
          date: '2026-07-16',
          daily_total_followers: 1200,
          daily_new_followers: 1,
          daily_lost_followers: 9,
        },
      ]),
    );

    const audience = await new TikTokAudienceFetcher(client).fetch(ACCESS, CANON, META);

    expect(audience.accountInsights?.followerCountSeries).toEqual([
      { endTime: '2026-07-16', value: -8 },
    ]);
  });
});

describe('TikTokAudienceFetcher — accounts over the threshold', () => {
  const populated = {
    followers_count: 1200,
    audience_ages: [{ age: '25-34', percentage: 0.6 }],
    audience_cities: [{ city: 'Madrid', percentage: 0.3 }],
    audience_countries: [{ country: 'ES', percentage: 0.8 }],
    audience_genders: [{ gender: 'female', percentage: 0.55 }],
  };

  it('maps the distributions and raises no threshold error', async () => {
    const audience = await new TikTokAudienceFetcher(makeClient(populated)).fetch(
      ACCESS,
      CANON,
      META,
    );

    expect(audience.ageDistribution).toEqual([
      { label: '25-34', value: 0.6, unit: 'percent' },
    ]);
    expect(audience.countryDistribution).toEqual([
      { label: 'ES', value: 0.8, unit: 'percent' },
    ]);
    expect(audience.reachedDemographics).toBeUndefined();
  });

  it('does not invent a threshold error when the account is simply new', async () => {
    // Over the threshold but TikTok returned nothing — we must NOT claim the
    // follower threshold is the reason, because it isn't.
    const client = makeClient({
      followers_count: 5000,
      audience_ages: [],
      audience_cities: [],
      audience_countries: [],
      audience_genders: [],
    });

    const audience = await new TikTokAudienceFetcher(client).fetch(ACCESS, CANON, META);

    expect(audience.followerDemographicsErrors).toBeUndefined();
    expect(audience.accountInsights?.extra?.followers_count_current).toBe(5000);
  });

  it('stays silent when TikTok omits followers_count entirely', async () => {
    const client = makeClient({
      audience_ages: [],
      audience_cities: [],
      audience_countries: [],
      audience_genders: [],
    });

    const audience = await new TikTokAudienceFetcher(client).fetch(ACCESS, CANON, META);

    expect(audience.followerDemographicsErrors).toBeUndefined();
  });
});
