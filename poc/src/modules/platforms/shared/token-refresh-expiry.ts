// Resolve the new `expiresAt` after a SUCCESSFUL token refresh.
//
// NEVER returns null. A null expiresAt would exclude the row from both the
// proactive refresh cron (which keys off expiresAt) and fetch-time
// ensureFresh — silently disabling refresh for that account until a sync
// happens to hit a 401 (edge 4). So when the provider omits `expires_in` (or
// reports a non-positive value) we fall back to the platform's documented
// token lifetime, keeping a forward-looking expiry the sweep can act on.

/**
 * @param expiresInS  `expires_in` from the token response, in seconds.
 * @param fallbackMs  platform's documented token TTL, used when expiresInS is
 *                    missing / non-positive.
 * @param nowMs       clock injection point for tests; defaults to Date.now().
 */
export function resolveRefreshExpiry(
  expiresInS: number | undefined,
  fallbackMs: number,
  nowMs: number = Date.now(),
): Date {
  const ttlMs =
    typeof expiresInS === 'number' && expiresInS > 0
      ? expiresInS * 1000
      : fallbackMs;
  return new Date(nowMs + ttlMs);
}
