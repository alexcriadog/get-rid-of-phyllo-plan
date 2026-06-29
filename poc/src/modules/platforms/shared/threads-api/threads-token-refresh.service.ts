// Threads long-lived user token refresh.
//
// Threads issues long-lived user tokens that last ~60 days. Calling
// `GET /refresh_access_token?grant_type=th_refresh_token&access_token=<long>`
// returns a NEW long-lived token (the same shape — Threads doesn't use a
// separate refresh_token like TikTok). The token must be:
//   - long-lived already (short-lived 1h tokens cannot refresh — they need
//     to be exchanged via /access_token?grant_type=th_exchange_token instead)
//   - older than 24h (Meta blocks refreshes within the first day)
//   - not yet expired
//
// We refresh PROACTIVELY when expiresAt is within REFRESH_LEAD_TIME of now,
// at the top of every adapter fetch (mirroring TikTokTokenRefreshService).
// Behaviour mirrors that service: missing creds / missing expiresAt /
// transient errors all soft-fail to the current token rather than burning
// the whole sync.

import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@shared/database/prisma.service';
import { AesLocalService } from '@shared/crypto/aes-local.service';
import { TokenHistoryService } from '@modules/tokens/token-history.service';
import { TokenLifecycleEmitter } from '@modules/outbound-webhooks/token-lifecycle-emitter.service';
import { TokenRefreshError } from '../token-refresh-error';
import { resolveRefreshExpiry } from '../token-refresh-expiry';
import { isTokenDeadGraphBody } from '../meta-graph/graph-errors';

/** Fallback token TTL when Threads omits expires_in (60d long-lived token). */
const DEFAULT_TOKEN_TTL_MS = 60 * 24 * 60 * 60_000;
const THREADS_REFRESH_URL = 'https://graph.threads.net/refresh_access_token';
const THREADS_EXCHANGE_URL = 'https://graph.threads.net/access_token';
// Refresh when within this window of expiry. 7d gives the worker plenty of
// retry budget if Threads is degraded; long-lived tokens last 60d total.
const REFRESH_LEAD_TIME_MS = 7 * 24 * 60 * 60_000;
const REFRESH_TIMEOUT_MS = 15_000;

interface ThreadsTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; code?: number; error_subcode?: number };
}

@Injectable()
export class ThreadsTokenRefreshService {
  private readonly logger = new Logger(ThreadsTokenRefreshService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aes: AesLocalService,
    private readonly tokenHistory: TokenHistoryService,
    private readonly config: ConfigService,
    private readonly lifecycle: TokenLifecycleEmitter,
  ) {}

  /**
   * Returns a guaranteed-fresh access token for the given account.
   *   - If the row has no `expiresAt`, return current token unchanged. We
   *     don't know when it's due so refreshing blindly risks burning a
   *     short-lived token (Threads rejects refresh on those).
   *   - If `expiresAt - now > REFRESH_LEAD_TIME_MS`, return current token.
   *   - Otherwise, refresh, persist, return the new plaintext.
   */
  async ensureFresh(
    accountId: bigint,
    currentAccessToken: string,
  ): Promise<string> {
    const row = await this.prisma.oAuthToken.findUnique({
      where: { accountId },
      select: { expiresAt: true },
    });
    if (!row || !row.expiresAt) {
      // No expiry signal — treat the token as opaque and don't burn a
      // refresh call (which might fail loudly if it's still short-lived).
      return currentAccessToken;
    }
    if (row.expiresAt.getTime() - Date.now() > REFRESH_LEAD_TIME_MS) {
      return currentAccessToken;
    }
    try {
      return await this.refresh(accountId, currentAccessToken);
    } catch (err) {
      this.logger.warn(
        `ensureFresh fell back to current token for account ${accountId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return currentAccessToken;
    }
  }

  /**
   * Force-refresh — used internally when ensureFresh decides it's time.
   * Public so an admin "refresh now" controller can trigger it explicitly.
   * Bypasses the lead-time check.
   */
  async refresh(accountId: bigint, currentAccessToken: string): Promise<string> {
    const res = await axios.get<ThreadsTokenResponse>(THREADS_REFRESH_URL, {
      params: {
        grant_type: 'th_refresh_token',
        access_token: currentAccessToken,
      },
      timeout: REFRESH_TIMEOUT_MS,
      validateStatus: () => true,
    });
    const body = res.data ?? {};
    if (res.status < 200 || res.status >= 300 || !body.access_token) {
      const errMsg = body.error?.message ?? `HTTP ${res.status}`;
      // Meta-family token-dead OAuthException (code 190 / dead subcodes) is
      // terminal — only re-auth recovers it, so the cron flags needs_reauth.
      // Other failures (5xx, network) are transient and retried hourly.
      const permanent = isTokenDeadGraphBody(body);
      this.logger.error(
        `Threads refresh failed for account ${accountId.toString()}: ${errMsg}`,
      );
      // On a transient failure emit token.refresh_failed (ensureFresh falls
      // back to the current token; the next tick retries). On a permanent one
      // we stay silent here — the cron fires the terminal token.expired.
      if (!permanent) {
        await this.lifecycle.tokenRefreshFailed(accountId, { reason: errMsg });
      }
      throw new TokenRefreshError(`Threads token refresh failed: ${errMsg}`, permanent);
    }
    const expiresInS = typeof body.expires_in === 'number' ? body.expires_in : 0;
    const expiresAt = resolveRefreshExpiry(expiresInS, DEFAULT_TOKEN_TTL_MS);
    const newAccessCipher = this.aes.encrypt(body.access_token);

    await this.prisma.oAuthToken.update({
      where: { accountId },
      data: {
        accessTokenCiphertext: newAccessCipher,
        expiresAt,
        lastRefreshedAt: new Date(),
      },
    });

    // Append the rotated token to the recovery history (best-effort).
    await this.tokenHistory.record(accountId, 'refresh');

    this.logger.log(
      `Threads token refreshed for account ${accountId.toString()}; expires_in=${expiresInS}s`,
    );
    await this.lifecycle.tokenRefreshed(accountId, { expiresAt });
    return body.access_token;
  }

  /**
   * Exchange a SHORT-LIVED Threads token (1h, returned by the OAuth flow) for
   * a LONG-LIVED one (60d). This is a different endpoint and requires the
   * app secret — NOT the refresh endpoint. Called from the seed flow so that
   * what we persist is always a long-lived token.
   *
   * Returns the long-lived `access_token` plaintext + `expires_in` seconds.
   * Throws if the app secret isn't configured or upstream rejects.
   */
  async exchangeShortLived(
    shortLivedToken: string,
  ): Promise<{ accessToken: string; expiresInS: number | null }> {
    const clientSecret = this.config.get<string>('THREADS_APP_SECRET');
    if (!clientSecret) {
      throw new Error(
        'THREADS_APP_SECRET must be set to exchange a short-lived Threads token for a long-lived one.',
      );
    }
    const res = await axios.get<ThreadsTokenResponse>(THREADS_EXCHANGE_URL, {
      params: {
        grant_type: 'th_exchange_token',
        client_secret: clientSecret,
        access_token: shortLivedToken,
      },
      timeout: REFRESH_TIMEOUT_MS,
      validateStatus: () => true,
    });
    const body = res.data ?? {};
    if (res.status < 200 || res.status >= 300 || !body.access_token) {
      const errMsg = body.error?.message ?? `HTTP ${res.status}`;
      throw new Error(`Threads exchange failed: ${errMsg}`);
    }
    return {
      accessToken: body.access_token,
      expiresInS:
        typeof body.expires_in === 'number' ? body.expires_in : null,
    };
  }
}
