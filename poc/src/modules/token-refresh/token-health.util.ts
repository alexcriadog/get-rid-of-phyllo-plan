// C-Token lifecycle hygiene: data-access window classification.
//
// Meta (FB/IG via FB-login) and Threads tokens carry an app-level
// `data_access_expires_at` (visible via /debug_token) that caps how long
// even a healthy long-lived token can READ data (~90 days). The refresh
// cron keeps the access token itself alive but cannot extend this window —
// once it passes, the operator/end-user must re-authenticate. These pure
// helpers classify the window state; TokenHealthCronService does the I/O.

/** Flag accounts whose data-access window closes within this many days. */
export const DATA_ACCESS_WARN_DAYS = 14;

const DAY_MS = 24 * 60 * 60_000;

export type DataAccessStatus = 'ok' | 'expiring' | 'expired' | 'unknown';

export interface DataAccessClassification {
  status: DataAccessStatus;
  /** Whole days until the window closes; 0 when expired; null when unknown. */
  daysLeft: number | null;
}

/**
 * Classify a data-access expiry timestamp relative to `nowMs`.
 *   - null            → 'unknown'  (platform never reported the field)
 *   - past            → 'expired'
 *   - < WARN_DAYS out → 'expiring'
 *   - otherwise       → 'ok'
 */
export function classifyDataAccess(
  expiresAtMs: number | null,
  nowMs: number,
): DataAccessClassification {
  if (expiresAtMs === null) return { status: 'unknown', daysLeft: null };
  const diffMs = expiresAtMs - nowMs;
  if (diffMs <= 0) return { status: 'expired', daysLeft: 0 };
  const daysLeft = Math.floor(diffMs / DAY_MS);
  return {
    status: daysLeft < DATA_ACCESS_WARN_DAYS ? 'expiring' : 'ok',
    daysLeft,
  };
}

/**
 * Extract `data.data_access_expires_at` (unix SECONDS) from a /debug_token
 * response body and convert to epoch ms. Meta sends 0 when the field does
 * not apply; treat 0 / missing / malformed as null (= unknown).
 */
export function parseDebugTokenDataAccessExpiry(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const data = (body as Record<string, unknown>)['data'];
  if (typeof data !== 'object' || data === null) return null;
  const raw = (data as Record<string, unknown>)['data_access_expires_at'];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
  return raw * 1000;
}
