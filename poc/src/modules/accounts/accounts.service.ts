import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import { AesLocalService } from '@shared/crypto/aes-local.service';

const META_GRAPH = 'https://graph.facebook.com/v22.0';
const NORMALIZE_TIMEOUT_MS = 15_000;

export type Platform =
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'threads'
  | 'youtube'
  | 'twitch';

export interface SeedAccountInput {
  platform: Platform;
  accessToken: string;
  /** TikTok issues rotating refresh tokens; persist when provided. */
  refreshToken?: string;
  /** Token expiry — TikTok defaults to ~24h; lets the refresh service know
   * when to ask for a new pair before the next call. */
  expiresAt?: Date;
  canonicalUserId: string;
  handle?: string;
  /**
   * Free-form per-platform context bag persisted to `account.metadata`.
   *   - Meta: `{ page_id, ig_business_id }`
   *   - TikTok: `{ business_id, open_id, advertiser_id?, scopes? }`
   * Adapters read this via their own context builders.
   */
  metadata?: Record<string, unknown>;
}

export interface SeedAccountResult {
  account_id: string;
  sync_jobs_created: string[];
}

/**
 * Products we create sync_jobs for on seed. Day 1 we just write these rows —
 * Day 2 the scheduler picks them up.
 */
const PRODUCTS_BY_PLATFORM: Record<Platform, ReadonlyArray<string>> = {
  instagram: ['identity', 'audience', 'engagement_new', 'stories'],
  // Page Stories API is GA in v22 — see FacebookAdapter.fetchStories.
  // pages_read_user_content (May 2026 grant) unlocked `mentions` (/tagged),
  // user-identity in `comments`, and Page `ratings`. ads_read added `ads`.
  // public_pages monitor (PPCA) is NOT a per-account product — it's a
  // separate watchlist on `public_page_snapshots`.
  facebook: [
    'identity',
    'audience',
    'engagement_new',
    'stories',
    'mentions',
    'comments',
    'ratings',
    'ads',
  ],
  // TikTok BC v1.3: stories don't exist; mentions probe pending.
  tiktok: ['identity', 'audience', 'engagement_new', 'comments'],
  // Threads has no stories. /me/mentioned_threads is the mentions surface.
  threads: ['identity', 'audience', 'engagement_new', 'comments', 'mentions'],
  // YouTube: no stories, no mentions surface in the public API.
  // engagement_deep: per-video Analytics drill-down + retention curve.
  // ads: Google Ads campaigns (requires GOOGLE_ADS_DEVELOPER_TOKEN).
  youtube: [
    'identity',
    'audience',
    'engagement_new',
    'engagement_deep',
    'comments',
    'ads',
  ],
  // Twitch: VODs + clips only (no live tracking). Followers + subscriber
  // counts live inside the `identity` snapshot because Helix doesn't expose
  // demographic distributions. No engagement_deep (no Analytics API), no
  // comments (chat is real-time), no ads (no revenue $ via Helix), no
  // stories/mentions/ratings (concepts don't exist on Twitch).
  twitch: ['identity', 'engagement_new'],
};

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aes: AesLocalService,
  ) {}

  async seedAccount(input: SeedAccountInput): Promise<SeedAccountResult> {
    const allProducts = PRODUCTS_BY_PLATFORM[input.platform];
    if (!allProducts) {
      throw new Error(`Unsupported platform: ${input.platform}`);
    }

    // connect-tool (and any future caller) can scope which products to
    // seed by passing `metadata.products: string[]`. Unknown ids are
    // silently dropped; a fully-empty list after filtering is rejected
    // because it'd produce an account with zero sync jobs.
    const requestedRaw = input.metadata?.['products'];
    const requested = Array.isArray(requestedRaw)
      ? (requestedRaw as unknown[]).filter(
          (p): p is string => typeof p === 'string',
        )
      : null;
    const products = requested
      ? requested.filter((p) => allProducts.includes(p))
      : allProducts;
    if (products.length === 0) {
      throw new BadRequestException(
        `metadata.products yielded no valid products for ${input.platform}. ` +
          `Allowed: ${allProducts.join(', ')}`,
      );
    }

    // For Meta family (FB + IG) we MUST end up persisting a Page token so
    // calls don't get charged against the App-Level rate limit (200 ×
    // users/h). User tokens reach this method via the ManualForm in
    // /admin/connect, the public POST /accounts/seed, and helper scripts —
    // every path lands here, which is why the normalization belongs at this
    // chokepoint instead of in any single caller.
    //
    // We also remember the user-level token: ads_read needs USER scope, so
    // FB needs both. Stored side-by-side; resolved per-product downstream.
    const isMeta =
      input.platform === 'facebook' || input.platform === 'instagram';
    const tokens = isMeta
      ? await this.normalizeMetaToken(input)
      : { pageToken: input.accessToken, userToken: null };

    // connect-tool (the transient OAuth helper) carries the user-token
    // alongside the page-token via metadata.user_access_token. Use that
    // when normalizeMetaToken couldn't produce one — e.g. when the input
    // already IS the Page token and the user token came from the same
    // OAuth round-trip.
    const metadataUserToken =
      isMeta &&
      input.metadata &&
      typeof input.metadata['user_access_token'] === 'string'
        ? (input.metadata['user_access_token'] as string)
        : null;
    const effectiveUserToken = tokens.userToken ?? metadataUserToken;

    const accessCipher = this.aes.encrypt(tokens.pageToken);
    const userCipher = effectiveUserToken
      ? this.aes.encrypt(effectiveUserToken)
      : null;
    const refreshCipher = input.refreshToken
      ? this.aes.encrypt(input.refreshToken)
      : null;
    const now = new Date();
    // Prisma doesn't accept `undefined` for nullable JSON columns when you
    // want a SQL NULL; use the explicit JsonNull sentinel.
    const metadataValue: Prisma.InputJsonValue | typeof Prisma.JsonNull =
      input.metadata && Object.keys(input.metadata).length > 0
        ? (input.metadata as Prisma.InputJsonValue)
        : Prisma.JsonNull;

    return this.prisma.$transaction(async (tx) => {
      // Look up first so we can decide whether re-OAuth should also resume an
      // auto-paused account. We only override syncTier when it's currently
      // 'paused' — that preserves deliberate 'lite'/'demo' tiers across
      // re-connects while clearing the auto-pause that the worker sets after
      // five consecutive failures (sync.worker.ts).
      const existing = await tx.account.findUnique({
        where: {
          platform_canonicalUserId: {
            platform: input.platform,
            canonicalUserId: input.canonicalUserId,
          },
        },
        select: { id: true, syncTier: true },
      });
      const wasPaused = existing?.syncTier === 'paused';

      const account = await tx.account.upsert({
        where: {
          platform_canonicalUserId: {
            platform: input.platform,
            canonicalUserId: input.canonicalUserId,
          },
        },
        create: {
          platform: input.platform,
          canonicalUserId: input.canonicalUserId,
          handle: input.handle ?? null,
          status: 'ready',
          syncTier: 'standard',
          metadata: metadataValue,
        },
        update: {
          handle: input.handle ?? undefined,
          status: 'ready',
          ...(wasPaused ? { syncTier: 'standard' } : {}),
          // Only overwrite metadata when the caller provided one — preserves
          // existing keys (e.g. page_id) on a re-seed of the same account.
          ...(input.metadata && Object.keys(input.metadata).length > 0
            ? { metadata: metadataValue }
            : {}),
        },
      });

      // If the account was auto-paused, the failure_count on its jobs is the
      // tripwire that paused it — clear it so future failures start from zero
      // and don't re-trip immediately.
      if (wasPaused) {
        await tx.syncJob.updateMany({
          where: { accountId: account.id },
          data: { failureCount: 0, lastError: null },
        });
      }

      await tx.oAuthToken.upsert({
        where: { accountId: account.id },
        create: {
          accountId: account.id,
          accessTokenCiphertext: accessCipher,
          userAccessTokenCiphertext: userCipher,
          refreshTokenCiphertext: refreshCipher,
          expiresAt: input.expiresAt ?? null,
          scopes: (input.metadata?.scopes as Prisma.InputJsonValue) ?? [],
        },
        update: {
          accessTokenCiphertext: accessCipher,
          // Only overwrite when the seed actually carries a user token —
          // re-seeds via Page-token-only paths must not erase a previously
          // captured user token.
          ...(userCipher ? { userAccessTokenCiphertext: userCipher } : {}),
          refreshTokenCiphertext: refreshCipher ?? undefined,
          expiresAt: input.expiresAt ?? undefined,
          lastRefreshedAt: now,
        },
      });

      const jobIds: string[] = [];
      for (const product of products) {
        const job = await tx.syncJob.upsert({
          where: {
            accountId_product: { accountId: account.id, product },
          },
          create: {
            accountId: account.id,
            product,
            status: 'idle',
            priority: 'NORMAL',
            nextRunAt: now,
          },
          update: {
            nextRunAt: now,
            status: 'idle',
          },
        });
        jobIds.push(job.id.toString());
      }

      this.logger.log(
        `Seeded account ${account.id} (${input.platform}) with ${jobIds.length} sync_jobs`,
      );

      return {
        account_id: account.id.toString(),
        sync_jobs_created: jobIds,
      };
    });
  }

  /**
   * Resolve any FB/IG access token down to the Page access token that
   * actually owns the requested resource. The path is:
   *
   *   1. Try GET /me/accounts with the supplied token.
   *      - 200 with a `data` array → it's a User token. Locate the page by
   *        canonical_user_id (page_id for FB, instagram_business_account.id
   *        for IG) and return that page's access_token.
   *      - 400 with "nonexisting field (accounts)" → it's already a Page
   *        token. Verify it can read /{canonical_user_id} and return it
   *        as-is.
   *
   * Throws BadRequestException with a precise reason whenever we can't end
   * up holding a Page token that owns the asset — that's what keeps a
   * stray User token from ever reaching oauth_tokens.
   *
   * Returns BOTH tokens when both are knowable:
   *   - User token path: input.accessToken IS the user token; we discover
   *     the page token from /me/accounts. We return both.
   *   - Page token path: input.accessToken IS the page token; the user
   *     token is unknown so userToken = null. Caller can backfill later
   *     via a re-seed initiated with the user token.
   */
  private async normalizeMetaToken(
    input: SeedAccountInput,
  ): Promise<{ pageToken: string; userToken: string | null }> {
    type GraphPage = {
      id: string;
      access_token?: string;
      instagram_business_account?: { id: string };
    };
    type GraphErrorBody = { error?: { message?: string; code?: number } };

    const accountsRes = await axios.get<{ data?: GraphPage[] } & GraphErrorBody>(
      `${META_GRAPH}/me/accounts`,
      {
        params: {
          fields: 'id,access_token,instagram_business_account{id}',
          limit: 100,
          access_token: input.accessToken,
        },
        timeout: NORMALIZE_TIMEOUT_MS,
        validateStatus: () => true,
      },
    );

    if (accountsRes.status >= 200 && accountsRes.status < 300) {
      const pages = accountsRes.data.data ?? [];
      const match = pages.find((p) =>
        input.platform === 'facebook'
          ? p.id === input.canonicalUserId
          : p.instagram_business_account?.id === input.canonicalUserId,
      );
      if (!match || !match.access_token) {
        throw new BadRequestException({
          message: `This token does not manage ${input.platform}/${input.canonicalUserId}. /me/accounts returned ${pages.length} pages, none matching.`,
          pages_seen: pages.map((p) => ({
            page_id: p.id,
            ig_business_id: p.instagram_business_account?.id ?? null,
          })),
        });
      }
      this.logger.log(
        `normalized User token → Page token for ${input.platform}/${input.canonicalUserId} (page ${match.id})`,
      );
      // The original input.accessToken IS the user token (it returned a
      // /me/accounts page list). Stash it alongside the page token so
      // ads_read calls have what they need.
      return { pageToken: match.access_token, userToken: input.accessToken };
    }

    const errMsg = accountsRes.data?.error?.message ?? `HTTP ${accountsRes.status}`;
    if (/nonexisting field \(accounts\)/i.test(errMsg)) {
      // Already a Page token. Verify it actually accesses the requested
      // resource so we don't persist a Page token from a different page.
      const probe = await axios.get<{ id?: string } & GraphErrorBody>(
        `${META_GRAPH}/${input.canonicalUserId}`,
        {
          params: { fields: 'id', access_token: input.accessToken },
          timeout: NORMALIZE_TIMEOUT_MS,
          validateStatus: () => true,
        },
      );
      if (probe.status < 200 || probe.status >= 300) {
        throw new BadRequestException({
          message: `Page token does not access ${input.platform}/${input.canonicalUserId}: ${probe.data?.error?.message ?? `HTTP ${probe.status}`}`,
        });
      }
      // For IG, /me/accounts isn't an option (the token is page-scoped) so
      // probe.id will be the page_id, not the IG id — that's fine, we're
      // only checking that the token has read access.
      // We don't have the user token here; caller can re-seed later with
      // the user token to backfill it.
      return { pageToken: input.accessToken, userToken: null };
    }

    throw new BadRequestException({
      message: `Failed to normalize ${input.platform} token: ${errMsg}`,
    });
  }

  /**
   * Resolve an account's stored access token, picking page vs user based on
   * the requested product. ads_read needs USER scope; everything else (
   * pages_read_user_content, page insights, post comments) uses PAGE.
   *
   * Falls back to the page token if the user token isn't stored. Throws
   * when neither is present.
   */
  async getDecryptedAccessToken(
    accountId: bigint,
    product: 'ads' | 'page' = 'page',
  ): Promise<{ token: string; level: 'page' | 'user' }> {
    const tok = await this.prisma.oAuthToken.findUnique({
      where: { accountId },
      select: {
        accessTokenCiphertext: true,
        userAccessTokenCiphertext: true,
      },
    });
    if (!tok) {
      throw new Error(`No OAuth token stored for account ${accountId.toString()}`);
    }
    if (product === 'ads' && tok.userAccessTokenCiphertext) {
      return {
        token: this.aes.decrypt(tok.userAccessTokenCiphertext),
        level: 'user',
      };
    }
    if (tok.accessTokenCiphertext) {
      return {
        token: this.aes.decrypt(tok.accessTokenCiphertext),
        level: 'page',
      };
    }
    if (tok.userAccessTokenCiphertext) {
      return {
        token: this.aes.decrypt(tok.userAccessTokenCiphertext),
        level: 'user',
      };
    }
    throw new Error(
      `Account ${accountId.toString()} has neither page nor user token stored`,
    );
  }

  async listAccounts(): Promise<unknown[]> {
    const rows = await this.prisma.account.findMany({
      include: {
        tokens: {
          select: {
            expiresAt: true,
            lastRefreshedAt: true,
          },
        },
        syncJobs: {
          select: {
            product: true,
            status: true,
            nextRunAt: true,
            lastSuccessAt: true,
            lastAttemptAt: true,
            failureCount: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => ({
      id: row.id.toString(),
      platform: row.platform,
      canonical_user_id: row.canonicalUserId,
      handle: row.handle,
      display_name: row.displayName,
      status: row.status,
      sync_tier: row.syncTier,
      connected_at: row.connectedAt,
      disconnected_at: row.disconnectedAt,
      token: row.tokens[0]
        ? {
            expires_at: row.tokens[0].expiresAt,
            last_refreshed_at: row.tokens[0].lastRefreshedAt,
          }
        : null,
      sync_health: this.summariseSyncJobs(row.syncJobs),
      sync_jobs: row.syncJobs.map((j) => ({
        product: j.product,
        status: j.status,
        next_run_at: j.nextRunAt,
        last_success_at: j.lastSuccessAt,
        last_attempt_at: j.lastAttemptAt,
        failure_count: j.failureCount,
      })),
    }));
  }

  async getAccount(id: bigint): Promise<unknown> {
    const row = await this.prisma.account.findUnique({
      where: { id },
      include: {
        tokens: true,
        syncJobs: true,
      },
    });

    if (!row) {
      throw new NotFoundException(`Account ${id.toString()} not found`);
    }

    return {
      id: row.id.toString(),
      platform: row.platform,
      canonical_user_id: row.canonicalUserId,
      handle: row.handle,
      display_name: row.displayName,
      status: row.status,
      sync_tier: row.syncTier,
      connected_at: row.connectedAt,
      disconnected_at: row.disconnectedAt,
      token: row.tokens[0]
        ? {
            expires_at: row.tokens[0].expiresAt,
            last_refreshed_at: row.tokens[0].lastRefreshedAt,
            scopes: row.tokens[0].scopes,
          }
        : null,
      sync_jobs: row.syncJobs.map((j) => ({
        id: j.id.toString(),
        product: j.product,
        status: j.status,
        priority: j.priority,
        next_run_at: j.nextRunAt,
        last_success_at: j.lastSuccessAt,
        last_attempt_at: j.lastAttemptAt,
        last_error: j.lastError,
        failure_count: j.failureCount,
      })),
    };
  }

  private summariseSyncJobs(
    jobs: ReadonlyArray<{
      status: string;
      lastSuccessAt: Date | null;
      failureCount: number;
    }>,
  ): { total: number; healthy: number; failing: number } {
    const total = jobs.length;
    const failing = jobs.filter((j) => j.failureCount > 0 || j.status === 'failed').length;
    const healthy = total - failing;
    return { total, healthy, failing };
  }
}
