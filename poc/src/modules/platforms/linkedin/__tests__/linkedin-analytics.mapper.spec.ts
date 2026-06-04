import {
  buildMemberAudience,
  buildOrgAudience,
} from '../mapper/linkedin-analytics.mapper';

describe('buildMemberAudience', () => {
  test('folds follower series + metric series + totals into accountInsights', () => {
    const audience = buildMemberAudience({
      periodDays: 30,
      lifetimeFollowers: 1200,
      followersDaily: [
        { date: '2026-05-04', value: 1190 },
        { date: '2026-05-05', value: 1200 },
      ],
      totals: {
        IMPRESSION: 5000,
        REACTION: 100,
        COMMENT: 20,
        RESHARE: 10,
        MEMBERS_REACHED: 3000,
      },
      daily: {
        IMPRESSION: [{ date: '2026-05-04', value: 200 }],
        REACTION: [{ date: '2026-05-04', value: 4 }],
        COMMENT: [],
        RESHARE: [],
      },
    });
    const insights = audience.accountInsights;
    expect(insights?.periodDays).toBe(30);
    expect(insights?.views).toBe(5000);
    expect(insights?.likes).toBe(100);
    expect(insights?.comments).toBe(20);
    expect(insights?.shares).toBe(10);
    expect(insights?.reach).toBe(3000);
    expect(insights?.followerCountSeries).toEqual([
      { endTime: '2026-05-04', value: 1190 },
      { endTime: '2026-05-05', value: 1200 },
    ]);
    expect(insights?.videoViewsSeries).toEqual([
      { endTime: '2026-05-04', value: 200 },
    ]);
    expect(insights?.likesSeries).toEqual([
      { endTime: '2026-05-04', value: 4 },
    ]);
    expect(insights?.commentsSeries).toBeUndefined();
    expect(insights?.extra?.['lifetimeFollowers']).toBe(1200);
    expect(audience.genderDistribution).toEqual([]);
    expect(audience.fetchedAt).toBeInstanceOf(Date);
  });
});

describe('buildOrgAudience', () => {
  test('maps daily organic+paid gains to newFollowersSeries', () => {
    const audience = buildOrgAudience({
      periodDays: 30,
      followerGainsDaily: [
        { date: '2026-05-04', organic: 3, paid: 1 },
        { date: '2026-05-05', organic: 0, paid: 0 },
      ],
    });
    expect(audience.accountInsights?.newFollowersSeries).toEqual([
      { endTime: '2026-05-04', value: 4 },
      { endTime: '2026-05-05', value: 0 },
    ]);
  });

  test('omits the series when no gains', () => {
    const audience = buildOrgAudience({ periodDays: 30, followerGainsDaily: [] });
    expect(audience.accountInsights?.newFollowersSeries).toBeUndefined();
  });
});
