// IG-direct scope-surface tests for workspace-config.ts. Kept separate from
// workspace-config.test.ts so the whole instagram_direct contract (mapping +
// scope computation + reachability) reads as one unit.
import { describe, expect, test } from 'vitest';
import {
  computeOAuthScopes,
  platformReachableAtOAuthStart,
  toIgDirectScopes,
  type ProductsCatalog,
} from './workspace-config';

const CATALOG: ProductsCatalog = {
  platforms: ['facebook', 'instagram'],
  products: ['identity', 'audience', 'engagement_new', 'stories'],
  catalog: {
    instagram: [
      { id: 'identity', label: 'Profile', required: true, default: true, scopes: ['instagram_basic'] },
      { id: 'audience', label: 'Audience', default: true, scopes: ['instagram_manage_insights'] },
      { id: 'engagement_new', label: 'Posts + metrics', default: true, scopes: ['instagram_manage_insights', 'pages_manage_metadata'] },
      { id: 'stories', label: 'Stories', default: true, scopes: ['instagram_manage_insights', 'pages_manage_metadata'] },
    ],
  },
};

describe('toIgDirectScopes', () => {
  test('maps FB-login IG scope names to instagram_business_* equivalents', () => {
    expect(toIgDirectScopes(['instagram_basic', 'instagram_manage_insights'])).toEqual([
      'instagram_business_basic',
      'instagram_business_manage_insights',
    ]);
  });

  test('drops Page-scoped permissions that have no direct-flow counterpart', () => {
    expect(toIgDirectScopes(['instagram_basic', 'pages_manage_metadata', 'pages_show_list'])).toEqual([
      'instagram_business_basic',
    ]);
  });

  test('de-dupes after mapping', () => {
    expect(
      toIgDirectScopes(['instagram_manage_insights', 'instagram_manage_insights']),
    ).toEqual(['instagram_business_manage_insights']);
  });

  test('passes through unknown non-Page scopes (future instagram_business_* entries)', () => {
    expect(toIgDirectScopes(['instagram_business_content_publish'])).toEqual([
      'instagram_business_content_publish',
    ]);
  });

  test('drops unknown pages_* scopes not in the map', () => {
    expect(toIgDirectScopes(['pages_read_user_content', 'instagram_basic'])).toEqual([
      'instagram_business_basic',
    ]);
  });
});

describe('computeOAuthScopes for instagram_direct', () => {
  test('unrestricted workspace gets the full mapped IG scope set', () => {
    expect(computeOAuthScopes(CATALOG, null, 'instagram_direct').sort()).toEqual([
      'instagram_business_basic',
      'instagram_business_manage_insights',
    ]);
  });

  test('restricted workspace maps only the enabled instagram products', () => {
    const config = { instagram: ['identity'] };
    expect(computeOAuthScopes(CATALOG, config, 'instagram_direct')).toEqual([
      'instagram_business_basic',
    ]);
  });

  test('workspace without instagram yields only required-product scopes', () => {
    const config = { facebook: ['identity'] };
    // instagram key absent → products [], but `identity` is required → its scopes stay.
    expect(computeOAuthScopes(CATALOG, config, 'instagram_direct')).toEqual([
      'instagram_business_basic',
    ]);
  });
});

describe('platformReachableAtOAuthStart for instagram_direct', () => {
  test('reachable when workspace offers instagram', () => {
    expect(platformReachableAtOAuthStart({ instagram: ['identity'] }, 'instagram_direct')).toBe(true);
  });
  test('not reachable when workspace omits instagram', () => {
    expect(platformReachableAtOAuthStart({ facebook: ['identity'] }, 'instagram_direct')).toBe(false);
  });
  test('reachable when unrestricted (null config)', () => {
    expect(platformReachableAtOAuthStart(null, 'instagram_direct')).toBe(true);
  });
});
