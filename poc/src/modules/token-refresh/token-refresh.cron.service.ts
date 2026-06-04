// B-1: proactive token-refresh cron.
//
// Fetch-time refresh (each adapter's `ensureFresh`) only fires when a sync
// actually runs, with a tight 5-min lead. So a PAUSED or quiet account never
// triggers it and its access token silently dies — for the rotating-refresh
// platforms it can even become unrecoverable. This cron closes that gap: once
// an hour it scans OAuthToken.expiresAt and proactively refreshes tokens that
// are about to expire, independent of sync activity.
//
// Per-platform behaviour:
//   - tiktok / twitch / youtube: short-lived access tokens with a long-lived
//     refresh token. We force-refresh when within SHORT_LEAD_MS of expiry.
//   - threads: 60-day long-lived token, refreshable only WHILE still valid.
//     We refresh with a 7-day lead (THREADS_LEAD_MS) so a failed attempt has
//     days of hourly retries before the token actually dies.
//   - facebook / instagram via FB-login (Meta): NOT refreshable — once
//     expired we flip the account to needs_reauth and fire token.expired.
//   - instagram via IG-direct (metadata.oauth_flow='ig_direct'): 60-day
//     long-lived token refreshable like Threads — 7-day lead, hourly retries.
//
// Copies the proven cron shape from WebhooksDigestService: api-process gate +
// runWithLock distributed lock + UTC @Cron.

import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ulid } from 'ulid';
import { PrismaService } from '@shared/database/prisma.service';
import { RedisService } from '@shared/redis/redis.service';
import { AesLocalService } from '@shared/crypto/aes-local.service';
import { runWithLock } from '@shared/redis/cron-lock';
import { TokenLifecycleEmitter } from '@modules/outbound-webhooks/token-lifecycle-emitter.service';
import { TikTokTokenRefreshService } from '@modules/platforms/shared/tiktok-api/tiktok-token-refresh.service';
import { TwitchTokenRefreshService } from '@modules/platforms/shared/twitch-api/twitch-token-refresh.service';
import { YoutubeTokenRefreshService } from '@modules/platforms/shared/youtube-api/youtube-token-refresh.service';
import { ThreadsTokenRefreshService } from '@modules/platforms/shared/threads-api/threads-token-refresh.service';
import { InstagramDirectTokenRefreshService } from '@modules/platforms/shared/instagram-api/instagram-direct-token-refresh.service';
import { isIgDirect } from '@modules/platforms/shared/meta-graph/ig-direct';
import { MetricsService } from '@shared/metrics/metrics.service';

/** Refresh short-lived access tokens this far ahead of expiry. */
const SHORT_LEAD_MS = 90 * 60_000; // 90 min
/** Threads long-lived tokens: refresh days early (must be alive to refresh). */
const THREADS_LEAD_MS = 7 * 24 * 60 * 60_000; // 7 days
/** Widest lead — the DB scan horizon. */
const SCAN_HORIZON_MS = THREADS_LEAD_MS;
/** Max rows handled per run; soonest-to-expire first. */
const BATCH_SIZE = 500;
/** Lock TTL must exceed worst-case run time (500 sequential refresh calls). */
const LOCK_TTL_MS = 10 * 60_000;

const REFRESHABLE = new Set(['tiktok', 'twitch', 'youtube', 'threads']);
const META = new Set(['facebook', 'instagram']);

interface RefreshRunResult {
  scanned: number;
  refreshed: number;
  reauthFlagged: number;
  failed: number;
  skipped: number;
}

const EMPTY_RESULT: RefreshRunResult = {
  scanned: 0,
  refreshed: 0,
  reauthFlagged: 0,
  failed: 0,
  skipped: 0,
};

