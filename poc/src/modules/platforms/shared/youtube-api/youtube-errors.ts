// Map googleapis (Gaxios) errors to the canonical adapter errors used by the
// sync worker. The worker treats:
//   - TokenRevokedError → mark account needs_reauth (don't retry)
//   - RateLimitedError → backoff with resetInMs jitter (don't bump failure_count)
//   - AdapterFetchError → bump failure_count, retry per cadence
//
// Google's error taxonomy is wider than Meta's; the relevant pieces:
//   - 401 invalid_credentials / invalid_grant → token dead
//   - 403 quotaExceeded / dailyLimitExceeded / userRateLimitExceeded /
//         rateLimitExceeded → quota wall
//   - 403 authError / forbidden / insufficientPermissions → token / scope
//   - 403 commentsDisabled → soft skip (handled per-call in the comments
//     fetcher; not reraised as a typed error)
//   - 5xx → transient
//
// References:
//   https://developers.google.com/youtube/v3/docs/errors
//   https://developers.google.com/youtube/analytics/v2/errors

import {
  AdapterFetchError,
  RateLimitedError,
  TokenRevokedError,
} from '../platform-adapter.port';

interface GaxiosLikeError {
  response?: {
    status?: number;
    data?: unknown;
    headers?: Record<string, string | string[] | undefined>;
  };
  code?: string | number;
  message?: string;
}

interface GoogleApiErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: Array<{
      domain?: string;
      reason?: string;
      message?: string;
      location?: string;
    }>;
  };
}

const QUOTA_REASONS = new Set([
  'quotaExceeded',
  'dailyLimitExceeded',
  'userRateLimitExceeded',
  'rateLimitExceeded',
  'queryRateLimitExceeded',
]);

// Reasons that mean "the token itself is dead" — flipping account.status to
// needs_reauth is appropriate. Notably we do NOT include:
//   - `forbidden`: YouTube returns 403 forbidden for legitimate per-resource
//     denials (private video, comments hidden on a specific video, etc.)
//   - `insufficientPermissions` / ACCESS_TOKEN_SCOPE_INSUFFICIENT: the token
//     is valid but the requested endpoint needs a scope we did not ask for
//     (e.g. commentThreads.list requires youtube.force-ssl on private videos
//     — we only request youtube.readonly + yt-analytics.readonly + monetary).
//     Other endpoints with the right scope still work, so the account is fine.
// `accessNotConfigured` IS a project-level API enablement issue — surface as
// needs_reauth so ops notices.
const AUTH_REASONS = new Set([
  'authError',
  'invalidCredentials',
  'unauthorized',
  'invalid_grant',
  'accessNotConfigured',
]);

export function isCommentsDisabled(err: unknown): boolean {
  const body = pickBody(err);
  return reasons(body).includes('commentsDisabled');
}

export function msUntilPacificMidnight(now: Date = new Date()): number {
  const PACIFIC_OFFSET_HOURS = 8;
  const utc = now.getTime();
  const pacific = utc - PACIFIC_OFFSET_HOURS * 3_600_000;
  const day = Math.floor(pacific / 86_400_000);
  const nextPacificMidnightUtc =
    (day + 1) * 86_400_000 + PACIFIC_OFFSET_HOURS * 3_600_000;
  return Math.max(60_000, nextPacificMidnightUtc - utc);
}

export function mapYoutubeError(
  platform: string,
  endpoint: string,
  err: unknown,
  bucketKey: string,
): Error {
  const status = pickStatus(err);
  const body = pickBody(err);
  const reasonsList = reasons(body);

  if (
    status === 401 ||
    reasonsList.some((r) => AUTH_REASONS.has(r)) ||
    /invalid_grant/i.test(messageOf(err))
  ) {
    return new TokenRevokedError(platform, endpoint);
  }

  if (status === 429 || reasonsList.some((r) => QUOTA_REASONS.has(r))) {
    return new RateLimitedError(
      platform,
      msUntilPacificMidnight(),
      bucketKey,
      `YouTube quota: ${reasonsList.join(',') || 'rateLimitExceeded'} on ${endpoint}`,
    );
  }

  return new AdapterFetchError(platform, endpoint, err, undefined, body);
}

function pickStatus(err: unknown): number | undefined {
  const e = err as GaxiosLikeError;
  return e?.response?.status;
}

function pickBody(err: unknown): GoogleApiErrorBody | undefined {
  const e = err as GaxiosLikeError;
  const data = e?.response?.data;
  if (data && typeof data === 'object') return data as GoogleApiErrorBody;
  return undefined;
}

function reasons(body: GoogleApiErrorBody | undefined): string[] {
  if (!body?.error?.errors) return [];
  return body.error.errors
    .map((e) => (typeof e?.reason === 'string' ? e.reason : null))
    .filter((r): r is string => r !== null);
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : '';
}
