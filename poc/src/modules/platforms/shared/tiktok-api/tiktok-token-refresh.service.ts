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
import { ConfigService } from '@nestjs/config';

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
    private readonly config: ConfigService,
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
    if (
      row.expiresAt &&
      row.expiresAt.getTime() - Date.now() > REFRESH_LEAD_TIME_MS
    ) {
      return currentAccessToken;
    }
    return this.refresh(accountId, Buffer.from(row.refreshTokenCiphertext));
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
      throw new Error(`TikTok token refresh failed: ${errMsg}`);
    }
    if (!body.access_token || !body.refresh_token) {
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
    this.logger.log(
      `TikTok token refreshed for account ${accountId.toString()}; expires_in=${expiresInS}s`,
    );
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
