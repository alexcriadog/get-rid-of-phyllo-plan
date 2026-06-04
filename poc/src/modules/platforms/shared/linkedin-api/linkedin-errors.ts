// Map LinkedIn REST/v2 errors to the canonical adapter errors:
//   - TokenRevokedError → account.status = 'needs_reauth' (no retry)
//   - RateLimitedError  → backoff (LinkedIn quotas reset at midnight UTC;
//     no Retry-After / rate headers are documented, so we back off until
//     the next UTC midnight, capped to keep the worker responsive)
//   - AdapterFetchError → bump failure_count, retry per cadence
//
// LinkedIn error body: { status, message, serviceErrorCode }.
// 401 = invalid/expired token. 65601 = REVOKED_ACCESS_TOKEN (can ride a 400).
// 403 = product/permission mismatch — NOT a dead token; keep it AdapterFetch
// so identity keeps syncing when one product's permission is missing.

import {
  AdapterFetchError,
  RateLimitedError,
  TokenRevokedError,
} from '../platform-adapter.port';

interface LinkedInErrorBody {
  status?: number;
  message?: string;
  serviceErrorCode?: number;
}

interface AxiosLikeError {
  response?: { status?: number; data?: unknown };
  message?: string;
}

const REVOKED_SERVICE_CODES = new Set([65600, 65601, 65602]);
const MAX_429_BACKOFF_MS = 6 * 60 * 60_000; // 6h cap — daily quota, slow cadences

export function mapLinkedInError(
  platform: string,
  endpoint: string,
  err: unknown,
  bucketKey: string,
): Error {
  const e = err as AxiosLikeError;
  const status = e?.response?.status;
  const body =
    e?.response?.data && typeof e.response.data === 'object'
      ? (e.response.data as LinkedInErrorBody)
      : undefined;
  const message = body?.message ?? messageOf(err);

  if (
    status === 401 ||
    (body?.serviceErrorCode !== undefined &&
      REVOKED_SERVICE_CODES.has(body.serviceErrorCode))
  ) {
    return new TokenRevokedError(
      platform,
      endpoint,
      `LinkedIn rejected token on ${endpoint}: ${message || 'unauthorized'}`,
    );
  }

  if (status === 429) {
    return new RateLimitedError(
      platform,
      msUntilNextUtcMidnight(),
      bucketKey,
      `LinkedIn throttled ${endpoint}: daily quota resets at midnight UTC`,
    );
  }

  return new AdapterFetchError(platform, endpoint, err, undefined, body);
}

function msUntilNextUtcMidnight(): number {
  const now = new Date();
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  const ms = next - now.getTime();
  return Math.min(Math.max(ms, 60_000), MAX_429_BACKOFF_MS);
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : '';
}
