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
        POST_SAVE: 7,
        POST_SEND: 4,
        LINK_CLICKS: 33,
        PREMIUM_CTA_CLICKS: 2,
        FOLLOWER_GAINED_FROM_CONTENT: 9,
        PROFILE_VIEW_FROM_CONTENT: 55,
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
    expect(insights?.saves).toBe(7);
    expect(insights?.profileViews).toBe(55);
    expect(insights?.extra?.['linkClicks']).toBe(33);
    expect(insights?.extra?.['postSends']).toBe(4);
    expect(insights?.extra?.['premiumCtaClicks']).toBe(2);
    expect(insights?.extra?.['followersFromContent']).toBe(9);
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
  test('maps demographics, engagement series and page stats', () => {
    const audience = buildOrgAudience({
      periodDays: 30,
      followerGainsDaily: [{ date: '2026-05-04', organic: 3, paid: 1 }],
      demographics: {
        country: [{ label: 'Spain', value: 800, unit: 'count' }],
        industry: [{ label: 'Software Development', value: 400, unit: 'count' }],
        seniority: [{ label: 'Senior', value: 300, unit: 'count' }],
        function: [{ label: 'Marketing', value: 200, unit: 'count' }],
        companySize: [{ label: 'SIZE_2_TO_10', value: 150, unit: 'count' }],
      },
      engagementTotals: {
        views: 9000,
        reach: 4000,
        likes: 120,
        comments: 15,
        shares: 8,
        clicks: 77,
        engagementRate: 0.024,
      },
      engagementDaily: {
        IMPRESSION: [{ date: '2026-05-04', value: 300 }],
        REACTION: [{ date: '2026-05-04', value: 5 }],
        COMMENT: [],
        RESHARE: [{ date: '2026-05-04', value: 1 }],
      },
      pageViews: {
        total: 432,
        desktop: 200,
        mobile: 232,
        daily: [{ date: '2026-05-04', value: 20 }],
        visitorCountries: [{ label: 'Spain', value: 12, unit: 'count' }],
      },
    });
    expect(audience.countryDistribution).toEqual([
      { label: 'Spain', value: 800, unit: 'count' },
    ]);
    expect(audience.industryDistribution?.[0]?.label).toBe(
      'Software Development',
    );
    expect(audience.seniorityDistribution?.[0]?.value).toBe(300);
    expect(audience.functionDistribution?.[0]?.label).toBe('Marketing');
    expect(audience.companySizeDistribution?.[0]?.label).toBe('SIZE_2_TO_10');
    expect(audience.reachedDemographics?.countryDistribution).toEqual([
      { label: 'Spain', value: 12, unit: 'count' },
    ]);
    const i = audience.accountInsights;
    expect(i?.views).toBe(9000);
    expect(i?.reach).toBe(4000);
    expect(i?.likes).toBe(120);
    expect(i?.comments).toBe(15);
    expect(i?.shares).toBe(8);
    expect(i?.profileViews).toBe(432);
    expect(i?.profileViewsSeries).toEqual([
      { endTime: '2026-05-04', value: 20 },
    ]);
    expect(i?.videoViewsSeries).toEqual([
      { endTime: '2026-05-04', value: 300 },
    ]);
    expect(i?.likesSeries).toEqual([{ endTime: '2026-05-04', value: 5 }]);
    expect(i?.sharesSeries).toEqual([{ endTime: '2026-05-04', value: 1 }]);
    expect(i?.newFollowersSeries).toEqual([
      { endTime: '2026-05-04', value: 4 },
    ]);
    expect(i?.extra?.['clicks']).toBe(77);
    expect(i?.extra?.['engagementRate']).toBe(0.024);
    expect(i?.extra?.['desktopPageViews']).toBe(200);
    expect(i?.extra?.['mobilePageViews']).toBe(232);
  });

  test('stays minimal when only gains are present (backwards compatible)', () => {
    const audience = buildOrgAudience({
      periodDays: 30,
      followerGainsDaily: [],
    });
    expect(audience.countryDistribution).toEqual([]);
    expect(audience.industryDistribution).toBeUndefined();
    expect(audience.accountInsights?.newFollowersSeries).toBeUndefined();
    expect(audience.accountInsights?.views).toBeUndefined();
  });
});
