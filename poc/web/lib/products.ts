// Shared product ordering for the admin account views. The connector enrols a
// per-account subset of products (now also narrowable per connection via the
// SDK token's `products` claim), so the UI must render each account's ACTUAL
// products rather than a hardcoded list. This keeps the order stable across the
// accounts list + detail pages.

/** Canonical product order, mirrors poc/src/modules/accounts/products.catalog.ts. */
export const PRODUCT_ORDER = [
  'identity',
  'audience',
  'engagement_new',
  'engagement_deep',
  'stories',
  'mentions',
  'comments',
  'ratings',
  'ads',
] as const;

/** Extract the product ids from the admin API's `products` payload (array or map). */
export function productIdsOf(
  raw:
    | ReadonlyArray<{ product?: string | null }>
    | Record<string, unknown>
    | null
    | undefined,
): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((p) => p.product)
      .filter((p): p is string => typeof p === 'string' && p.length > 0);
  }
  return Object.keys(raw);
}

/** De-dupe + sort product ids by the canonical order; unknown ids sort last, A→Z. */
export function orderProducts(ids: Iterable<string>): string[] {
  const rank = (p: string): number => {
    const i = (PRODUCT_ORDER as ReadonlyArray<string>).indexOf(p);
    return i === -1 ? PRODUCT_ORDER.length : i;
  };
  return Array.from(new Set(ids)).sort(
    (a, b) => rank(a) - rank(b) || a.localeCompare(b),
  );
}
