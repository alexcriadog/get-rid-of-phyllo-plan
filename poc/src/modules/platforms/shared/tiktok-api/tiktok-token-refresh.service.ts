// TikTok Business Center / Login Kit token refresh.
//
// TikTok issues short-lived access tokens (~24h for BC, 24h for Login Kit)
// alongside a longer-lived refresh token (~365 days). The refresh endpoint
// returns a new pair of access + refresh — refresh tokens rotate, you must
// persist the new one each time.
//
// We refresh PROACTIVELY when expiresAt is within REFRESH_LEAD_TIME of now,
// at the top of every adapter fetch. That avoids the worker hitting a
// 40100/40104 mid-sync and degrading to needs_reauth.

import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '@shared/database/prisma.service';
import { AesLocalService } from '@shared/crypto/aes-local.service';
import { TokenHistoryService } from '@modules/tokens/token-history.service';
import { ConfigService } from '@nestjs/config';
import { TokenLifecycleEmitter } from '@modules/outbound-webhooks/token-lifecycle-emitter.service';

const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const REFRESH_LEAD_TIME_MS = 5 * 60_000;     // refresh if expires within 5 min
const REFRESH_TIMEOUT_MS = 15_000;

interface TikTokTokenRefreshResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;          // seconds, of access token
  refresh_expires_in?: number;  // seconds, of refresh token
  open_id?: string;
  scope?: string;
  token_type?: string;
  error?: string | { code?: string; message?: string };
  error_description?: string;
  message?: string;
}

@Injectable()
export class TikTokTokenRefreshService {
  private readonly logger = new Logger(TikTokTokenRefreshService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aes: AesLocalService,
    private readonly tokenHistory: TokenHistoryService,
    private readonly config: ConfigService,
    private readonly lifecycle: TokenLifecycleEmitter,
  ) {}

  /**
   * Returns a guaranteed-fresh access token for the given account.
   *
   * - If the row has no `refreshTokenCiphertext` (e.g. Meta-only account
   *   that just happens to be on the TikTok adapter — shouldn't happen,
   *   but defensive), returns `currentAccessToken` unchanged.
   * - If `expiresAt - now > REFRESH_LEAD_TIME_MS`, returns
   *   `currentAccessToken` unchanged.
   * - Otherwise, calls the TikTok refresh endpoint, persists the new
   *   ciphertexts + expiresAt, and returns the freshly-decrypted access
   *   token.
   *
   * Concurrency note: two workers refreshing the same account at the same
   * instant is rare (concurrency=1 by product, throttle lock 10 min), but if
   * it happened both would write and the last-writer-wins. Both new tokens
   * are valid until the next rotation, so no functional harm — just a
   * wasted refresh call.
   */
  async ensureFresh(
    accountId: bigint,
    currentAccessToken: string,
  ): Promise<string> {
    const row = await this.prisma.oAuthToken.findUnique({
      where: { accountId },
      select: {
        refreshTokenCiphertext: true,
        expiresAt: true,
      },
    });
    if (!row || !row.refreshTokenCiphertext) {
      return currentAccessToken;
    }
    // Without expiresAt we have no signal that the token is expiring soon —
    // assume it's fine and avoid burning a refresh call (and a potential
    // failure if TIKTOK_CLIENT_* aren't configured). A reactive 40100/40104
    // path can still trigger refresh() explicitly when needed.
    if (!row.expiresAt) {
      return currentAccessToken;
    }
    if (row.expiresAt.getTime() - Date.now() > REFRESH_LEAD_TIME_MS) {
      return currentAccessToken;
    }
    // Proactive refresh requested. Soft-fail if creds aren't configured —
    // the worker should sync with the current (still-valid) token rather
    // than fail the whole job. The reactive 401 path remains strict.
    try {
      return await this.refresh(accountId, Buffer.from(row.refreshTokenCiphertext));
    } catch (err) {
      this.logger.warn(
        `ensureFresh fell back to current token for account ${accountId.toString()}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return currentAccessToken;
    }
  }

  /**
   * Force-refresh — used on a 40100/40104 reactive fallback path. Bypasses
   * the lead-time check.
   */
  async refresh(accountId: bigint, refreshCipher: Buffer): Promise<string> {
    const clientKey = this.config.get<string>('TIKTOK_CLIENT_KEY');
    const clientSecret = this.config.get<string>('TIKTOK_CLIENT_SECRET');
    if (!clientKey || !clientSecret) {
      throw new Error(
        'TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET must be set to refresh TikTok tokens',
      );
    }
    const refreshToken = this.aes.decrypt(refreshCipher);
    const params = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const res = await axios.post<TikTokTokenRefreshResponse>(
      TIKTOK_TOKEN_URL,
      params.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: REFRESH_TIMEOUT_MS,
        validateStatus: () => true,
      },
    );
    const body = res.data ?? {};
    const errMsg = this.extractError(body, res.status);
    if (errMsg) {
      this.logger.error(
        `TikTok refresh failed for account ${accountId.toString()}: ${errMsg}`,
      );
      await this.lifecycle.tokenRefreshFailed(accountId, { reason: errMsg });
      throw new Error(`TikTok token refresh failed: ${errMsg}`);
    }
    if (!body.access_token || !body.refresh_token) {
      const detail = 'response missing access_token/refresh_token';
      await this.lifecycle.tokenRefreshFailed(accountId, { reason: detail });
      throw new Error(
        `TikTok refresh response missing tokens: ${JSON.stringify(body).slice(0, 200)}`,
      );
    }
    const expiresInS = typeof body.expires_in === 'number' ? body.expires_in : 0;
    const expiresAt = expiresInS > 0 ? new Date(Date.now() + expiresInS * 1000) : null;
    const newAccessCipher = this.aes.encrypt(body.access_token);
    const newRefreshCipher = this.aes.encrypt(body.refresh_token);

    await this.prisma.oAuthToken.update({
      where: { accountId },
      data: {
        accessTokenCiphertext: newAccessCipher,
        refreshTokenCiphertext: newRefreshCipher,
        expiresAt,
        lastRefreshedAt: new Date(),
      },
    });

    // Append the rotated token to the recovery history (best-effort).
    await this.tokenHistory.record(accountId, 'refresh');

    this.logger.log(
      `TikTok token refreshed for account ${accountId.toString()}; expires_in=${expiresInS}s`,
    );
    await this.lifecycle.tokenRefreshed(accountId, { expiresAt });
    return body.access_token;
  }

  private extractError(
    body: TikTokTokenRefreshResponse,
    httpStatus: number,
  ): string | null {
    if (httpStatus < 200 || httpStatus >= 300) {
      const err = typeof body.error === 'string' ? body.error : body.error?.message;
      return `HTTP ${httpStatus}: ${err ?? body.error_description ?? body.message ?? 'unknown error'}`;
    }
    if (body.error && typeof body.error === 'object' && body.error.code && body.error.code !== 'ok') {
      return `${body.error.code}: ${body.error.message ?? ''}`.trim();
    }
    if (typeof body.error === 'string' && body.error !== '' && body.error !== 'ok') {
      return body.error;
    }
    return null;
  }
}
