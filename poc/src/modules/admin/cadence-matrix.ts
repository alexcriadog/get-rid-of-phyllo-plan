import { DEFAULT_FALLBACK_SECONDS } from '@modules/sync/cadence.service';
import {
  DEFAULT_REFRESH_INTERVAL_SECONDS,
  DEFAULT_REFRESH_WINDOW_DAYS,
} from '@modules/outbound-webhooks/refresh-cadence.service';

/**
 * Pure helpers behind the admin cadence editor. Kept free of Nest/Prisma so
 * the matrix logic (which products exist per platform, what the effective
 * default is for an unconfigured combo) is unit-testable without a DB.
 */

/** Minimal adapter surface the matrix needs to detect optional capabilities. */
export interface AdapterCapabilities {
  fetchStories?: unknown;
  fetchComments?: unknown;
  fetchMentions?: unknown;
}

/** Subset of a `cadences` row the matrix overlays onto the adapter universe. */
export interface CadenceRowLike {
  platform: string;
  product: string;
  defaultIntervalSeconds: number;
  refreshIntervalSeconds: number | null;
  refreshWindowDays: number | null;
  updatedAt: Date;
}

/** One row of the editor: effective values + whether they're persisted. */
export interface CadenceMatrixItem {
  platform: string;
  product: string;
  default_interval_seconds: number;
  sync_configured: boolean;
  refresh_interval_seconds: number;
  refresh_window_days: number;
  refresh_configured: boolean;
  updated_at: string | null;
}

/**
 * Products a given platform supports. identity/audience/engagement_new are
 * universal; stories/comments/mentions are capability-gated on the adapter;
 * ratings/ads are facebook-only side channels. Mirrors
 * ManualRefreshController.defaultProductsForAdapter — keep the two in sync.
 */
export function supportedProductsForAdapter(
  platform: string,
  adapter: AdapterCapabilities,
): string[] {
  const products = ['identity', 'audience', 'engagement_new'];
  if (typeof adapter.fetchStories === 'function') products.push('stories');
  if (typeof adapter.fetchComments === 'function') products.push('comments');
  if (typeof adapter.fetchMentions === 'function') products.push('mentions');
  if (platform === 'facebook') products.push('ratings', 'ads');
  return products;
}

/**
 * Build the full (platform × product) cadence matrix from the adapter registry,
 * overlaying any persisted `cadences` rows. Unconfigured combos surface with
 * the effective fallback intervals (24h sync / 6h refresh / 90d window) so they
 * are editable in the admin UI instead of being invisible. Sorted platform
 * asc, then product asc, for a stable render order.
 */
export function buildCadenceMatrix(
  adapters: Record<string, AdapterCapabilities>,
  rows: CadenceRowLike[],
): CadenceMatrixItem[] {
  const byKey = new Map(rows.map((r) => [`${r.platform}:${r.product}`, r]));
  const items: CadenceMatrixItem[] = [];

  for (const [platform, adapter] of Object.entries(adapters)) {
    for (const product of supportedProductsForAdapter(platform, adapter)) {
      const row = byKey.get(`${platform}:${product}`);
      items.push({
        platform,
        product,
        default_interval_seconds:
          row?.defaultIntervalSeconds ?? DEFAULT_FALLBACK_SECONDS,
        // A row always carries an explicit (NOT NULL) default interval, so its
        // mere existence means the sync cadence is configured.
        sync_configured: row != null,
        refresh_interval_seconds:
          row?.refreshIntervalSeconds ?? DEFAULT_REFRESH_INTERVAL_SECONDS,
        refresh_window_days:
          row?.refreshWindowDays ?? DEFAULT_REFRESH_WINDOW_DAYS,
        // Refresh fields are nullable — only "configured" once an interval is set.
        refresh_configured: row?.refreshIntervalSeconds != null,
        updated_at: row?.updatedAt.toISOString() ?? null,
      });
    }
  }

  items.sort(
    (a, b) =>
      a.platform.localeCompare(b.platform) ||
      a.product.localeCompare(b.product),
  );
  return items;
}
