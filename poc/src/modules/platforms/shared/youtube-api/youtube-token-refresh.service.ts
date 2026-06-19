// YouTube OAuth token refresh.
//
// Google issues short-lived access tokens (~1h) plus a refresh token. The
// refresh token is indefinite once the OAuth client is in "In production"
// status; in "Testing" it expires after 7 days. We refresh PROACTIVELY when
// the access token has < REFRESH_LEAD_TIME left, mirroring TikTok/Threads.
//
// Refresh endpoint: POST https://oauth2.googleapis.com/token
//   Form body: grant_type=refresh_token, refresh_token=..., client_id=...,
//              client_secret=...
//
// Google rarely rotates the refresh token (only on certain consent changes).
// When it does, we persist the new value alongside the new access token.

import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@shared/database/prisma.service';
import { AesLocalService } from '@shared/crypto/aes-local.service';
import { TokenHistoryService } from '@modules/tokens/token-history.service';
import { TokenLifecycleEmitter } from '@modules/outbound-webhooks/token-lifecycle-emitter.service';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REFRESH_LEAD_TIME_MS = 5 * 60_000;
const REFRESH_TIMEOUT_MS = 15_000;

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  refresh_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

@Injectable()
export class YoutubeTokenRefreshService {
  private readonly logger = new Logger(YoutubeTokenRefreshService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aes: AesLocalService,
    private readonly tokenHistory: TokenHistoryService,
    private readonly config: ConfigService,
    private readonly lifecycle: TokenLifecycleEmitter,
  ) {}

  async ensureFresh(
    accountId: bigint,
    currentAccessToken: string,
  ): Promise<string> {
    const row = await this.prisma.oAuthToken.findUnique({
      where: { accountId },
      select: { expiresAt: true, refreshTokenCiphertext: true },
    });
    if (!row || !row.expiresAt || !row.refreshTokenCiphertext) {
      return currentAccessToken;
    }
    if (row.expiresAt.getTime() - Date.now() > REFRESH_LEAD_TIME_MS) {
      return currentAccessToken;
    }
    try {
      const refreshToken = this.aes.decrypt(row.refreshTokenCiphertext);
      return await this.refresh(accountId, refreshToken);
    } catch (err) {
      this.logger.warn(
        `ensureFresh fell back to current token for account ${accountId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return currentAccessToken;
    }
  }

  async refresh(accountId: bigint, refreshToken: string): Promise<string> {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new Error(
        'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set to refresh YouTube tokens.',
      );
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const res = await axios.post<GoogleTokenResponse>(GOOGLE_TOKEN_URL, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: REFRESH_TIMEOUT_MS,
      validateStatus: () => true,
    });
    const body = res.data ?? {};
    if (res.status < 200 || res.status >= 300 || !body.access_token) {
      const errMsg = body.error_description ?? body.error ?? `HTTP ${res.status}`;
      this.logger.error(
        `YouTube refresh failed for account ${accountId.toString()}: ${errMsg}`,
      );
      await this.lifecycle.tokenRefreshFailed(accountId, { reason: errMsg });
      throw new Error(`YouTube token refresh failed: ${errMsg}`);
    }
    const expiresInS = typeof body.expires_in === 'number' ? body.expires_in : 0;
    const expiresAt = expiresInS > 0 ? new Date(Date.now() + expiresInS * 1000) : null;
    const newAccessCipher = this.aes.encrypt(body.access_token);
    const newRefreshCipher = body.refresh_token
      ? this.aes.encrypt(body.refresh_token)
      : undefined;

    await this.prisma.oAuthToken.update({
      where: { accountId },
      data: {
        accessTokenCiphertext: newAccessCipher,
        ...(newRefreshCipher ? { refreshTokenCiphertext: newRefreshCipher } : {}),
        expiresAt,
        lastRefreshedAt: new Date(),
      },
    });

    // Append the rotated token to the recovery history (best-effort).
    await this.tokenHistory.record(accountId, 'refresh');

    this.logger.log(
      `YouTube token refreshed for account ${accountId.toString()}; expires_in=${expiresInS}s`,
    );
    await this.lifecycle.tokenRefreshed(accountId, { expiresAt });
    return body.access_token;
  }
}
