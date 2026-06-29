// IG-direct long-lived token refresh ("Instagram API with Instagram Login").
//
// IG-direct issues 60-day long-lived user tokens that — unlike FB-login Meta
// tokens — CAN be refreshed: `GET graph.instagram.com/refresh_access_token
// ?grant_type=ig_refresh_token&access_token=<long>` returns a NEW 60-day
// token. Constraints (same family as Threads):
//   - token must be long-lived already (connect-tool exchanges at seed time)
//   - older than 24h (non-issue: the cron refreshes with a 7-day lead on a
//     60-day token, so it's ~53 days old by then)
//   - not yet expired
//
// Invoked by TokenRefreshCronService for accounts where platform =
// 'instagram' AND metadata.oauth_flow = 'ig_direct'. FB-login IG accounts
// keep the legacy needs_reauth-on-expiry behaviour. No fetch-time
// ensureFresh for v1 — the hourly cron with a 7-day lead is ample margin
// for a 60-day token.

import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '@shared/database/prisma.service';
import { AesLocalService } from '@shared/crypto/aes-local.service';
import { TokenHistoryService } from '@modules/tokens/token-history.service';
import { TokenLifecycleEmitter } from '@modules/outbound-webhooks/token-lifecycle-emitter.service';
import { TokenRefreshError } from '../token-refresh-error';
import { resolveRefreshExpiry } from '../token-refresh-expiry';
import { isTokenDeadGraphBody } from '../meta-graph/graph-errors';

/** Fallback token TTL when IG-direct omits expires_in (60d long-lived token). */
const DEFAULT_TOKEN_TTL_MS = 60 * 24 * 60 * 60_000;
const IG_DIRECT_REFRESH_URL = 'https://graph.instagram.com/refresh_access_token';
const REFRESH_TIMEOUT_MS = 15_000;

interface IgDirectTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; code?: number; error_subcode?: number };
}

@Injectable()
export class InstagramDirectTokenRefreshService {
  private readonly logger = new Logger(InstagramDirectTokenRefreshService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aes: AesLocalService,
    private readonly tokenHistory: TokenHistoryService,
    private readonly lifecycle: TokenLifecycleEmitter,
  ) {}

  /**
   * Force-refresh the long-lived IG-direct token and persist the rotation.
   * Returns the new plaintext token. Throws on upstream rejection (the cron
   * logs + counts the failure and retries next hour).
   */
  async refresh(accountId: bigint, currentAccessToken: string): Promise<string> {
    const res = await axios.get<IgDirectTokenResponse>(IG_DIRECT_REFRESH_URL, {
      params: {
        grant_type: 'ig_refresh_token',
        access_token: currentAccessToken,
      },
      timeout: REFRESH_TIMEOUT_MS,
      validateStatus: () => true,
    });
    const body = res.data ?? {};
    if (res.status < 200 || res.status >= 300 || !body.access_token) {
      const errMsg = body.error?.message ?? `HTTP ${res.status}`;
      // Meta-family token-dead OAuthException (code 190 / dead subcodes) is
      // terminal — the cron flags needs_reauth. Other failures (5xx, network)
      // are transient and retried on the next hourly sweep.
      const permanent = isTokenDeadGraphBody(body);
      this.logger.error(
        `IG-direct refresh failed for account ${accountId.toString()}: ${errMsg}`,
      );
      if (!permanent) {
        await this.lifecycle.tokenRefreshFailed(accountId, { reason: errMsg });
      }
      throw new TokenRefreshError(`IG-direct token refresh failed: ${errMsg}`, permanent);
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
      `IG-direct token refreshed for account ${accountId.toString()}; expires_in=${expiresInS}s`,
    );
    await this.lifecycle.tokenRefreshed(accountId, { expiresAt });
    return body.access_token;
  }
}
