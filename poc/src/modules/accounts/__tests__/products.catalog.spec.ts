import {
  PLATFORM_CATALOG,
  PLATFORM_IDS,
  PRODUCT_IDS,
  PRODUCTS_BY_PLATFORM,
  defaultSelectedProducts,
  fullScopesForPlatform,
  requiredProducts,
  scopesForProducts,
} from '../products.catalog';

// Legacy scope sets from connect-tool/lib/platforms.ts before the per-product
// breakdown landed. Workspaces with every product enabled MUST get exactly
// this set so we don't regress the consent screen for unrestricted users.
const LEGACY_FULL_SCOPES: Record<string, string[]> = {
  facebook: [
    'pages_show_list',
    'pages_read_engagement',
    'pages_read_user_content',
    'ads_read',
    'business_management',
    'instagram_basic',
    'instagram_manage_insights',
    'read_insights',
  ],
  // IG OAuth is covered by FB; on its own (used only in the
  // facebook↔instagram special case in connect-tool) its scope union is the
  // IG-prefixed subset.
  instagram: ['instagram_basic', 'instagram_manage_insights'],
  tiktok: [
    'user.info.basic',
    'user.info.profile',
    'user.info.stats',
    'user.account.type',
    'user.insights',
    'video.list',
    'video.insights',
    'comment.list',
  ],
  threads: [
    'threads_basic',
    'threads_manage_insights',
    'threads_read_replies',
  ],
  youtube: [
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
    'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
  ],
  twitch: [
    'user:read:email',
    'moderator:read:followers',
    'channel:read:subscriptions',
  ],
};

describe('PLATFORM_CATALOG', () => {
  it('marks identity as required on every platform', () => {
    for (const p of PLATFORM_IDS) {
      const defs = PLATFORM_CATALOG[p];
      const identity = defs.find((d) => d.id === 'identity');
      expect(identity).toBeDefined();
      expect(identity?.required).toBe(true);
    }
  });

  it('exposes only product IDs from the canonical PRODUCT_IDS list', () => {
    for (const p of PLATFORM_IDS) {
      for (const def of PLATFORM_CATALOG[p]) {
        expect(PRODUCT_IDS).toContain(def.id);
      }
    }
  });
});

describe('PRODUCTS_BY_PLATFORM (derived)', () => {
  it('derives one entry per catalog product per platform', () => {
    for (const p of PLATFORM_IDS) {
      const ids = PLATFORM_CATALOG[p].map((d) => d.id);
      expect(PRODUCTS_BY_PLATFORM[p]).toEqual(ids);
    }
  });
});

describe('scopesForProducts', () => {
  it('always includes scopes from required products (identity)', () => {
    const scopes = scopesForProducts('tiktok', []);
    expect(scopes).toEqual(
      expect.arrayContaining([
        'user.info.basic',
        'user.info.profile',
        'user.account.type',
      ]),
    );
  });

  it('does NOT include video/comment scopes when only identity is enabled (tiktok)', () => {
    const scopes = scopesForProducts('tiktok', ['identity']);
    expect(scopes).not.toContain('video.list');
    expect(scopes).not.toContain('video.insights');
    expect(scopes).not.toContain('comment.list');
    expect(scopes).not.toContain('user.insights');
  });

  it('adds audience scopes when audience is enabled (tiktok)', () => {
    const scopes = scopesForProducts('tiktok', ['identity', 'audience']);
    expect(scopes).toEqual(
      expect.arrayContaining(['user.info.stats', 'user.insights']),
    );
    expect(scopes).not.toContain('video.list');
  });

  it('youtube identity-only does NOT request analytics or monetary scopes', () => {
    const scopes = scopesForProducts('youtube', ['identity']);
    expect(scopes).toContain('https://www.googleapis.com/auth/youtube.readonly');
    expect(scopes).not.toContain(
      'https://www.googleapis.com/auth/yt-analytics.readonly',
    );
    expect(scopes).not.toContain(
      'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
    );
  });

  it('youtube ads enables monetary scope without analytics (when audience disabled)', () => {
    const scopes = scopesForProducts('youtube', ['identity', 'ads']);
    expect(scopes).toContain(
      'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
    );
    expect(scopes).not.toContain(
      'https://www.googleapis.com/auth/yt-analytics.readonly',
    );
  });

  it('facebook identity-only excludes ads and engagement scopes', () => {
    const scopes = scopesForProducts('facebook', ['identity']);
    expect(scopes).toContain('pages_show_list');
    expect(scopes).not.toContain('ads_read');
    expect(scopes).not.toContain('business_management');
    expect(scopes).not.toContain('pages_read_engagement');
    expect(scopes).not.toContain('pages_read_user_content');
  });

  it('deduplicates overlapping scopes (facebook engagement + ratings both use pages_read_engagement)', () => {
    const scopes = scopesForProducts('facebook', [
      'identity',
      'engagement_new',
      'ratings',
    ]);
    const count = scopes.filter((s) => s === 'pages_read_engagement').length;
    expect(count).toBe(1);
  });

  it('twitch engagement_new contributes no extra scopes (reuses identity grants)', () => {
    const identityOnly = scopesForProducts('twitch', ['identity']);
    const withEngagement = scopesForProducts('twitch', [
      'identity',
      'engagement_new',
    ]);
    expect(withEngagement.sort()).toEqual(identityOnly.sort());
  });
});

describe('fullScopesForPlatform regression vs legacy hardcoded scope sets', () => {
  it.each(Object.keys(LEGACY_FULL_SCOPES))(
    'union of all products for %s equals the legacy *_SCOPES array',
    (platform) => {
      const computed = fullScopesForPlatform(platform as never).sort();
      const expected = [...LEGACY_FULL_SCOPES[platform]].sort();
      expect(computed).toEqual(expected);
    },
  );
});

describe('defaultSelectedProducts + requiredProducts', () => {
  it('identity is in both required and default for every platform', () => {
    for (const p of PLATFORM_IDS) {
      expect(requiredProducts(p)).toContain('identity');
      expect(defaultSelectedProducts(p)).toContain('identity');
    }
  });

  it('facebook ads is NOT in defaults (opt-in)', () => {
    expect(defaultSelectedProducts('facebook')).not.toContain('ads');
  });

  it('youtube ads is NOT in defaults (opt-in)', () => {
    expect(defaultSelectedProducts('youtube')).not.toContain('ads');
  });
});
