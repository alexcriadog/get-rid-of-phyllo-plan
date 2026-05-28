// Per-workspace OAuth scope computation. The product → scope mapping lives
// in POC (poc/src/modules/accounts/products.catalog.ts) and reaches us over
// the wire via GET /internal/products-catalog. Tests use a synthetic catalog
// that mirrors the production shape so they don't depend on a live POC.

import { describe, it, expect } from 'vitest';
import {
  computeOAuthScopes,
  fullScopesForPlatform,
  scopesForProducts,
  type ProductsCatalog,
} from './workspace-config';

const CATALOG: ProductsCatalog = {
  platforms: ['instagram', 'facebook', 'tiktok', 'threads', 'youtube', 'twitch'],
  products: [
    'identity',
    'audience',
    'engagement_new',
    'engagement_deep',
    'stories',
    'mentions',
    'comments',
    'ratings',
    'ads',
  ],
  catalog: {
    facebook: [
      { id: 'identity', label: 'Profile', required: true, scopes: ['pages_show_list', 'instagram_basic'] },
      { id: 'audience', label: 'Audience', scopes: ['read_insights', 'instagram_manage_insights'] },
      { id: 'engagement_new', label: 'Posts', scopes: ['pages_read_engagement'] },
      { id: 'stories', label: 'Stories', scopes: ['pages_read_user_content'] },
      { id: 'mentions', label: 'Mentions', scopes: ['pages_read_user_content'] },
      { id: 'comments', label: 'Comments', scopes: ['pages_read_user_content'] },
      { id: 'ratings', label: 'Ratings', scopes: ['pages_read_engagement'] },
      { id: 'ads', label: 'Ads', scopes: ['ads_read', 'business_management'] },
    ],
    instagram: [
      { id: 'identity', label: 'Profile', required: true, scopes: ['instagram_basic'] },
      { id: 'audience', label: 'Audience', scopes: ['instagram_manage_insights'] },
      { id: 'engagement_new', label: 'Posts', scopes: ['instagram_manage_insights'] },
      { id: 'stories', label: 'Stories', scopes: ['instagram_manage_insights'] },
    ],
    tiktok: [
      { id: 'identity', label: 'Profile', required: true, scopes: ['user.info.basic', 'user.info.profile', 'user.account.type'] },
      { id: 'audience', label: 'Audience', scopes: ['user.info.stats', 'user.insights'] },
      { id: 'engagement_new', label: 'Videos', scopes: ['video.list', 'video.insights'] },
      { id: 'comments', label: 'Comments', scopes: ['comment.list'] },
    ],
    threads: [
      { id: 'identity', label: 'Profile', required: true, scopes: ['threads_basic'] },
      { id: 'audience', label: 'Audience', scopes: ['threads_manage_insights'] },
      { id: 'engagement_new', label: 'Posts', scopes: ['threads_manage_insights'] },
      { id: 'comments', label: 'Replies', scopes: ['threads_read_replies'] },
      { id: 'mentions', label: 'Mentions', scopes: ['threads_manage_insights'] },
    ],
    youtube: [
      { id: 'identity', label: 'Channel', required: true, scopes: ['https://www.googleapis.com/auth/youtube.readonly'] },
      { id: 'audience', label: 'Audience', scopes: ['https://www.googleapis.com/auth/yt-analytics.readonly'] },
      { id: 'engagement_new', label: 'Videos', scopes: [] },
      { id: 'engagement_deep', label: 'Per-video', scopes: ['https://www.googleapis.com/auth/yt-analytics.readonly'] },
      { id: 'comments', label: 'Comments', scopes: [] },
      { id: 'ads', label: 'Ad insights', scopes: ['https://www.googleapis.com/auth/yt-analytics-monetary.readonly'] },
    ],
    twitch: [
      { id: 'identity', label: 'Channel', required: true, scopes: ['user:read:email', 'moderator:read:followers', 'channel:read:subscriptions'] },
      { id: 'engagement_new', label: 'VODs', scopes: [] },
    ],
  },
};

describe('scopesForProducts (catalog-based)', () => {
  it('returns identity scopes only when products is empty', () => {
    expect(scopesForProducts(CATALOG, 'tiktok', [])).toEqual([
      'user.info.basic',
      'user.info.profile',
      'user.account.type',
    ]);
  });

  it('does not include video/comment scopes for tiktok identity-only', () => {
    const scopes = scopesForProducts(CATALOG, 'tiktok', ['identity']);
    expect(scopes).not.toContain('video.list');
    expect(scopes).not.toContain('comment.list');
    expect(scopes).not.toContain('user.insights');
  });

  it('youtube ads but not audience → monetary without analytics', () => {
    const scopes = scopesForProducts(CATALOG, 'youtube', ['identity', 'ads']);
    expect(scopes).toContain('https://www.googleapis.com/auth/yt-analytics-monetary.readonly');
    expect(scopes).not.toContain('https://www.googleapis.com/auth/yt-analytics.readonly');
  });
});

