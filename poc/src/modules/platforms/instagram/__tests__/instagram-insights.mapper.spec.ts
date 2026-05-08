/**
 * Phase E pinning tests — targets exported pure functions in
 * mapper/instagram-insights.mapper.ts.
 *
 * Phase A (foundation refactor) added a snapshot of the IG_MEDIA_METRICS
 * table. The per-bucket `insightMetricsForMedia` snapshots above derive
 * from this table; both must move together if the spec changes.
 */
import {
  IG_MEDIA_METRICS,
  bucketFor,
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

  describe('IG_MEDIA_METRICS spec table', () => {
    it('matches the canonical declaration (any change is intentional)', () => {
      expect(IG_MEDIA_METRICS).toMatchSnapshot();
    });
  });

  describe('bucketFor', () => {
    it.each([
      ['STORY via product_type', { id: 'a', media_type: 'VIDEO', media_product_type: 'STORY' }, 'STORY'],
      ['STORY via media_type', { id: 'b', media_type: 'STORY' }, 'STORY'],
      ['REELS', { id: 'c', media_type: 'VIDEO', media_product_type: 'REELS' }, 'REELS'],
      ['VIDEO feed', { id: 'd', media_type: 'VIDEO', media_product_type: 'FEED' }, 'VIDEO'],
      ['IMAGE feed', { id: 'e', media_type: 'IMAGE', media_product_type: 'FEED' }, 'IMAGE'],
      ['CAROUSEL', { id: 'f', media_type: 'CAROUSEL_ALBUM', media_product_type: 'FEED' }, 'CAROUSEL_ALBUM'],
      ['unknown defaults to IMAGE', { id: 'g', media_type: 'NEW' }, 'IMAGE'],
    ])('%s', (_label, media, expected) => {
      expect(bucketFor(media)).toBe(expected);
    });
  });
});
