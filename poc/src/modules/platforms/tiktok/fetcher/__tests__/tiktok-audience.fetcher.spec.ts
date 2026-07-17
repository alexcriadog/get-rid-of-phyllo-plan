// TikTok audience: the demographics are gated behind a 100-follower threshold
// and TikTok signals a refusal by returning EMPTY arrays — no error, no code.
// Verified in prod 2026-07-17: accounts 9 (29 followers) and 14 (84 followers)
// both got `audience_ages: [], audience_countries: [], audience_genders: []`.
//
// An empty array is indistinguishable from "no data yet" downstream, so the
// showroom rendered a blank Demographics panel with nothing to explain it.
// We follow the Threads precedent (threads-audience.fetcher.ts) and pack the
// reason into `reachedDemographics.errors`, which the account page surfaces
// under the Followers scope.

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

    const errors = audience.reachedDemographics?.errors ?? [];
    expect(errors.map((e) => e.breakdown).sort()).toEqual([
      'age',
      'city',
      'country',
      'gender',
    ]);
    for (const e of errors) {
      expect(e.message).toContain('100');
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

    expect(audience.reachedDemographics).toBeUndefined();
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

    expect(audience.reachedDemographics).toBeUndefined();
  });
});
