// Map Twitch Helix / OAuth2 errors to the canonical adapter errors the sync
// worker reacts to:
//   - TokenRevokedError → account.status = 'needs_reauth' (no retry)
//   - RateLimitedError  → backoff with resetInMs jitter (no failure bump)
//   - AdapterFetchError → bump failure_count, retry per cadence
//
// Twitch's error shape (Helix + OAuth2 share it):
//   { error: 'Unauthorized', status: 401, message: 'OAuth token is missing' }
//
// 429 responses include a `Ratelimit-Reset` header (unix seconds when the
// bucket refills). We honour it when present; otherwise we use a conservative
// 60-second default since the Helix app bucket is 800 points / minute.

import {
  AdapterFetchError,
  RateLimitedError,
  TokenRevokedError,
} from '../platform-adapter.port';

interface TwitchErrorBody {
  error?: string;
  status?: number;
  message?: string;
}

interface AxiosLikeError {
  response?: {
    status?: number;
    data?: unknown;
    headers?: Record<string, string | string[] | undefined>;
  };
  message?: string;
}

const FALLBACK_429_RESET_MS = 60_000;

export function mapTwitchError(
  platform: string,
  endpoint: string,
  err: unknown,
  bucketKey: string,
): Error {
  const status = pickStatus(err);
  const body = pickBody(err);
  const message = body?.message ?? messageOf(err);

  if (status === 401 || /invalid oauth token|missing/i.test(message)) {
    return new TokenRevokedError(
      platform,
      endpoint,
      `Twitch rejected token on ${endpoint}: ${message || 'unauthorized'}`,
    );
  }

  if (status === 429) {
    const resetMs = parseRetryAfterMs(err) ?? FALLBACK_429_RESET_MS;
    return new RateLimitedError(
      platform,
      resetMs,
      bucketKey,
      `Twitch rate limit on ${endpoint}: retry in ${Math.round(resetMs / 1000)}s`,
    );
  }

  return new AdapterFetchError(platform, endpoint, err, undefined, body);
}

function pickStatus(err: unknown): number | undefined {
  const e = err as AxiosLikeError;
  return e?.response?.status;
}

function pickBody(err: unknown): TwitchErrorBody | undefined {
  const e = err as AxiosLikeError;
  const data = e?.response?.data;
  if (data && typeof data === 'object') return data as TwitchErrorBody;
  return undefined;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
}

function parseRetryAfterMs(err: unknown): number | null {
  const e = err as AxiosLikeError;
  const headers = e?.response?.headers ?? {};
  const reset = headers['ratelimit-reset'] ?? headers['Ratelimit-Reset'];
  const resetStr = Array.isArray(reset) ? reset[0] : reset;
  if (!resetStr) return null;
  const epochS = Number(resetStr);
  if (!Number.isFinite(epochS)) return null;
  const ms = epochS * 1000 - Date.now();
  return ms > 0 ? ms : null;
}
