import axios from 'axios';
import { getRedis } from './redis';
import { internalAuthHeader } from './poc-internal';

export type ProductsConfig = Record<string, string[]> | null;

// Workspace products config is read on every /api/oauth/start. It only
// changes when an operator edits the workspace in the admin UI, so a short
// Redis cache cuts the per-start round-trip to POC without making stale
// data linger. 5 min is well within tolerance for a config change to
// propagate.
const WS_CONFIG_TTL_SECONDS = 5 * 60;
const WS_CONFIG_PREFIX = 'wsconfig:';

// Catalog types — mirror poc/src/modules/accounts/products.catalog.ts. The
// shape comes over the wire via GET /internal/products-catalog (single
// source of truth lives in POC).
export interface ProductDef {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  default?: boolean;
  scopes: string[];
}

export interface ProductsCatalog {
  platforms: string[];
  products: string[];
  catalog: Record<string, ProductDef[]>;
}

/** Platforms a workspace offers, or null = all (no restriction). */
export function offeredPlatforms(config: ProductsConfig): string[] | null {
  if (config == null) return null;
  return Object.keys(config);
}

/**
 * Product keys to show (read-only) for a platform.
 * - null  → no restriction (caller uses the full catalog)
 * - []    → platform not offered
 * - else  → ['identity', ...configured] (identity always first, de-duped)
 */
export function displayProducts(config: ProductsConfig, platform: string): string[] | null {
  if (config == null) return null;
  if (!Object.prototype.hasOwnProperty.call(config, platform)) return [];
  const picked = (config[platform] ?? []).filter((p) => p !== 'identity');
  return ['identity', ...picked];
}

/**
 * Merge a per-connection product scope (from the signed SDK token's `products`
 * claim) OVER the workspace config, narrowing ONLY the platforms the scope
 * lists. Platforms the scope omits keep the workspace allow-list unchanged.
 *
 * The scope was already validated ⊆ the workspace ceiling at mint time, but the
 * workspace may have been tightened since, so we intersect defensively here too
 * (a product dropped from the workspace after mint is removed from the effective
 * scope). identity is always kept first.
 *
 * - scope absent/empty → return `workspaceConfig` unchanged (same reference).
 * - workspaceConfig null (legacy unrestricted) → the scope becomes the effective
 *   config for the listed platforms (already ⊆ catalog by mint).
 *
 * The result is a normal `ProductsConfig`, so every existing consumer
 * (computeOAuthScopes, displayProducts, platformReachableAtOAuthStart) works
 * on it unchanged.
 */
export function intersectConnectionProducts(
  workspaceConfig: ProductsConfig,
  connectionProducts: Record<string, ReadonlyArray<string>> | undefined,
): ProductsConfig {
  if (!connectionProducts || Object.keys(connectionProducts).length === 0) {
    return workspaceConfig;
  }
  const base: Record<string, string[]> = { ...(workspaceConfig ?? {}) };
  for (const [platform, requested] of Object.entries(connectionProducts)) {
    const ceiling = workspaceConfig?.[platform];
    const allowSet = ceiling ? new Set(ceiling) : null;
    const picked: string[] = [];
    for (const p of requested) {
      if (p === 'identity') continue;
      if (allowSet && !allowSet.has(p)) continue; // workspace tightened since mint
      if (!picked.includes(p)) picked.push(p);
    }
    base[platform] = ['identity', ...picked];
  }
  return base;
}

/**
 * Clamp a product list to a per-connection scope. Used by the seed handlers so
 * a tampered productIds POST can never enrol a product the signed connection
 * scope didn't grant. identity is always preserved.
 *
 * - scope undefined → products returned unchanged (no per-connection scope).
 * - else → products ∩ scope, identity-first.
 */
export function clampProductsToScope(
  products: ReadonlyArray<string>,
  scope: ReadonlyArray<string> | undefined,
): string[] {
  if (!scope) return [...products];
  const allow = new Set(scope);
  const trimmed = products.filter((p) => allow.has(p));
  if (!trimmed.includes('identity') && allow.has('identity')) {
    trimmed.unshift('identity');
  }
  return trimmed;
}

