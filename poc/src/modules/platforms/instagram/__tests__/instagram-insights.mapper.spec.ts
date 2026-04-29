/**
 * Phase E pinning tests — targets exported pure functions in
 * mapper/instagram-insights.mapper.ts.
 */
import {
  insightMetricsForMedia,
  mapInsightsData,
} from '../mapper/instagram-insights.mapper';

describe('Instagram insights mapper (pinning)', () => {
  describe('mapInsightsData', () => {
    it('canonical mappings (reach/saved/shares/views/impressions)', () => {
      expect(
        mapInsightsData([
          { name: 'reach', values: [{ value: 12000 }] },
          { name: 'saved', values: [{ value: 45 }] },
          { name: 'shares', values: [{ value: 17 }] },
          { name: 'views', values: [{ value: 28000 }] },
          { name: 'impressions', values: [{ value: 30000 }] },
        ]),
      ).toMatchSnapshot();
    });

    it('unknown metrics flow into extra', () => {
      expect(
        mapInsightsData([
          { name: 'reach', values: [{ value: 100 }] },
          { name: 'follows', values: [{ value: 9 }] },
          { name: 'profile_visits', values: [{ value: 22 }] },
          { name: 'total_interactions', values: [{ value: 130 }] },
        ]),
      ).toMatchSnapshot();
    });

    it('non-numeric values are skipped (no extra entry)', () => {
      expect(
        mapInsightsData([
          { name: 'reach', values: [{ value: { not: 'a-number' } }] },
          { name: 'follows', values: [{ value: 4 }] },
        ]),
      ).toMatchSnapshot();
    });

    it('empty data returns empty', () => {
      expect(mapInsightsData([])).toEqual({});
    });
  });

  describe('insightMetricsForMedia', () => {
    it('STORY (media_product_type=STORY)', () => {
      expect(
        insightMetricsForMedia({
          id: 's1',
          media_type: 'VIDEO',
          media_product_type: 'STORY',
        }),
      ).toMatchSnapshot();
    });

    it('STORY (media_type=STORY only)', () => {
      expect(
        insightMetricsForMedia({ id: 's2', media_type: 'STORY' }),
      ).toMatchSnapshot();
    });

    it('REELS', () => {
      expect(
        insightMetricsForMedia({
          id: 'r1',
          media_type: 'VIDEO',
          media_product_type: 'REELS',
        }),
      ).toMatchSnapshot();
    });

    it('feed VIDEO', () => {
      expect(
        insightMetricsForMedia({
          id: 'v1',
          media_type: 'VIDEO',
          media_product_type: 'FEED',
        }),
      ).toMatchSnapshot();
    });

    it('IMAGE', () => {
      expect(
        insightMetricsForMedia({
          id: 'i1',
          media_type: 'IMAGE',
          media_product_type: 'FEED',
        }),
      ).toMatchSnapshot();
    });

    it('CAROUSEL_ALBUM', () => {
      expect(
        insightMetricsForMedia({
          id: 'c1',
          media_type: 'CAROUSEL_ALBUM',
          media_product_type: 'FEED',
        }),
      ).toMatchSnapshot();
    });

    it('unknown media_type falls through to FEED-like default', () => {
      expect(
        insightMetricsForMedia({ id: 'u1', media_type: 'NEW' }),
      ).toMatchSnapshot();
    });
  });
});
