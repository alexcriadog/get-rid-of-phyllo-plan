import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import axios from 'axios';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import { AesLocalService } from '@shared/crypto/aes-local.service';
import { RedisService } from '@shared/redis/redis.service';
import { purgeV1CacheForWorkspace } from '@/common/interceptors/cache.interceptor';
import { OutboundWebhooksService } from '@modules/outbound-webhooks/outbound-webhooks.service';
import { StandardWebhookEmitter } from '@modules/outbound-webhooks/standard-webhook-emitter.service';
import { PRODUCTS_BY_PLATFORM, type Platform } from './products.catalog';
import { WorkspacesService } from '@modules/workspaces/workspaces.service';
import { enforceWorkspaceProducts } from './seed-products-enforcement';
import { isIgDirect } from '@modules/platforms/shared/meta-graph/ig-direct';
import { connectionFlowFor } from './connection-flow';
import { TokenHistoryService } from '@modules/tokens/token-history.service';

export type { Platform };

const META_GRAPH = 'https://graph.facebook.com/v22.0';
const NORMALIZE_TIMEOUT_MS = 15_000;

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
   * Tenant that owns the account. Resolved upstream by the bearer-api-key
   * guard (server-to-server calls) or by the SDK JWT (popup flow). Until
   * the legacy CONNECT_TOOL_SECRET path is retired, callers without a
   * workspace fall back to the auto-seeded "wkspc_demo" tenant.
   */
  workspaceId?: string;
  /**
   * Optional id used by the client to correlate the account back to their
   * own user record. Threaded in from the SDK JWT.
   */
  endUserId?: string;
  /**
   * True when the SDK JWT was minted from a `cmlk_test_*` API key. The
   * account is otherwise indistinguishable from a live one (real OAuth,
   * real tokens, real syncs) — the flag only suppresses outbound webhook
   * deliveries so clients can develop without their endpoint being hit.
   */
  isTest?: boolean;
  /**
   * Free-form per-platform context bag persisted to `account.metadata`.
   *   - Meta: `{ page_id, ig_business_id }`
   *   - TikTok: `{ business_id, open_id, advertiser_id?, scopes? }`
   * Adapters read this via their own context builders.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Workspace assigned to legacy callers that don't yet carry a workspaceId.
 * Created by the multi_tenancy_foundation migration; removed once every
 * caller threads the JWT/API key.
 */
export const DEFAULT_WORKSPACE_ID = 'wkspc_demo';

export interface SeedAccountResult {
  account_id: string;
  sync_jobs_created: string[];
}


