import axios from 'axios';

export type ProductsConfig = Record<string, string[]> | null;

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