describe('fullScopesForPlatform', () => {
  it('produces the union of every product\'s scopes for facebook (legacy parity)', () => {
    expect(fullScopesForPlatform(CATALOG, 'facebook').sort()).toEqual(
      [
        'ads_read',
        'business_management',
        'instagram_basic',
        'instagram_manage_insights',
        'pages_read_engagement',
        'pages_read_user_content',
        'pages_show_list',
        'read_insights',
      ].sort(),
    );
  });

  it('handles platforms whose products reuse scopes (youtube)', () => {
    expect(fullScopesForPlatform(CATALOG, 'youtube').sort()).toEqual(
      [
        'https://www.googleapis.com/auth/youtube.readonly',
        'https://www.googleapis.com/auth/yt-analytics.readonly',
        'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
      ].sort(),
    );
  });
});

describe('computeOAuthScopes (the bit /api/oauth/start passes to buildAuthorizeUrl)', () => {
  it('null config → full platform scope set (legacy demo flow)', () => {
    expect(computeOAuthScopes(CATALOG, null, 'tiktok').sort()).toEqual(
      [
        'user.info.basic',
        'user.info.profile',
        'user.account.type',
        'user.info.stats',
        'user.insights',
        'video.list',
        'video.insights',
        'comment.list',
      ].sort(),
    );
  });

  it('null config + facebook OAuth → union of FB + IG scopes', () => {
    const scopes = computeOAuthScopes(CATALOG, null, 'facebook');
    expect(scopes).toContain('pages_show_list');
    expect(scopes).toContain('instagram_basic');
    expect(scopes).toContain('instagram_manage_insights');
    expect(scopes).toContain('ads_read');
  });

  it('restricted config: tiktok identity-only gives identity scopes only', () => {
    const scopes = computeOAuthScopes(
      CATALOG,
      { tiktok: ['identity'] },
      'tiktok',
    );
    expect(scopes.sort()).toEqual(
      ['user.info.basic', 'user.info.profile', 'user.account.type'].sort(),
    );
  });

  it('restricted config: youtube identity+audience excludes monetary', () => {
    const scopes = computeOAuthScopes(
      CATALOG,
      { youtube: ['identity', 'audience'] },
      'youtube',
    );
    expect(scopes).toContain('https://www.googleapis.com/auth/youtube.readonly');
    expect(scopes).toContain('https://www.googleapis.com/auth/yt-analytics.readonly');
    expect(scopes).not.toContain(
      'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
    );
  });

  it('facebook OAuth with only instagram offered: scopes include IG but not ads_read', () => {
    const scopes = computeOAuthScopes(
      CATALOG,
      { instagram: ['identity', 'audience'] },
      'facebook',
    );
    expect(scopes).toContain('instagram_basic');
    expect(scopes).toContain('instagram_manage_insights');
    expect(scopes).not.toContain('ads_read');
    expect(scopes).not.toContain('business_management');
    expect(scopes).not.toContain('pages_read_engagement');
  });

  it('facebook OAuth with only facebook offered: scopes do not include extra IG-only', () => {
    const scopes = computeOAuthScopes(
      CATALOG,
      { facebook: ['identity'] },
      'facebook',
    );
    // identity for FB includes instagram_basic by design (FB OAuth resolves
    // connected IG accounts), but no insights scopes.
    expect(scopes).toContain('pages_show_list');
    expect(scopes).toContain('instagram_basic');
    expect(scopes).not.toContain('instagram_manage_insights');
    expect(scopes).not.toContain('ads_read');
  });

  it('deduplicates overlapping scopes across products + platforms', () => {
    const scopes = computeOAuthScopes(
      CATALOG,
      {
        facebook: ['identity', 'engagement_new', 'ratings'],
        instagram: ['identity', 'audience'],
      },
      'facebook',
    );
    expect(scopes.filter((s) => s === 'pages_read_engagement')).toHaveLength(1);
    expect(scopes.filter((s) => s === 'instagram_basic')).toHaveLength(1);
    expect(scopes.filter((s) => s === 'instagram_manage_insights')).toHaveLength(1);
  });
});
