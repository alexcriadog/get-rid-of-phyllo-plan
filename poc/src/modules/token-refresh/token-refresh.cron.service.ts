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
import { LinkedInTokenRefreshService } from '@modules/platforms/shared/linkedin-api/linkedin-token-refresh.service';
import { isIgDirect } from '@modules/platforms/shared/meta-graph/ig-direct';
import { TokenRefreshError } from '@modules/platforms/shared/token-refresh-error';
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
// Login-only platforms: the access token intentionally lapses right after
// connect (X: 2h, no offline.access requested) and is never used again.
// Excluded at the query level — otherwise every run would re-scan their
// permanently-expired rows, sorted FIRST by `expiresAt asc`, crowding the
// batch ahead of tokens that actually need refreshing.
const LOGIN_ONLY = ['twitter'];
// LinkedIn: 60-day access token. refresh_token (365d) only exists when
// LinkedIn enabled programmatic refresh for the app — rows that have one
// refresh with the 7-day lead; rows without behave like Meta (needs_reauth
// once expired).
const LINKEDIN = new Set(['linkedin']);

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
    private readonly linkedin: LinkedInTokenRefreshService,
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
        // Only connected accounts. Excludes disconnected / needs_reauth (no
        // point) but includes syncTier='paused' on purpose — a paused
        // account's token must stay alive for when it resumes.
        account: { is: { status: 'ready', platform: { notIn: LOGIN_ONLY } } },
        // Sweep tokens due within the horizon AND tokens with an UNKNOWN
        // expiry (null). A null expiresAt would otherwise be excluded from
        // every proactive path forever (edge 4): the refreshable branches
        // below refresh it once to re-establish a real expiry, while
        // Meta-family null rows fall through to the harmless `else → skipped`.
        OR: [{ expiresAt: { lte: horizon } }, { expiresAt: null }],
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
      const expiresAt = row.expiresAt; // may be null — see the query OR note
      const hasExpiry = expiresAt !== null;
      const msToExpiry = hasExpiry ? expiresAt.getTime() - now.getTime() : Infinity;
      // A null/unknown expiry is NOT "expired" (treating it as expired would
      // wrongly flag Meta accounts that can't be refreshed) — but for the
      // refreshable platforms below it IS treated as due, so we refresh once
      // and re-establish a real expiresAt (edge 4).
      const expired = hasExpiry && msToExpiry <= 0;

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
          if (hasExpiry && msToExpiry > THREADS_LEAD_MS) {
            result.skipped += 1; // not due yet — 7-day lead on a 60-day token
            continue;
          }
          await this.igDirect.refresh(
            accountId,
            this.aes.decrypt(Buffer.from(row.accessTokenCiphertext)),
          );
          result.refreshed += 1;
          this.metrics.incr('token_refresh_cron_refreshed', {
            platform: metricPlatform,
          });
        } else if (REFRESHABLE.has(platform)) {
          const lead = platform === 'threads' ? THREADS_LEAD_MS : SHORT_LEAD_MS;
          if (hasExpiry && msToExpiry > lead) {
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
        } else if (LINKEDIN.has(platform)) {
          if (row.refreshTokenCiphertext) {
            if (hasExpiry && msToExpiry > THREADS_LEAD_MS) {
              result.skipped += 1; // 7-day lead on a 60-day token
              continue;
            }
            await this.linkedin.refresh(
              accountId,
              this.aes.decrypt(Buffer.from(row.refreshTokenCiphertext)),
            );
            result.refreshed += 1;
            this.metrics.incr('token_refresh_cron_refreshed', { platform });
          } else if (expired) {
            await this.flagNeedsReauth(
              accountId,
              'linkedin token expired and app has no programmatic refresh — re-authentication required',
            );
            result.reauthFlagged += 1;
            this.metrics.incr('token_refresh_cron_reauth', { platform });
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
        const msg = err instanceof Error ? err.message : String(err);
        // Act on WHY the refresh failed, not on whether the access token
        // happens to be expired. A PERMANENT failure (revoked / invalid_grant
        // / token-dead OAuthException) can only be recovered by re-auth, so
        // flag it now — even with days of lead left — instead of retrying for
        // the whole window. A TRANSIENT failure (5xx / network / timeout, or
        // anything a service couldn't confidently classify) might clear on its
        // own, so we retry next hour and NEVER flag needs_reauth — even once
        // the token has lapsed. Flagging on a passing outage would bounce a
        // healthy account to needs_reauth, which the cron then stops sweeping,
        // so it can't self-heal and the end-user is forced to reconnect.
        const permanent = err instanceof TokenRefreshError && err.permanent;
        if (permanent) {
          this.metrics.incr('token_refresh_cron_reauth', { platform: metricPlatform });
          try {
            await this.flagNeedsReauth(
              accountId,
              `${platform} token refresh permanently failed: ${msg}`,
            );
            result.reauthFlagged += 1;
          } catch {
            // Couldn't persist the flag — count it and let the next run retry.
            result.failed += 1;
          }
        } else {
          result.failed += 1;
          this.metrics.incr('token_refresh_cron_failed', { platform: metricPlatform });
          this.logger.warn(
            `Token refresh failed (transient) for account ${accountId.toString()} (${platform}): ${msg}`,
          );
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