@Injectable()
export class TokenRefreshCronService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TokenRefreshCronService.name);
  // Unique per process — identifies who holds the lock for safe release.
  private readonly instanceToken = ulid();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly aes: AesLocalService,
    private readonly metrics: MetricsService,
    private readonly lifecycle: TokenLifecycleEmitter,
    private readonly tiktok: TikTokTokenRefreshService,
    private readonly twitch: TwitchTokenRefreshService,
    private readonly youtube: YoutubeTokenRefreshService,
    private readonly threads: ThreadsTokenRefreshService,
    private readonly igDirect: InstagramDirectTokenRefreshService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.argv[2] !== 'api') {
      this.logger.debug('Token-refresh cron lives on the api process — no-op bootstrap');
      return;
    }
    this.logger.log('Token-refresh cron scheduled: hourly at :15 UTC');
  }

  @Cron('15 * * * *', { name: 'token-refresh', timeZone: 'UTC' })
  async refreshExpiringTokens(): Promise<RefreshRunResult> {
    if (process.argv[2] !== 'api') return EMPTY_RESULT;
    const res = await runWithLock(
      this.redis.client,
      this.redis.key('cron', 'token-refresh'),
      this.instanceToken,
      LOCK_TTL_MS,
      () => this.run(),
    );
    if (!res.ran) {
      this.logger.debug('Token-refresh skipped — lock held by another instance');
      return EMPTY_RESULT;
    }
    return res.result ?? EMPTY_RESULT;
  }

  private async run(): Promise<RefreshRunResult> {
    const now = new Date();
    const horizon = new Date(now.getTime() + SCAN_HORIZON_MS);

    const rows = await this.prisma.oAuthToken.findMany({
      where: {
        expiresAt: { not: null, lte: horizon },
        // Only connected accounts. Excludes disconnected / needs_reauth (no
        // point) but includes syncTier='paused' on purpose — a paused
        // account's token must stay alive for when it resumes.
        account: { is: { status: 'ready' } },
      },
      select: {
        accountId: true,
        expiresAt: true,
        refreshTokenCiphertext: true,
        accessTokenCiphertext: true,
        account: { select: { platform: true, metadata: true } },
      },
      orderBy: { expiresAt: 'asc' },
      take: BATCH_SIZE,
    });

    const result: RefreshRunResult = { ...EMPTY_RESULT, scanned: rows.length };

    for (const row of rows) {
      const platform = row.account.platform;
      const accountId = row.accountId;
      const expiresAt = row.expiresAt; // not-null guaranteed by the query
      const msToExpiry = expiresAt ? expiresAt.getTime() - now.getTime() : Infinity;
      const expired = msToExpiry <= 0;

      // IG-direct accounts are platform 'instagram' but behave like Threads:
      // long-lived token, refreshable while alive, 7-day lead. Classified
      // BEFORE the META branch — only metadata distinguishes the two flows.
      const igDirectRow =
        platform === 'instagram' &&
        isIgDirect(row.account.metadata as Record<string, unknown> | null);
      // Metric label: keep failure/refresh series consistent — IG-direct
      // events must not land in the FB-login 'instagram' bucket.
      const metricPlatform = igDirectRow ? 'instagram_direct' : platform;

      try {
        if (igDirectRow) {
          if (msToExpiry > THREADS_LEAD_MS) {
            result.skipped += 1; // not due yet — 7-day lead on a 60-day token
          } else {
            await this.igDirect.refresh(
              accountId,
              this.aes.decrypt(Buffer.from(row.accessTokenCiphertext)),
            );
            result.refreshed += 1;
            this.metrics.incr('token_refresh_cron_refreshed', {
              platform: metricPlatform,
            });
          }
        } else if (REFRESHABLE.has(platform)) {
          const lead = platform === 'threads' ? THREADS_LEAD_MS : SHORT_LEAD_MS;
          if (msToExpiry > lead) {
            result.skipped += 1; // not due yet for this platform's window
            continue;
          }
          const did = await this.dispatchRefresh(platform, accountId, row);
          if (did) {
            result.refreshed += 1;
            this.metrics.incr('token_refresh_cron_refreshed', { platform });
          } else {
            result.skipped += 1;
          }
        } else if (META.has(platform)) {
          // Meta can't be refreshed; only act once the token is actually dead.
          if (expired) {
            await this.flagNeedsReauth(
              accountId,
              `${platform} token expired (proactive sweep) — re-authentication required`,
            );
            result.reauthFlagged += 1;
            this.metrics.incr('token_refresh_cron_reauth', { platform });
          } else {
            result.skipped += 1;
          }
        } else {
          result.skipped += 1;
        }
      } catch (err) {
        result.failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        this.metrics.incr('token_refresh_cron_failed', { platform: metricPlatform });
        this.logger.warn(
          `Token refresh failed for account ${accountId.toString()} (${platform}): ${msg}`,
        );
        // If the token is already expired and the refresh failed, it's dead —
        // tell the client to re-auth rather than leaving it silently broken.
        if (expired) {
          try {
            await this.flagNeedsReauth(
              accountId,
              `${platform} token refresh failed and token has expired: ${msg}`,
            );
            result.reauthFlagged += 1;
          } catch {
            // best-effort; next run retries
          }
        }
      }
    }

    if (result.scanned > 0) {
      this.logger.log(
        `Token-refresh sweep: scanned=${result.scanned} refreshed=${result.refreshed} ` +
          `reauth=${result.reauthFlagged} failed=${result.failed} skipped=${result.skipped}`,
      );
    }
    if (result.scanned === BATCH_SIZE) {
      this.logger.warn(
        `Token-refresh hit the ${BATCH_SIZE}-row batch cap — more tokens may be due; next hourly run continues.`,
      );
    }
    return result;
  }

  /**
   * Force-refresh via the platform's own refresh service (each re-reads +
   * persists its own row). Returns false when the row lacks the credential
   * the platform needs (can't refresh). Mirrors the argument each service's
   * own `ensureFresh` passes to `refresh`.
   */
  private async dispatchRefresh(
    platform: string,
    accountId: bigint,
    row: { refreshTokenCiphertext: Uint8Array | null; accessTokenCiphertext: Uint8Array },
  ): Promise<boolean> {
    switch (platform) {
      case 'tiktok':
        if (!row.refreshTokenCiphertext) return false;
        await this.tiktok.refresh(accountId, Buffer.from(row.refreshTokenCiphertext));
        return true;
      case 'twitch':
        if (!row.refreshTokenCiphertext) return false;
        await this.twitch.refresh(
          accountId,
          this.aes.decrypt(Buffer.from(row.refreshTokenCiphertext)),
        );
        return true;
      case 'youtube':
        if (!row.refreshTokenCiphertext) return false;
        await this.youtube.refresh(
          accountId,
          this.aes.decrypt(Buffer.from(row.refreshTokenCiphertext)),
        );
        return true;
      case 'threads':
        // Threads refreshes the long-lived token itself (no separate refresh
        // token) — pass the decrypted current access token.
        await this.threads.refresh(
          accountId,
          this.aes.decrypt(Buffer.from(row.accessTokenCiphertext)),
        );
        return true;
      default:
        return false;
    }
  }

  private async flagNeedsReauth(accountId: bigint, reason: string): Promise<void> {
    await this.prisma.account.update({
      where: { id: accountId },
      data: { status: 'needs_reauth' },
    });
    await this.lifecycle.tokenExpired(accountId, { reason });
  }
}