/**
 * Is `oauthPlatform` (the platform key in `/api/oauth/start/:platform`)
 * reachable for this workspace? Note that `facebook` is the OAuth surface
 * for *both* facebook and instagram (IG uses FB OAuth — see
 * lib/platforms.ts `startPlatform`), so when checking the OAuth-start URL
 * we accept the workspace if it offers *either*. Subsequent gates
 * (`seedAccount` chokepoint on POC) still reject mismatched seeds.
 */
export function platformReachableAtOAuthStart(
  config: ProductsConfig,
  oauthPlatform: string,
): boolean {
  if (config == null) return true;
  if (oauthPlatform === 'instagram_direct') {
    return Object.prototype.hasOwnProperty.call(config, 'instagram');
  }
  if (oauthPlatform === 'facebook') {
    return (
      Object.prototype.hasOwnProperty.call(config, 'facebook') ||
      Object.prototype.hasOwnProperty.call(config, 'instagram')
    );
  }
  return Object.prototype.hasOwnProperty.call(config, oauthPlatform);
}

/**
 * Server-only: fetch a workspace's products config from POC (null on any
 * failure). Backed by a 5-min Redis cache.
 *
 * IMPORTANT: only SUCCESSFUL fetches are cached — including a legitimate
 * `null` (= unrestricted workspace), stored as `{"products": null}`. A
 * failure (POC unreachable / non-200) returns null WITHOUT writing the
 * cache, so a transient POC blip can never get pinned as "unrestricted"
 * for 5 minutes and wrongly widen the OAuth scopes we request.
 *
 * The cache is best-effort: any Redis error (read or write, including a
 * missing REDIS_URL) is swallowed and we fall through to the live fetch.
 */
export async function fetchWorkspaceProducts(slug: string): Promise<ProductsConfig> {
  const baseUrl = process.env.POC_API_URL;
  if (!baseUrl) return null;

  const cacheKey = `${WS_CONFIG_PREFIX}${slug}`;
  try {
    const cached = await getRedis().get(cacheKey);
    if (cached !== null) {
      const env = JSON.parse(cached) as { products: ProductsConfig };
      return env.products ?? null;
    }
  } catch {
    // Cache miss-by-error — fall through to the live fetch.
  }

  try {
    const res = await axios.get<{ products: ProductsConfig }>(
      `${baseUrl}/internal/workspaces/${encodeURIComponent(slug)}/branding`,
      { timeout: 5_000, proxy: false, validateStatus: () => true, headers: { ...internalAuthHeader() } },
    );
    if (res.status !== 200) return null; // do NOT cache failures
    const products = res.data.products ?? null;
    try {
      await getRedis().set(
        cacheKey,
        JSON.stringify({ products }),
        'EX',
        WS_CONFIG_TTL_SECONDS,
      );
    } catch {
      // Cache write failure is non-fatal.
    }
    return products;
  } catch {
    return null; // network error — do NOT cache
  }
}

// In-process memo. The catalog is static at runtime (it only changes when
// POC redeploys with a new PLATFORM_CATALOG); refetch each cold start is
// enough. If POC is unreachable on the first call we cache `null` and the
// caller falls back to the legacy full-scope behaviour.
let _catalogPromise: Promise<ProductsCatalog | null> | null = null;

export function resetProductsCatalogCacheForTests(): void {
  _catalogPromise = null;
}

export function fetchProductsCatalog(): Promise<ProductsCatalog | null> {
  if (_catalogPromise) return _catalogPromise;
  _catalogPromise = (async () => {
    const baseUrl = process.env.POC_API_URL;
    if (!baseUrl) return null;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (process.env.CONNECT_TOOL_SECRET) {
      headers.authorization = `Bearer ${process.env.CONNECT_TOOL_SECRET}`;
    }
    try {
      const res = await axios.get<ProductsCatalog>(
        `${baseUrl}/internal/products-catalog`,
        { timeout: 5_000, proxy: false, headers, validateStatus: () => true },
      );
      return res.status === 200 ? res.data : null;
    } catch {
      return null;
    }
  })();
  return _catalogPromise;
}

/**
 * Minimal OAuth scope set for the given products on a platform — derived
 * from the catalog fetched from POC. Mirrors poc/src/modules/accounts/
 * products.catalog.ts:scopesForProducts. Required products' scopes are
 * always included; duplicates removed.
 */
