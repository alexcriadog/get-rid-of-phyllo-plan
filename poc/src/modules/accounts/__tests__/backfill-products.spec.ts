import { resolveBackfillProducts } from '../backfill-products';

const CATALOG = ['identity', 'audience', 'engagement_new', 'stories'];

describe('resolveBackfillProducts', () => {
  it('limits backfill to the workspace allow-list', () => {
    expect(
      resolveBackfillProducts(CATALOG, ['identity', 'audience'], undefined),
    ).toEqual(['identity', 'audience']);
  });

  it('respects the account connection scope when present (never resurrects pruned products)', () => {
    expect(
      resolveBackfillProducts(CATALOG, ['identity', 'audience', 'engagement_new'], [
        'identity',
      ]),
    ).toEqual(['identity']);
  });

  it('intersects connection scope with the workspace allow-list', () => {
    expect(
      resolveBackfillProducts(CATALOG, ['identity', 'audience'], [
        'identity',
        'engagement_new', // workspace no longer allows it
      ]),
    ).toEqual(['identity']);
  });

  it('drops products unknown to the catalog', () => {
    expect(
      resolveBackfillProducts(CATALOG, ['identity', 'ads'], ['identity', 'ads']),
    ).toEqual(['identity']); // ads is not in this platform catalog
  });

  it('returns [] when the workspace does not offer the platform', () => {
    expect(resolveBackfillProducts(CATALOG, undefined, ['identity'])).toEqual([]);
  });
});
