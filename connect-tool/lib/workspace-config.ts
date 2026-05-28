import axios from 'axios';

export type ProductsConfig = Record<string, string[]> | null;

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
  if (oauthPlatform === 'facebook') {
    return (
      Object.prototype.hasOwnProperty.call(config, 'facebook') ||
      Object.prototype.hasOwnProperty.call(config, 'instagram')
    );
  }
  return Object.prototype.hasOwnProperty.call(config, oauthPlatform);
}

/** Server-only: fetch a workspace's products config from POC (null on any failure). */
export async function fetchWorkspaceProducts(slug: string): Promise<ProductsConfig> {
  const baseUrl = process.env.POC_API_URL;
  if (!baseUrl) return null;
  try {
    const res = await axios.get<{ products: ProductsConfig }>(
      `${baseUrl}/internal/workspaces/${encodeURIComponent(slug)}/branding`,
      { timeout: 5_000, proxy: false, validateStatus: () => true },
    );
    return res.status === 200 ? (res.data.products ?? null) : null;
  } catch {
    return null;
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