@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aes: AesLocalService,
    private readonly workspaces: WorkspacesService,
    private readonly redis: RedisService,
    private readonly tokenHistory: TokenHistoryService,
    // Optional: when AccountsModule is imported into a process that doesn't
    // wire OutboundWebhooks (e.g. the worker), seeding still succeeds —
    // emit is just a no-op.
    @Optional()
    @Inject(OutboundWebhooksService)
    private readonly outboundWebhooks: OutboundWebhooksService | null = null,
    // Optional InsightIQ-compatible thin-webhook emitter — fires
    // ACCOUNTS.CONNECTED / ACCOUNTS.DISCONNECTED to standard-format endpoints.
    @Optional()
    @Inject(StandardWebhookEmitter)
    private readonly standardWebhooks: StandardWebhookEmitter | null = null,
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

    const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;

    // Per-workspace enforcement: a workspace may offer only a subset of the
    // platform catalog. Trim to its allow-list (defense in depth — the UI
    // already shows only these, but never trust the caller).
    const allowed = await this.workspaces.resolveProducts(workspaceId, input.platform);
    const enforcedProducts = enforceWorkspaceProducts(products, allowed);

    // For Meta family (FB + IG) we MUST end up persisting a Page token so
    // calls don't get charged against the App-Level rate limit (200 ×
    // users/h). User tokens reach this method via the ManualForm in
    // /admin/connect, the public POST /accounts/seed, and helper scripts —
    // every path lands here, which is why the normalization belongs at this
    // chokepoint instead of in any single caller.
    //
    // We also remember the user-level token: ads_read needs USER scope, so
    // FB needs both. Stored side-by-side; resolved per-product downstream.
    // IG-direct seeds carry a graph.instagram.com user token — there is no
    // Page token to normalize to and /me/accounts would reject the token.
    // The seed's access token is already the final long-lived credential.
    const igDirect = input.platform === 'instagram' && isIgDirect(input.metadata);
    // Part of the uniqueness key: lets one IG identity coexist as two rows
    // (ig_direct vs fb_login) instead of the second connect overwriting the
    // first. Non-Instagram platforms always resolve to 'default'.
    const connectionFlow = connectionFlowFor(input.platform, input.metadata);
    const isMeta =
      !igDirect &&
      (input.platform === 'facebook' || input.platform === 'instagram');
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
    // Persist the ENFORCED product set (not the raw request) so
    // account.metadata.products always mirrors the actual enrolment — the
    // deploy-time backfill (prisma/seed.ts) treats it as the account's
    // connection scope and must never widen past it.
    const metadataValue: Prisma.InputJsonValue | typeof Prisma.JsonNull =
      input.metadata && Object.keys(input.metadata).length > 0
        ? ({
            ...input.metadata,
            products: enforcedProducts,
          } as Prisma.InputJsonValue)
        : Prisma.JsonNull;

    const result = await this.prisma.$transaction(async (tx) => {
      // Look up first so we can decide whether re-OAuth should also resume an
      // auto-paused account. We only override syncTier when it's currently
      // 'paused' — that preserves deliberate 'lite'/'demo' tiers across
      // re-connects while clearing the auto-pause that the worker sets after
      // five consecutive failures (sync.worker.ts).
      // endUserId is part of the account identity key: a DIFFERENT end user
      // (tenant/org) connecting the SAME real account gets its OWN row, so a
      // second tenant's connect never clobbers the first's. We can't use
      // Prisma's compound-unique upsert here because the key includes a
      // nullable column (endUserId), so match with findFirst then
      // create-or-update by id. The DB unique index is the backstop.
      const endUserId = input.endUserId ?? null;
      const existing = await tx.account.findFirst({
        where: {
          workspaceId,
          platform: input.platform,
          canonicalUserId: input.canonicalUserId,
          connectionFlow,
          endUserId,
        },
        select: { id: true, syncTier: true },
      });
      const wasPaused = existing?.syncTier === 'paused';

      const isTest = input.isTest === true;

      const account = existing
        ? await tx.account.update({
            where: { id: existing.id },
            data: {
              handle: input.handle ?? undefined,
              status: 'ready',
              // Re-seeding an existing account doesn't downgrade live → test
              // (a live account that previously had webhooks fire shouldn't
              // start being silenced because someone re-OAuth'd with a test
              // key). Only upgrade test → live. endUserId is NOT touched here —
              // it's part of the match key, so any row we reach already carries
              // this exact endUserId.
              ...(isTest === false ? { isTest: false } : {}),
              ...(wasPaused ? { syncTier: 'standard' } : {}),
              // Only overwrite metadata when the caller provided one — preserves
              // existing keys (e.g. page_id) on a re-seed of the same account.
              ...(input.metadata && Object.keys(input.metadata).length > 0
                ? { metadata: metadataValue }
                : {}),
            },
          })
        : await tx.account.create({
            data: {
              workspaceId,
              endUserId,
              isTest,
              platform: input.platform,
              canonicalUserId: input.canonicalUserId,
              connectionFlow,
              handle: input.handle ?? null,
              status: 'ready',
              syncTier: 'standard',
              metadata: metadataValue,
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

      // Snapshot the just-sealed token into the append-only recovery history,
      // inside the same tx. Best-effort (never throws) so it can't break the
      // connect; survives a later overwrite/delete of this account's token.
      await this.tokenHistory.record(account.id, 'connect', tx);

      const jobIds: string[] = [];
      for (const product of enforcedProducts) {
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

      // A (re-)seed is authoritative for the connection's product set: prune
      // jobs outside the enforced scope so a narrower re-connect (e.g. a
      // basic identity-only token) actually downgrades the account instead of
      // leaving stale enrolments syncing forever. enforcedProducts always
      // contains at least `identity`, so this can never empty the account.
      const pruned = await tx.syncJob.deleteMany({
        where: {
          accountId: account.id,
          product: { notIn: [...enforcedProducts] },
        },
      });
      if (pruned.count > 0) {
        this.logger.log(
          `Pruned ${pruned.count} sync_job(s) outside the connection scope for account ${account.id}`,
        );
      }

      this.logger.log(
        `Seeded account ${account.id} (${input.platform}) with ${jobIds.length} sync_jobs`,
      );

      // Fire the account.connected webhook after the transaction commits.
      // We do it inside the transaction callback so the account row is
      // guaranteed visible by the time we hand off to the dispatcher, but
      // we don't await: emit() is best-effort and must not roll back the
      // tx if it fails.
      //
      // Skip for test-mode accounts — the whole point of cmlk_test_* keys
      // is to develop against real OAuth without their endpoint receiving
      // fake events. Subsequent token-refresh / disconnect events from a
      // test account follow the same rule (see outbound-webhooks.service).
      if (this.outboundWebhooks && !account.isTest) {
        void this.outboundWebhooks.emit(workspaceId, 'account.connected', {
          account_id: account.id.toString(),
          platform: input.platform,
          workspace_id: workspaceId,
          end_user_id: input.endUserId ?? null,
          canonical_user_id: input.canonicalUserId,
          handle: input.handle ?? null,
          occurred_at: now.toISOString(),
        });
        // InsightIQ-compatible ACCOUNTS.CONNECTED (thin) to standard-format endpoints.
        void this.standardWebhooks?.fireLifecycle({
          accountId: account.id,
          type: 'account.connected',
        });
      }

      return {
        account_id: account.id.toString(),
        sync_jobs_created: jobIds,
      };
    });

    // Stale-read guard: cached /v1 product responses (5-min TTL) may predate
    // the prune above — a connection narrowed to fewer products must not keep
    // serving the old products from cache. Fire-and-forget.
    this.purgeWorkspaceCache(workspaceId);
    return result;
  }

  /**
   * Drop the workspace's cached /v1 reads so a scope change (re-seed prune /
   * disconnect) is visible immediately instead of after the cache TTL.
   * Best-effort: on Redis failure the cache self-expires in 5 minutes anyway.
   */
  private purgeWorkspaceCache(workspaceId: string): void {
    purgeV1CacheForWorkspace(this.redis.client, workspaceId)
      .then((n) => {
        if (n > 0) {
          this.logger.log(
            `Purged ${n} cached /v1 read(s) for workspace ${workspaceId}`,
          );
        }
      })
      .catch(() => {
        // Best-effort by design.
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

  /**
   * Disconnect an account: mark status='disconnected', stamp the
   * disconnectedAt timestamp, and drop the stored OAuth tokens so a stale
   * refresh worker can't keep calling upstream platforms with a token the
   * end-user has effectively withdrawn consent from.
   *
   * Scoped to a single workspace — cross-tenant disconnect returns null and
   * the caller surfaces a 404, never a 200 ("you can't disconnect things
   * you can't see").
   */
  async disconnectAccount(
    accountId: bigint,
    workspaceId: string,
  ): Promise<{ id: string; status: string; disconnected_at: string } | null> {
    const existing = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        workspaceId: true,
        status: true,
        platform: true,
        canonicalUserId: true,
        endUserId: true,
        isTest: true,
      },
    });
    if (!existing || existing.workspaceId !== workspaceId) return null;

    const disconnectedAt = new Date();
    const [updated] = await this.prisma.$transaction([
      this.prisma.account.update({
        where: { id: accountId },
        data: { status: 'disconnected', disconnectedAt },
      }),
      this.prisma.oAuthToken.deleteMany({ where: { accountId } }),
      // B-2: park the sync jobs. nextRunAt=null makes them undue, so the
      // scheduler's `nextRunAt <= now` filter never picks them again even
      // if the account-status filter were bypassed. status='idle' leaves
      // them clean to resume if the account reconnects — seedAccount's
      // syncJob.upsert sets nextRunAt=now + status='idle' again.
      this.prisma.syncJob.updateMany({
        where: { accountId },
        data: { status: 'idle', nextRunAt: null },
      }),
    ]);

    // Disconnected account data must stop being served immediately, not
    // after the /v1 cache TTL. Fire-and-forget.
    this.purgeWorkspaceCache(workspaceId);

    // Fire-and-forget — webhook delivery must not block the response or
    // roll back the disconnect. Test-mode accounts never emit (see
    // outbound-webhooks.service for the rationale).
    if (this.outboundWebhooks && !existing.isTest) {
      void this.outboundWebhooks.emit(workspaceId, 'account.disconnected', {
        account_id: existing.id.toString(),
        platform: existing.platform,
        workspace_id: workspaceId,
        end_user_id: existing.endUserId ?? null,
        canonical_user_id: existing.canonicalUserId,
        occurred_at: disconnectedAt.toISOString(),
      });
      // InsightIQ-compatible ACCOUNTS.DISCONNECTED (thin) to standard-format endpoints.
      void this.standardWebhooks?.fireLifecycle({
        accountId: existing.id,
        type: 'account.disconnected',
      });
    }

    return {
      id: updated.id.toString(),
      status: updated.status,
      disconnected_at: disconnectedAt.toISOString(),
    };
  }

  async listAccounts(workspaceId?: string): Promise<unknown[]> {
    const rows = await this.prisma.account.findMany({
      where: workspaceId ? { workspaceId } : undefined,
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

  async getAccount(id: bigint, workspaceId?: string): Promise<unknown> {
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
    // Cross-tenant access protection: a caller scoped to workspace A must
    // not be able to read an account owned by workspace B.
    if (workspaceId && row.workspaceId !== workspaceId) {
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
