const GATED_PREFIXES = [
  '/showroom',
  '/account/',
  '/watchlist',
  '/admin',
  '/api/admin/',
  '/api/showroom/',
];

/**
 * True when a path requires an operator session. Pure + unit-testable —
 * kept free of next/server imports so it can be tested in isolation and
 * reused by both the middleware and any server route that needs the check.
 */
export function isGated(pathname: string): boolean {
  // Web's internal `/` (dev only; in prod `/` is connect-tool) — gate exact root.
  if (pathname === '/') return true;
  return GATED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}
