// LinkedIn OAuth token refresh.
//
// LinkedIn access tokens last 60 days (5184000s). Programmatic refresh is
// only available when LinkedIn has enabled it for the app — detected at
// OAuth exchange time by the presence of `refresh_token` in the response
// (365-day TTL that does NOT reset on use). When the account row has no
// refresh token, this service is never called; the cron flags needs_reauth
// at expiry instead (Meta-style).
//
// Refresh endpoint: POST https://www.linkedin.com/oauth/v2/accessToken
//   Form body: grant_type=refresh_token, refresh_token=..., client_id=...,
//              client_secret=...

import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@shared/database/prisma.service';
import { AesLocalService } from '@shared/crypto/aes-local.service';
import { TokenHistoryService } from '@modules/tokens/token-history.service';
import { TokenLifecycleEmitter } from '@modules/outbound-webhooks/token-lifecycle-emitter.service';
import { TokenRefreshError } from '../token-refresh-error';
import { resolveRefreshExpiry } from '../token-refresh-expiry';
import type { LinkedInTokenResponse } from './linkedin-types';

/** Fallback access-token TTL when LinkedIn omits expires_in (60d). */
const DEFAULT_TOKEN_TTL_MS = 60 * 24 * 60 * 60_000;
const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
/** 60-day tokens: a 7-day lead gives a failed refresh days of hourly retries. */
const REFRESH_LEAD_TIME_MS = 7 * 24 * 60 * 60_000;
const REFRESH_TIMEOUT_MS = 15_000;

@Injectable()
export class LinkedInTokenRefreshService {
  private readonly logger = new Logger(LinkedInTokenRefreshService.name);

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
    const clientId = this.config.get<string>('LINKEDIN_CLIENT_ID');
    const clientSecret = this.config.get<string>('LINKEDIN_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new Error(
        'LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET must be set to refresh LinkedIn tokens.',
      );
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const res = await axios.post<LinkedInTokenResponse>(
      LINKEDIN_TOKEN_URL,
      params,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: REFRESH_TIMEOUT_MS,
        validateStatus: () => true,
        // Bypass any HTTPS_PROXY env var (OrbStack) — see linkedin-client.ts.
        proxy: false,
      },
    );
    const body = res.data ?? {};
    if (res.status < 200 || res.status >= 300 || !body.access_token) {
      const errMsg =
        body.error_description ?? body.error ?? `HTTP ${res.status}`;
      // LinkedIn returns 400 invalid_grant when the refresh token has expired
      // (fixed 365-day TTL, does not reset) or was revoked — terminal. Other
      // failures (5xx, network) are transient: retry, do not flag reauth.
      const permanent = body.error === 'invalid_grant';
      this.logger.error(
        `LinkedIn refresh failed for account ${accountId.toString()}: ${errMsg}`,
      );
      if (!permanent) {
        await this.lifecycle.tokenRefreshFailed(accountId, { reason: errMsg });
      }
      throw new TokenRefreshError(`LinkedIn token refresh failed: ${errMsg}`, permanent);
    }

    const expiresInS = typeof body.expires_in === 'number' ? body.expires_in : 0;
    const expiresAt = resolveRefreshExpiry(expiresInS, DEFAULT_TOKEN_TTL_MS);
    const newAccessCipher = this.aes.encrypt(body.access_token);
    // LinkedIn MAY return a new refresh_token; persist when present. The
    // refresh-token TTL does not reset — after ~365 days the member must
    // re-authorize via the full OAuth flow.
    const newRefreshCipher = body.refresh_token
      ? this.aes.encrypt(body.refresh_token)
      : undefined;
    const scopes = body.scope
      ? body.scope.split(/[ ,]/).filter(Boolean)
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

    // Append the rotated token to the recovery history (best-effort).
    await this.tokenHistory.record(accountId, 'refresh');

    this.logger.log(
      `LinkedIn token refreshed for account ${accountId.toString()}; expires_in=${expiresInS}s`,
    );
    await this.lifecycle.tokenRefreshed(accountId, { expiresAt });
    return body.access_token;
  }
}
