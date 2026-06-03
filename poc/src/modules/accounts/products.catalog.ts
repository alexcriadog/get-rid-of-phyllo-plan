// Single source of truth for platforms × products × OAuth scopes.
//
// Consumers:
//   - accounts.service.ts (PRODUCTS_BY_PLATFORM): what products to seed for an account
//   - workspaces.service.ts (resolveWorkspaceProducts): per-workspace allow-list resolution
//   - admin-saas.controller.ts (PLATFORM_IDS / PRODUCT_IDS): Zod enum validation on PATCH
//     /admin/workspaces/:slug/products
//   - poc/web/pages/admin/workspaces/[slug].tsx via GET /internal/products-catalog:
//     UI checkbox grid (labels + required + default flags)
//   - connect-tool/app/api/oauth/[...slug]/route.ts via the same endpoint:
//     computes minimal OAuth scope set per workspace using scopesForProducts()
//
// When adding a new product or scope, update the PLATFORM_CATALOG below — the
// derived helpers (PRODUCTS_BY_PLATFORM, scopesForProducts) and downstream
// consumers pick it up automatically.

export type Platform =
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'threads'
  | 'youtube'
  | 'twitch';

export type ProductId =
  | 'identity'
  | 'audience'
  | 'engagement_new'
  | 'engagement_deep'
  | 'stories'
  | 'mentions'
  | 'comments'
  | 'ratings'
  | 'ads';

export const PLATFORM_IDS = [
  'instagram',
  'facebook',
  'tiktok',
  'threads',
  'youtube',
  'twitch',
] as const satisfies ReadonlyArray<Platform>;

export const PRODUCT_IDS = [
  'identity',
  'audience',
  'engagement_new',
  'engagement_deep',
  'stories',
  'mentions',
  'comments',
  'ratings',
  'ads',
] as const satisfies ReadonlyArray<ProductId>;

export interface ProductDef {
  readonly id: ProductId;
  readonly label: string;
  readonly hint?: string;
  // identity is `required: true` on every platform — the data model assumes
  // an account always has an identity snapshot. Required products are
  // included in scopesForProducts() unconditionally and rendered as disabled
  // checkboxes in the admin UI.
  readonly required?: boolean;
  // `default: true` → checkbox starts ticked when an admin creates a new
  // workspace's product allow-list. `default: false` → opt-in (e.g. ads).
  readonly default?: boolean;
  // OAuth scopes this product needs from the provider. Empty array means
  // the product reuses scopes from another product on the same platform
  // (e.g. youtube.engagement_new reuses youtube.readonly from identity).
  readonly scopes: ReadonlyArray<string>;
}

// Per-platform catalog. The product → scope mapping is derived from each
// provider's adapter (see poc/src/modules/platforms/<platform>/<platform>.adapter.ts)
// and the legacy hardcoded scope arrays in connect-tool/lib/platforms.ts. The
// invariant we preserve: union of scopes across all products for a platform
// equals the legacy full-scope set, so workspaces with all-products enabled
// get the same consent screen they used to.
export const PLATFORM_CATALOG: Readonly<
  Record<Platform, ReadonlyArray<ProductDef>>
