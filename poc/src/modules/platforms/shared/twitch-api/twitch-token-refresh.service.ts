// Twitch OAuth token refresh.
//
// Twitch user access tokens last ~14_124s (≈4h). Refresh tokens are LONG-
// LIVED but ROTATE on every refresh — the new pair must replace the old one
// or the previous refresh_token stops working immediately.
//
// Refresh endpoint: POST https://id.twitch.tv/oauth2/token
//   Form body: grant_type=refresh_token, refresh_token=..., client_id=...,
//              client_secret=...
//
// We refresh proactively when the access token has < REFRESH_LEAD_TIME left,
// matching the YouTube / TikTok pattern.

import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@shared/database/prisma.service';
import { AesLocalService } from '@shared/crypto/aes-local.service';
import { TokenLifecycleEmitter } from '@modules/outbound-webhooks/token-lifecycle-emitter.service';
import { TokenRefreshError } from '../token-refresh-error';
import { resolveRefreshExpiry } from '../token-refresh-expiry';

/** Fallback access-token TTL when Twitch omits expires_in (~4h). */
const DEFAULT_TOKEN_TTL_MS = 4 * 60 * 60_000;
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const REFRESH_LEAD_TIME_MS = 5 * 60_000;
const REFRESH_TIMEOUT_MS = 15_000;

interface TwitchTokenRefreshResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string[] | string;
  token_type?: string;
  status?: number;
  message?: string;
}

@Injectable()
export class TwitchTokenRefreshService {
  private readonly logger = new Logger(TwitchTokenRefreshService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aes: AesLocalService,
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
    const clientId = this.config.get<string>('TWITCH_CLIENT_ID');
    const clientSecret = this.config.get<string>('TWITCH_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new Error(
        'TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET must be set to refresh Twitch tokens.',
      );
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const res = await axios.post<TwitchTokenRefreshResponse>(
      TWITCH_TOKEN_URL,
      params,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: REFRESH_TIMEOUT_MS,
        validateStatus: () => true,
        // Bypass any HTTPS_PROXY env var (OrbStack injects a local proxy
        // that mangles HTTPS — see twitch-client.ts for the full story).
        proxy: false,
      },
    );
    const body = res.data ?? {};
    if (res.status < 200 || res.status >= 300 || !body.access_token) {
      const errMsg = body.message ?? `HTTP ${res.status}`;
      // Twitch answers 400 "Invalid refresh token" once the refresh token is
      // revoked, rotated-away, or expired — terminal. A 403 invalid-client is
      // our own config and 5xx are transient: retry, don't flag reauth.
      const permanent =
        res.status === 400 && /invalid refresh token/i.test(body.message ?? '');
      this.logger.error(
        `Twitch refresh failed for account ${accountId.toString()}: ${errMsg}`,
      );
      if (!permanent) {
        await this.lifecycle.tokenRefreshFailed(accountId, { reason: errMsg });
      }
      throw new TokenRefreshError(`Twitch token refresh failed: ${errMsg}`, permanent);
    }

    const expiresInS = typeof body.expires_in === 'number' ? body.expires_in : 0;
    const expiresAt = resolveRefreshExpiry(expiresInS, DEFAULT_TOKEN_TTL_MS);
    const newAccessCipher = this.aes.encrypt(body.access_token);
    // Twitch ROTATES the refresh_token on every refresh — the old one stops
    // working immediately. Persist the new one or the next refresh will fail.
    const newRefreshCipher = body.refresh_token
      ? this.aes.encrypt(body.refresh_token)
      : undefined;
    const scopes = Array.isArray(body.scope)
      ? body.scope
      : typeof body.scope === 'string'
        ? body.scope.split(' ')
        : undefined;

    await this.prisma.oAuthToken.update({
      where: { accountId },
      data: {
        accessTokenCiphertext: newAccessCipher,
        ...(newRefreshCipher ? { refreshTokenCiphertext: newRefreshCipher } : {}),
        expiresAt,
        lastRefreshedAt: new Date(),
        ...(scopes ? { scopes } : {}),
      },
    });
    this.logger.log(
      `Twitch token refreshed for account ${accountId.toString()}; expires_in=${expiresInS}s`,
    );
    await this.lifecycle.tokenRefreshed(accountId, { expiresAt });
    return body.access_token;
  }
}
