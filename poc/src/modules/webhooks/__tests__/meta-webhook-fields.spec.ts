import {
  FIELD_TO_PRODUCT,
  pageFieldsForProducts,
} from '../meta-webhook-fields';

describe('FIELD_TO_PRODUCT', () => {
  it('routes engagement-style fields to engagement_new', () => {
    expect(FIELD_TO_PRODUCT['feed']).toBe('engagement_new');
    expect(FIELD_TO_PRODUCT['comments']).toBe('engagement_new');
    expect(FIELD_TO_PRODUCT['mentions']).toBe('engagement_new');
  });

  it('routes story fields to stories', () => {
    expect(FIELD_TO_PRODUCT['story_insights']).toBe('stories');
    expect(FIELD_TO_PRODUCT['stories']).toBe('stories');
  });

  it('routes ratings to the ratings product (not the default)', () => {
    expect(FIELD_TO_PRODUCT['ratings']).toBe('ratings');
  });

  it('returns undefined for an unmapped field (caller applies its own default)', () => {
    expect(FIELD_TO_PRODUCT['unknown_field']).toBeUndefined();
  });
});

describe('pageFieldsForProducts', () => {
  it('maps engagement_new to feed/videos/live_videos', () => {
    expect(pageFieldsForProducts(['engagement_new']).sort()).toEqual(
      ['feed', 'live_videos', 'videos'].sort(),
    );
  });

  it('unions and dedupes across products (comments shares feed)', () => {
    const fields = pageFieldsForProducts([
      'engagement_new',
      'comments',
      'mentions',
      'ratings',
    ]);
    expect(fields.sort()).toEqual(
      ['feed', 'videos', 'live_videos', 'mention', 'ratings'].sort(),
    );
  });

  it('returns [] for products with no Page webhook coverage', () => {
    expect(pageFieldsForProducts(['identity', 'audience', 'stories'])).toEqual(
      [],
    );
  });

  it('ignores unknown products', () => {
    expect(pageFieldsForProducts(['bogus'])).toEqual([]);
  });
});