export function scopesForProducts(
  catalog: ProductsCatalog,
  platform: string,
  products: ReadonlyArray<string>,
): string[] {
  const defs = catalog.catalog[platform] ?? [];
  const set = new Set<string>();
  for (const def of defs) {
    if (def.required || products.includes(def.id)) {
      for (const s of def.scopes) set.add(s);
    }
  }
  return [...set];
}

export function defaultSelectedProducts(
  catalog: ProductsCatalog,
  platform: string,
): string[] {
  const defs = catalog.catalog[platform] ?? [];
  return defs.filter((p) => p.required || p.default).map((p) => p.id);
}

export function requiredProducts(
  catalog: ProductsCatalog,
  platform: string,
): string[] {
  const defs = catalog.catalog[platform] ?? [];
  return defs.filter((p) => p.required).map((p) => p.id);
}

/**
 * Union of every product's scopes for the platform — the "ask for everything"
 * fallback used when there's no workspace.products restriction (legacy demo
 * flow that lands on /api/oauth/start without an SDK token, or during the
 * Phase C transition before backfill).
 */
export function fullScopesForPlatform(
  catalog: ProductsCatalog,
  platform: string,
): string[] {
  const defs = catalog.catalog[platform] ?? [];
  const set = new Set<string>();
  for (const def of defs) {
    for (const s of def.scopes) set.add(s);
  }
  return [...set];
}

// Scope-name mapping for the IG-direct OAuth surface ("Instagram API with
// Instagram Login"). The catalog's `instagram` entries carry FB-Login scope
// names; the direct flow uses the `instagram_business_*` equivalents.
// Page-scoped permissions have no Page in the direct flow and are dropped.
const IG_DIRECT_SCOPE_MAP: Record<string, string | null> = {
  instagram_basic: 'instagram_business_basic',
  instagram_manage_insights: 'instagram_business_manage_insights',
  instagram_manage_comments: 'instagram_business_manage_comments',
  pages_manage_metadata: null,
  pages_show_list: null,
  pages_read_engagement: null,
};

export function toIgDirectScopes(fbScopes: ReadonlyArray<string>): string[] {
  const out = new Set<string>();
  for (const s of fbScopes) {
    const mapped = Object.prototype.hasOwnProperty.call(IG_DIRECT_SCOPE_MAP, s)
      ? IG_DIRECT_SCOPE_MAP[s]
      : s;
    if (mapped) out.add(mapped);
  }
  return [...out];
}

/**
 * Pick the OAuth scope set to request for this (catalog, workspace, platform).
 *
 * - workspace.products = null  → no restriction → request the platform's full
 *   scope set (legacy demo flow without an SDK token; also the transitional
 *   default before the Phase C backfill makes products NOT NULL).
 * - workspace.products = {...} → minimum set covering the enabled products.
 * - Facebook OAuth covers Instagram too — union scopes from both buckets so
 *   a workspace that only enables `instagram` still gets IG scopes.
 */
export function computeOAuthScopes(
  catalog: ProductsCatalog,
  config: ProductsConfig,
  platform: string,
): string[] {
  // IG-direct: same `instagram` product bucket as FB-login, different scope
  // names on the consent screen. Workspace config stays keyed by platform
  // ('instagram'), never by flow.
  if (platform === 'instagram_direct') {
    const fbNamed =
      config === null
        ? fullScopesForPlatform(catalog, 'instagram')
        : scopesForProducts(catalog, 'instagram', config.instagram ?? []);
    return toIgDirectScopes(fbNamed);
  }
  if (config === null) {
    if (platform === 'facebook') {
      return [
        ...new Set([
          ...fullScopesForPlatform(catalog, 'facebook'),
          ...fullScopesForPlatform(catalog, 'instagram'),
        ]),
      ];
    }
    return fullScopesForPlatform(catalog, platform);
  }
  if (platform === 'facebook') {
    const fb = config.facebook ?? [];
    const ig = config.instagram ?? [];
    return [
      ...new Set([
        ...scopesForProducts(catalog, 'facebook', fb),
        ...scopesForProducts(catalog, 'instagram', ig),
      ]),
    ];
  }
  const products = config[platform] ?? [];
  return scopesForProducts(catalog, platform, products);
}