> = {
  facebook: [
    {
      id: 'identity',
      label: 'Profile',
      hint: 'Page metadata',
      required: true,
      default: true,
      // pages_show_list → list the user's pages. instagram_basic is here
      // because the FB OAuth also enrolls connected IG business accounts in
      // the same flow; identity is the minimum for either side to resolve.
      scopes: ['pages_show_list', 'instagram_basic'],
    },
    {
      id: 'audience',
      label: 'Audience',
      hint: 'Country + city distribution',
      default: true,
      // read_insights is NOT deprecated despite the v22 rebrand — Meta still
      // requires it for /post/insights on Pages where the OAuth user is not
      // the page owner (BC-managed agency pages most commonly).
      scopes: ['read_insights', 'instagram_manage_insights'],
    },
    {
      id: 'engagement_new',
      label: 'Posts + metrics',
      hint: 'Reactions, comments, reach',
      default: true,
      scopes: ['pages_read_engagement', 'pages_manage_metadata'],
    },
    {
      id: 'stories',
      label: 'Stories',
      hint: 'Page Stories API (24h-expiring)',
      default: true,
      // pages_manage_metadata: enables the Page->app webhook subscription that
      // also activates IG story delivery (story_insights is an app-level field).
      scopes: ['pages_read_user_content', 'pages_manage_metadata'],
    },
    {
      id: 'mentions',
      label: 'Tagged posts (UGC)',
      hint: '/tagged — needs pages_read_user_content',
      default: true,
      scopes: ['pages_read_user_content', 'pages_manage_metadata'],
    },
    {
      id: 'comments',
      label: 'Comments',
      hint: 'With user identity',
      default: true,
      scopes: ['pages_read_user_content', 'pages_manage_metadata'],
    },
    {
      id: 'ratings',
      label: 'Page reviews',
      hint: 'Star ratings + recommendation text',
      default: true,
      scopes: ['pages_read_engagement'],
    },
    {
      id: 'ads',
      label: 'Ad insights',
      hint: 'ads_read — needs USER token',
      default: false,
      scopes: ['ads_read', 'business_management'],
    },
  ],
  instagram: [
    // Instagram OAuth is folded into Facebook's authorize flow; scopes here
    // are FB scopes that gate the IG-specific endpoints. scopesForProducts()
    // de-dupes when both fb + ig are enabled.
    {
      id: 'identity',
      label: 'Profile',
      required: true,
      default: true,
      scopes: ['instagram_basic'],
    },
    {
      id: 'audience',
      label: 'Audience',
      default: true,
      scopes: ['instagram_manage_insights'],
    },
    {
      id: 'engagement_new',
      label: 'Posts + metrics',
      default: true,
      scopes: ['instagram_manage_insights', 'pages_manage_metadata'],
    },
    {
      id: 'stories',
      label: 'Stories',
      default: true,
      // pages_manage_metadata: enables the Page->app webhook subscription that
      // also activates IG story delivery (story_insights is an app-level field).
      scopes: ['instagram_manage_insights', 'pages_manage_metadata'],
    },
  ],
  tiktok: [
    {
      id: 'identity',
      label: 'Profile',
      required: true,
      default: true,
      // user.info.basic returns open_id (required by the v2 user-scoped
      // endpoints); user.info.profile + user.account.type round out the
      // identity snapshot the adapter writes.
      scopes: ['user.info.basic', 'user.info.profile', 'user.account.type'],
    },
    {
      id: 'audience',
      label: 'Audience',
      default: true,
      scopes: ['user.info.stats', 'user.insights'],
    },
    {
      id: 'engagement_new',
      label: 'Videos + metrics',
      default: true,
      scopes: ['video.list', 'video.insights'],
    },
    {
      id: 'comments',
      label: 'Comments on top videos',
      default: true,
      scopes: ['comment.list'],
    },
  ],
  threads: [
    {
      id: 'identity',
      label: 'Profile',
      required: true,
      default: true,
      scopes: ['threads_basic'],
    },
    {
      id: 'audience',
      label: 'Audience',
      default: true,
      scopes: ['threads_manage_insights'],
    },
    {
      id: 'engagement_new',
      label: 'Threads + metrics',
      default: true,
      scopes: ['threads_manage_insights'],
    },
    {
      id: 'comments',
      label: 'Replies',
      default: true,
      scopes: ['threads_read_replies'],
    },
    {
      id: 'mentions',
      label: 'Mentions (@-tags)',
      default: true,
      scopes: ['threads_manage_insights'],
    },
  ],
  youtube: [
    {
      id: 'identity',
      label: 'Channel info',
      required: true,
      default: true,
      scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
    },
    {
      id: 'audience',
      label: 'Audience',
      hint: 'Analytics API',
      default: true,
      scopes: ['https://www.googleapis.com/auth/yt-analytics.readonly'],
    },
    {
      id: 'engagement_new',
      label: 'Videos + metrics',
      default: true,
      // Reuses youtube.readonly granted by identity; no extra scope.
      scopes: [],
    },
    {
      id: 'engagement_deep',
      label: 'Per-video analytics',
      hint: 'Watch time, retention, traffic sources',
      default: true,
      scopes: ['https://www.googleapis.com/auth/yt-analytics.readonly'],
    },
    {
      id: 'comments',
      label: 'Comments on top videos',
      default: true,
      // Reuses youtube.readonly.
      scopes: [],
    },
    {
      id: 'ads',
      label: 'Ad insights',
      hint: 'Requires linked ads access',
      default: false,
      scopes: ['https://www.googleapis.com/auth/yt-analytics-monetary.readonly'],
    },
  ],
  twitch: [
    {
      id: 'identity',
      label: 'Channel + followers + subs',
      hint: 'Profile, follower count, subscriber count + tier breakdown',
      required: true,
      default: true,
      scopes: [
        'user:read:email',
        'moderator:read:followers',
        'channel:read:subscriptions',
      ],
    },
    {
      id: 'engagement_new',
      label: 'VODs + clips',
      hint: 'Past broadcasts and recent clips with view counts',
      default: true,
      // Helix VOD/clip endpoints are public read; no extra scope beyond
      // identity's user:read:email.
      scopes: [],
    },
  ],
};

/**
 * Day 1 sync_jobs target. Derived from PLATFORM_CATALOG so adding a product
 * to the catalog automatically enrolls it on seed.
 */
export const PRODUCTS_BY_PLATFORM: Readonly<
  Record<Platform, ReadonlyArray<string>>
> = Object.fromEntries(
  PLATFORM_IDS.map((p) => [p, PLATFORM_CATALOG[p].map((def) => def.id)]),
) as unknown as Record<Platform, ReadonlyArray<string>>;

/**
 * Minimal OAuth scope set for the given products on a platform. Required
 * products (identity) are included unconditionally; their scopes are folded
 * into the result even if the caller omits them. De-duplicated.
 */
export function scopesForProducts(
  platform: Platform,
  products: ReadonlyArray<ProductId>,
): string[] {
  const defs = PLATFORM_CATALOG[platform];
  const set = new Set<string>();
  for (const def of defs) {
    if (def.required || products.includes(def.id)) {
      for (const s of def.scopes) set.add(s);
    }
  }
  return [...set];
}

/**
 * Full scope set for a platform — union of all products' scopes. Used as
 * the backwards-compat fallback for workspaces in transition (products
 * still null pre-backfill).
 */
export function fullScopesForPlatform(platform: Platform): string[] {
  const set = new Set<string>();
  for (const def of PLATFORM_CATALOG[platform]) {
    for (const s of def.scopes) set.add(s);
  }
  return [...set];
}

export function defaultSelectedProducts(platform: Platform): ProductId[] {
  return PLATFORM_CATALOG[platform]
    .filter((p) => p.required || p.default)
    .map((p) => p.id);
}

export function requiredProducts(platform: Platform): ProductId[] {
  return PLATFORM_CATALOG[platform]
    .filter((p) => p.required)
    .map((p) => p.id);
}
