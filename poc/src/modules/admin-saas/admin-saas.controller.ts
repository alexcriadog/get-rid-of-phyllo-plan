import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import { RedisService } from '@shared/redis/redis.service';
import { WorkspacesService } from '@modules/workspaces/workspaces.service';
import { normalizeOrigins } from '@modules/workspaces/workspace-origins';
import {
  ApiKeysService,
  IssuedApiKey,
} from '@modules/api-keys/api-keys.service';
import { OutboundWebhooksService } from '@modules/outbound-webhooks/outbound-webhooks.service';
import { BullmqService } from '@shared/redis/bullmq.service';
import { AccountsService } from '@modules/accounts/accounts.service';
import { ConnectToolGuard } from '@modules/admin/connect-tool.guard';
import { RateLimitInterceptor } from '@/common/interceptors/rate-limit.interceptor';
import {
  PLATFORM_CATALOG,
  PLATFORM_IDS,
  PRODUCT_IDS,
} from '@modules/accounts/products.catalog';
import {
  decodeBigIntCursor,
  decodeCompositeCursor,
  encodeCompositeCursor,
  encodeCursor,
  envelopeStatic,
  paginate,
  parseLimit,
  type Paginated,
} from '@shared/pagination/cursor';
import { apiAccountId } from '@modules/data-schema/ids';

const CADENCE_VALUES = ['immediate', 'hourly', 'daily'] as const;

/**
 * Safely pull the v1 account uuid from an outbound webhook delivery payload
 * (`{ data: { account_id } }`). Returns null for malformed / non-account
 * payloads so the deliveries list never throws on an unexpected shape.
 */
function accountUuidFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const id = (data as { account_id?: unknown }).account_id;
  return typeof id === 'string' ? id : null;
}

// Snapshot products always emit immediately (no items_added delta to digest).
// The schema accepts hourly/daily on these too but the dispatcher coerces them
// to immediate; the admin UI greys those out for clarity.
const WebhookCadenceSchema = z
  .record(
    z.enum(PRODUCT_IDS as unknown as [string, ...string[]]),
    z.enum(CADENCE_VALUES),
  )
  .default({});

// Sec-4: per-workspace origin allow-list. Wire shape is a flat array of origin
// strings (no platform split — an origin is where the SDK is embedded, which is
// platform-independent). Each entry is canonicalised + validated in the handler
// via normalizeOrigins(); the schema only enforces the array/string envelope
// and a sane cardinality cap. Empty array clears the list (= no restriction).
const AllowedOriginsSchema = z
  .array(z.string().min(1).max(2048))
  .max(50)
  .default([]);

const WorkspaceCreateSchema = z
  .object({
    slug: z
      .string()
      .min(2)
      .max(40)
      .regex(/^[a-z0-9-]+$/, 'lowercase letters, digits and dashes only'),
    name: z.string().min(1).max(120),
    planTier: z.string().min(1).max(40).optional(),
  })
  .strict();

const BrandingSchema = z
  .object({
    logo_url: z.string().url().optional(),
    primary_color: z.string().optional(),
    secondary_color: z.string().optional(),
    accent_color: z.string().optional(),
    font_family: z.string().optional(),
    title: z.string().max(200).optional(),
    subtitle: z.string().max(500).optional(),
    hide_platforms: z.array(z.string()).optional(),
    per_platform_label: z.record(z.string()).optional(),
  })
  .strict();

// Tighten the wire format: only known platform/product IDs are accepted, and
// every enabled platform MUST include `identity` (the implicit minimum for
// every account). Empty body still means "clear" — handled in the handler.
// Exported for unit tests; do not import from non-test code outside this module.
export const ProductsSchema = z
  .record(
    z.enum(PLATFORM_IDS as unknown as [string, ...string[]]),
    z.array(z.enum(PRODUCT_IDS as unknown as [string, ...string[]])).min(1),
  )
  .refine(
    (config) =>
      Object.values(config).every((products) => products.includes('identity')),
    { message: 'identity is required for every enabled platform' },
  )
  .default({});

const IssueKeySchema = z
  .object({
    environment: z.enum(['live', 'test']).default('live'),
    label: z.string().max(120).optional(),
  })
  .strict();

const ALLOWED_TOKEN_PRODUCTS = ['page', 'ads'] as const;
type TokenProduct = (typeof ALLOWED_TOKEN_PRODUCTS)[number];

/**
 * Operator-facing admin surface for the Camaleonic Connect SaaS.
 *
 * Lives under /admin/* alongside the existing connector admin. The
 * operational model is "the /admin/* URL space is operator-trust" —
 * the existing /admin dashboard at poc/web is a browser-side Next.js
 * app that calls these endpoints directly from the user's browser, so
 * shared-bearer guards aren't viable here (the secret would leak to
 * the client). Network-layer auth is the boundary: in prod the Caddy
 * config in tools/Caddyfile has a commented-out `basic_auth` directive
 * for /admin/* that should be enabled before real customers ship.
 *
 * What this controller does enforce in-app:
 *   - Strict Zod schemas with enum allowlists for platform/product IDs
 *     (ProductsSchema requires identity per enabled platform; rejects
 *     unknown keys/values).
 *   - @UseInterceptors(RateLimitInterceptor) on workspace creation +
 *     key issuance — limits abuse damage even without auth.
 *   - The token-decrypt endpoint (showAccessToken) still carries
 *     @UseGuards(ConnectToolGuard); it's curl-only, never invoked from
 *     the admin UI, and returns plaintext OAuth tokens, so the bearer
 *     requirement + loopback bypass is appropriate there.
 */
@Controller('admin')
export class AdminSaasController {
  private readonly logger = new Logger(AdminSaasController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly workspaces: WorkspacesService,
    private readonly apiKeys: ApiKeysService,
    private readonly webhooks: OutboundWebhooksService,
    private readonly accounts: AccountsService,
    private readonly bullmq: BullmqService,
  ) {}

  // ─── Workspaces ─────────────────────────────────────────────────────────

  @Get('workspaces')
  async listWorkspaces(
    @Query('limit') limitRaw: string | undefined,
    @Query('cursor') cursorRaw: string | undefined,
  ): Promise<
    Paginated<{
      id: string;
      slug: string;
      name: string;
      plan_tier: string;
      created_at: string;
      account_count: number;
      api_key_count: number;
    }>
  > {
    // Workspace.id is a cuid (string), not a BigInt — so we use a composite
    // cursor of (createdAt, id) to keep ordering stable across same-second
    // inserts.
    const limit = parseLimit(limitRaw, 100, 1, 500);
    const cursor = decodeCompositeCursor(cursorRaw);
    return paginate(
      limit,
      (take) =>
        this.prisma.workspace.findMany({
          where: cursor
            ? {
                OR: [
                  { createdAt: { lt: cursor.timestamp } },
                  {
                    AND: [
                      { createdAt: cursor.timestamp },
                      { id: { lt: cursor.id } },
                    ],
                  },
                ],
              }
            : {},
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
          include: {
            _count: { select: { accounts: true, apiKeys: true } },
          },
        }),
      (r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        plan_tier: r.planTier,
        created_at: r.createdAt.toISOString(),
        account_count: r._count.accounts,
        api_key_count: r._count.apiKeys,
      }),
      (r) => encodeCompositeCursor(r.createdAt, r.id),
    );
  }

  @Post('workspaces')
  @HttpCode(201)
  @UseInterceptors(RateLimitInterceptor)
  async createWorkspace(@Body() body: unknown): Promise<unknown> {
    const parsed = WorkspaceCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid workspace payload',
        issues: parsed.error.issues,
      });
    }
    const existing = await this.prisma.workspace.findUnique({
      where: { slug: parsed.data.slug },
    });
    if (existing) {
      throw new BadRequestException(
        `Workspace slug "${parsed.data.slug}" already taken`,
      );
    }
    // New workspaces start with the full catalog enabled — same behaviour
    // the legacy `null` value used to mean. Admin tightens via PATCH
    // /admin/workspaces/:slug/products. Identity is required per platform
    // (Zod refines this on PATCH too), so we include it for every platform.
    const fullCatalog: Prisma.InputJsonValue = Object.fromEntries(
      PLATFORM_IDS.map((p) => [p, PLATFORM_CATALOG[p].map((def) => def.id)]),
    );
    const row = await this.prisma.workspace.create({
      data: {
        slug: parsed.data.slug,
        name: parsed.data.name,
        planTier: parsed.data.planTier ?? 'standard',
        products: fullCatalog,
      },
    });
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      plan_tier: row.planTier,
      created_at: row.createdAt.toISOString(),
    };
  }

  @Get('workspaces/:slug')
  async getWorkspace(@Param('slug') slug: string): Promise<unknown> {
    const ws = await this.workspaces.findBySlug(slug);
    const [accountCount, apiKeyCount, endpointCount] = await Promise.all([
      this.prisma.account.count({ where: { workspaceId: ws.id } }),
      this.prisma.apiKey.count({
        where: { workspaceId: ws.id, revokedAt: null },
      }),
      this.prisma.webhookEndpoint.count({ where: { workspaceId: ws.id } }),
    ]);
    return {
      id: ws.id,
      slug: ws.slug,
      name: ws.name,
      plan_tier: ws.planTier,
      branding: ws.branding,
      products: ws.products,
      webhook_cadence: ws.webhookCadence,
      allowed_origins: ws.allowedOrigins ?? null,
      account_count: accountCount,
      active_api_key_count: apiKeyCount,
      webhook_endpoint_count: endpointCount,
    };
  }

  @Patch('workspaces/:slug/branding')
  async updateBranding(
    @Param('slug') slug: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = BrandingSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid branding payload',
        issues: parsed.error.issues,
      });
    }
    const ws = await this.workspaces.findBySlug(slug);
    // Empty object → clear branding (DB null). Prisma needs the explicit
    // JsonNull sentinel to write SQL NULL on a nullable JSON column.
    const isClear = Object.keys(parsed.data).length === 0;
    await this.prisma.workspace.update({
      where: { id: ws.id },
      data: {
        branding: isClear
          ? Prisma.JsonNull
          : (parsed.data as Prisma.InputJsonValue),
      },
    });
    return { slug, branding: isClear ? null : parsed.data };
  }

  @Patch('workspaces/:slug/name')
  async renameWorkspace(
    @Param('slug') slug: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = z
      .object({ name: z.string().trim().min(1).max(120) })
      .safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid name payload',
        issues: parsed.error.issues,
      });
    }
    const ws = await this.workspaces.findBySlug(slug);
    const updated = await this.prisma.workspace.update({
      where: { id: ws.id },
      data: { name: parsed.data.name },
    });
    return { slug, name: updated.name };
  }

  @Patch('workspaces/:slug/products')
  async updateProducts(
    @Param('slug') slug: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = ProductsSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid products payload',
        issues: parsed.error.issues,
      });
    }
    const ws = await this.workspaces.findBySlug(slug);
    const newConfig = parsed.data as Record<string, string[]>;

    // Persist the new allow-list AND prune stale sync_jobs in the same
    // transaction. Existing accounts (seeded before this admin tightening)
    // have sync_jobs for products that may no longer be in the allow-list
    // — without this prune step the scheduler would keep firing them
    // (scheduler.service.ts picks rows by status+nextRunAt, not by
    // workspace.products). For platforms removed entirely from the config,
    // every sync_job on the workspace's accounts of that platform is dropped.
    // The account row + OAuth tokens are preserved so the admin can re-enable
    // the platform later (a follow-up "rehydrate" admin action will then
    // re-seed sync_jobs from the catalog).
    const prunedTotal = await this.prisma.$transaction(async (tx) => {
      await tx.workspace.update({
        where: { id: ws.id },
        data: { products: newConfig as Prisma.InputJsonValue },
      });

      const accountsInWs = await tx.account.findMany({
        where: { workspaceId: ws.id },
        select: { id: true, platform: true },
      });

      let pruned = 0;
      for (const acc of accountsInWs) {
        const allowedForPlatform = newConfig[acc.platform];
        const result = allowedForPlatform
          ? await tx.syncJob.deleteMany({
              where: {
                accountId: acc.id,
                product: { notIn: allowedForPlatform },
              },
            })
          : await tx.syncJob.deleteMany({ where: { accountId: acc.id } });
        pruned += result.count;
      }
      return pruned;
    });

    this.logger.log(
      `updateProducts(${slug}): pruned ${prunedTotal} sync_job(s) for products outside the new allow-list`,
    );
    return { slug, products: newConfig, pruned_sync_jobs: prunedTotal };
  }

  /**
   * Operator-set per-product webhook delivery cadence.
   *
   * Shape: Record<product, "immediate" | "hourly" | "daily">. Missing
   * keys default to "immediate". Empty object clears the override.
   * Snapshot products (identity, audience, engagement_deep, ratings,
   * ads) ignore hourly/daily — the dispatcher coerces them to
   * immediate; the admin UI greys those rows out.
   *
   * The DataEventDispatcher memoises this per workspace for 60 s, so a
   * fresh value takes up to a minute to fully propagate.
   */
  @Patch('workspaces/:slug/webhook-cadence')
  async updateWebhookCadence(
    @Param('slug') slug: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = WebhookCadenceSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid webhook-cadence payload',
        issues: parsed.error.issues,
      });
    }
    const ws = await this.workspaces.findBySlug(slug);
    const newConfig = parsed.data as Record<string, string>;
    const isClear = Object.keys(newConfig).length === 0;
    await this.prisma.workspace.update({
      where: { id: ws.id },
      data: {
        webhookCadence: isClear
          ? Prisma.JsonNull
          : (newConfig as Prisma.InputJsonValue),
      },
    });
    this.logger.log(
      `updateWebhookCadence(${slug}): ${
        isClear ? 'cleared (defaults to immediate)' : JSON.stringify(newConfig)
      }`,
    );
    return { slug, webhook_cadence: isClear ? null : newConfig };
  }

  /**
   * Sec-4: per-workspace origin allow-list.
   *
   * Body: a JSON array of web origins (scheme://host[:port], no path), e.g.
   * ["https://app.example.com","http://localhost:4000"]. Each is canonicalised
   * + de-duplicated; an invalid entry fails the whole request with the
   * offending value. An empty array clears the list — which means "no origin
   * restriction" (the legacy, pre-Sec-4 behaviour), so clearing is an explicit,
   * auditable operator choice rather than a silent default.
   *
   * Once set, the value is embedded into every freshly-minted SDK token's
   * signed `origins` claim; connect-tool only launches OAuth for — and only
   * postMessages results back to — a listed origin. Tokens minted BEFORE a
   * change keep their old claim until they expire (≤30 min), so changes
   * propagate within one token TTL.
   */
  @Patch('workspaces/:slug/allowed-origins')
  async updateAllowedOrigins(
    @Param('slug') slug: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = AllowedOriginsSchema.safeParse(body ?? []);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid allowed-origins payload',
        issues: parsed.error.issues,
      });
    }
    let normalized: string[];
    try {
      normalized = normalizeOrigins(parsed.data);
    } catch (err) {
      throw new BadRequestException({
        message: err instanceof Error ? err.message : 'Invalid origin',
      });
    }
    const ws = await this.workspaces.findBySlug(slug);
    const isClear = normalized.length === 0;
    await this.prisma.workspace.update({
      where: { id: ws.id },
      data: {
        allowedOrigins: isClear
          ? Prisma.JsonNull
          : (normalized as Prisma.InputJsonValue),
      },
    });
    this.logger.log(
      `updateAllowedOrigins(${slug}): ${
        isClear ? 'cleared (no origin restriction)' : JSON.stringify(normalized)
      }`,
    );
    return { slug, allowed_origins: isClear ? null : normalized };
  }

  // ─── API keys ───────────────────────────────────────────────────────────

  @Get('workspaces/:slug/api-keys')
  async listApiKeys(
    @Param('slug') slug: string,
    @Query('limit') limitRaw: string | undefined,
    @Query('cursor') cursorRaw: string | undefined,
  ): Promise<
    Paginated<{
      id: string;
      key_prefix: string;
      scope: string;
      label: string | null;
      last_used_at: string | null;
      revoked_at: string | null;
      created_at: string;
    }>
  > {
    const ws = await this.workspaces.findBySlug(slug);
    const limit = parseLimit(limitRaw, 100, 1, 500);
    const cursor = decodeCompositeCursor(cursorRaw);
    return paginate(
      limit,
      (take) =>
        this.prisma.apiKey.findMany({
          where: {
            workspaceId: ws.id,
            ...(cursor
              ? {
                  OR: [
                    { createdAt: { lt: cursor.timestamp } },
                    {
                      AND: [
                        { createdAt: cursor.timestamp },
                        { id: { lt: cursor.id } },
                      ],
                    },
                  ],
                }
              : {}),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
        }),
      (r) => ({
        id: r.id,
        key_prefix: r.keyPrefix,
        scope: r.scope,
        label: r.label,
        last_used_at: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
        revoked_at: r.revokedAt ? r.revokedAt.toISOString() : null,
        created_at: r.createdAt.toISOString(),
      }),
      (r) => encodeCompositeCursor(r.createdAt, r.id),
    );
  }

  @Post('workspaces/:slug/api-keys')
  @HttpCode(201)
  @UseInterceptors(RateLimitInterceptor)
  async issueApiKey(
    @Param('slug') slug: string,
    @Body() body: unknown,
  ): Promise<IssuedApiKey> {
    const parsed = IssueKeySchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid issue-key payload',
        issues: parsed.error.issues,
      });
    }
    const ws = await this.workspaces.findBySlug(slug);
    return this.apiKeys.issue({
      workspaceId: ws.id,
      environment: parsed.data.environment,
      label: parsed.data.label,
    });
  }

  @Get('api-keys')
  async listAllApiKeys(
    @Query('limit') limitRaw: string | undefined,
    @Query('cursor') cursorRaw: string | undefined,
  ): Promise<
    Paginated<{
      id: string;
      workspace_slug: string;
      workspace_name: string;
      key_prefix: string;
      scope: string;
      label: string | null;
      last_used_at: string | null;
      revoked_at: string | null;
      created_at: string;
    }>
  > {
    // Sort: active keys (revoked=null) first, then by createdAt desc. We
    // cursor on createdAt+id which preserves the secondary order; the
    // primary revoked-ness sort only matters once revoked keys appear and
    // the cursor crosses that boundary — acceptable because revoke is rare.
    const limit = parseLimit(limitRaw, 100, 1, 500);
    const cursor = decodeCompositeCursor(cursorRaw);
    return paginate(
      limit,
      (take) =>
        this.prisma.apiKey.findMany({
          where: cursor
            ? {
                OR: [
                  { createdAt: { lt: cursor.timestamp } },
                  {
                    AND: [
                      { createdAt: cursor.timestamp },
                      { id: { lt: cursor.id } },
                    ],
                  },
                ],
              }
            : {},
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
          include: { workspace: { select: { slug: true, name: true } } },
        }),
      (r) => ({
        id: r.id,
        workspace_slug: r.workspace.slug,
        workspace_name: r.workspace.name,
        key_prefix: r.keyPrefix,
        scope: r.scope,
        label: r.label,
        last_used_at: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
        revoked_at: r.revokedAt ? r.revokedAt.toISOString() : null,
        created_at: r.createdAt.toISOString(),
      }),
      (r) => encodeCompositeCursor(r.createdAt, r.id),
    );
  }

  @Post('api-keys/:id/revoke')
  @HttpCode(200)
  async revokeApiKey(@Param('id') id: string): Promise<{ revoked: boolean }> {
    const row = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException(`API key ${id} not found`);
    }
    await this.apiKeys.revoke(id);
    return { revoked: true };
  }

  // ─── Webhooks ────────────────────────────────────────────────────────────

  @Get('workspaces/:slug/webhook-endpoints')
  async listEndpoints(@Param('slug') slug: string): Promise<Paginated<unknown>> {
    const ws = await this.workspaces.findBySlug(slug);
    // OutboundWebhooksService.list returns the full set (typically small,
    // <10 endpoints per workspace). Wrap in the canonical envelope; if it
    // grows we'd plumb a cursor through that service later.
    const endpoints = await this.webhooks.list(ws.id);
    return envelopeStatic<unknown>(endpoints);
  }

  @Get('webhook-deliveries')
  async listDeliveries(
    @Query('workspace') workspaceSlug: string | undefined,
    @Query('status') status: string | undefined,
    @Query('event') event: string | undefined,
    @Query('limit') limitRaw: string | undefined,
    @Query('cursor') cursorRaw: string | undefined,
  ): Promise<
    Paginated<{
      id: string;
      endpoint_id: string;
      endpoint_url: string;
      workspace_slug: string;
      event: string;
      status: string;
      attempts: number;
      last_response_code: number | null;
      last_error: string | null;
      next_retry_at: string | null;
      created_at: string;
      delivered_at: string | null;
      // Resolved from the delivery payload's `data.account_id` (a v1 uuid) so
      // operators can see which platform/account a delivery is for at a glance.
      platform: string | null;
      account: string | null;
      account_id: string | null;
    }>
  > {
    const limit = parseLimit(limitRaw, 100, 1, 500);
    const cursor = decodeCompositeCursor(cursorRaw);
    const workspaceId = workspaceSlug
      ? (await this.workspaces.findBySlug(workspaceSlug)).id
      : undefined;

    // The webhook payload references the account by its v1 uuid only. Build a
    // uuid → {platform, handle} lookup up-front (scoped to the workspace when
    // one is selected) so the sync row mapper can enrich each delivery without
    // an N+1. apiAccountId is the same deterministic id used by the /v1 API.
    const accounts = await this.prisma.account.findMany({
      where: workspaceId ? { workspaceId } : undefined,
      select: { id: true, platform: true, handle: true, connectionFlow: true },
    });
    const accountByUuid = new Map<
      string,
      { platform: string; handle: string | null; connectionFlow: string | null }
    >();
    for (const a of accounts) {
      accountByUuid.set(apiAccountId(a.id.toString()), {
        platform: a.platform,
        handle: a.handle,
        connectionFlow: a.connectionFlow,
      });
    }

    return paginate(
      limit,
      (take) =>
        this.prisma.webhookDelivery.findMany({
          where: {
            ...(status ? { status } : {}),
            ...(event ? { event } : {}),
            ...(workspaceId ? { endpoint: { workspaceId } } : {}),
            ...(cursor
              ? {
                  OR: [
                    { createdAt: { lt: cursor.timestamp } },
                    {
                      AND: [
                        { createdAt: cursor.timestamp },
                        { id: { lt: cursor.id } },
                      ],
                    },
                  ],
                }
              : {}),
          },
          include: {
            endpoint: {
              include: { workspace: { select: { slug: true } } },
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
        }),
      (r) => {
        const accountUuid = accountUuidFromPayload(r.payload);
        const account = accountUuid ? accountByUuid.get(accountUuid) : undefined;
        return {
          id: r.id,
          endpoint_id: r.endpointId,
          endpoint_url: r.endpoint.url,
          workspace_slug: r.endpoint.workspace.slug,
          event: r.event,
          status: r.status,
          attempts: r.attempts,
          last_response_code: r.lastResponseCode,
          last_error: r.lastError,
          next_retry_at: r.nextRetryAt ? r.nextRetryAt.toISOString() : null,
          created_at: r.createdAt.toISOString(),
          delivered_at: r.deliveredAt ? r.deliveredAt.toISOString() : null,
          platform: account?.platform ?? null,
          account: account?.handle ?? null,
          account_id: accountUuid,
          connection_flow: account?.connectionFlow ?? null,
        };
      },
      (r) => encodeCompositeCursor(r.createdAt, r.id),
    );
  }

  /**
   * Full delivery detail for the admin: payload + lastResponseBody +
   * lastResponseHeaders + durationMs + the resolved endpoint. Operator-trust
   * model — no guard, network-layer auth only (matches the rest of
   * /admin/*).
   */
  @Get('webhook-deliveries/:id')
  async getDelivery(@Param('id') id: string): Promise<unknown> {
    const row = await this.prisma.webhookDelivery.findUnique({
      where: { id },
      include: {
        endpoint: {
          include: { workspace: { select: { slug: true, name: true } } },
        },
      },
    });
    if (!row) {
      throw new NotFoundException(`Delivery ${id} not found`);
    }
    return {
      id: row.id,
      endpoint_id: row.endpointId,
      endpoint_url: row.endpoint.url,
      workspace_slug: row.endpoint.workspace.slug,
      workspace_name: row.endpoint.workspace.name,
      event: row.event,
      payload: row.payload,
      status: row.status,
      attempts: row.attempts,
      last_response_code: row.lastResponseCode,
      last_error: row.lastError,
      response_body: row.responseBody,
      response_headers: row.responseHeaders,
      duration_ms: row.durationMs,
      next_retry_at: row.nextRetryAt ? row.nextRetryAt.toISOString() : null,
      created_at: row.createdAt.toISOString(),
      delivered_at: row.deliveredAt ? row.deliveredAt.toISOString() : null,
    };
  }

  /**
   * Manual re-enqueue. Allowed states: failed/abandoned/pending. Delivered
   * deliveries are rejected (idempotent — there's nothing to retry). The
   * attempts counter is preserved so the operator can see "this is the
   * 4th try, the 3 before failed".
   */
  @Post('webhook-deliveries/:id/retry')
  @HttpCode(202)
  async retryDelivery(@Param('id') id: string): Promise<unknown> {
    const row = await this.prisma.webhookDelivery.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException(`Delivery ${id} not found`);
    }
    if (row.status === 'delivered') {
      throw new BadRequestException('Delivery already succeeded; nothing to retry');
    }
    const now = new Date();
    await this.prisma.webhookDelivery.update({
      where: { id },
      data: {
        status: 'pending',
        nextRetryAt: now,
        lastError: row.lastError ? `${row.lastError} | manual retry by admin` : null,
      },
    });
    await this.adminEnqueueDelivery(id);
    return { id, status: 'pending', enqueued_at: now.toISOString() };
  }

  /**
   * Endpoint health rollup over the last 24 h. Useful for ops to spot
   * an endpoint that's been silently dropping deliveries.
   */
  @Get('workspaces/:slug/webhook-endpoints/:id/health')
  async endpointHealth(
    @Param('slug') slug: string,
    @Param('id') endpointId: string,
  ): Promise<unknown> {
    const ws = await this.workspaces.findBySlug(slug);
    const endpoint = await this.prisma.webhookEndpoint.findUnique({
      where: { id: endpointId },
    });
    if (!endpoint || endpoint.workspaceId !== ws.id) {
      throw new NotFoundException(`Webhook endpoint ${endpointId} not found`);
    }
    const since = new Date(Date.now() - 24 * 60 * 60_000);

    const grouped = await this.prisma.webhookDelivery.groupBy({
      by: ['status'],
      where: { endpointId, createdAt: { gte: since } },
      _count: { _all: true },
    });
    const recent = await this.prisma.webhookDelivery.findMany({
      where: { endpointId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        status: true,
        durationMs: true,
        deliveredAt: true,
        createdAt: true,
      },
    });
    const counts = {
      delivered: 0,
      failed: 0,
      pending: 0,
      abandoned: 0,
    } as Record<string, number>;
    for (const g of grouped) counts[g.status] = g._count._all ?? 0;
    const total = grouped.reduce((acc, g) => acc + (g._count._all ?? 0), 0);

    const durations = recent
      .map((r) => r.durationMs)
      .filter((d): d is number => d !== null);
    const avgDuration = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null;
    const sortedDur = [...durations].sort((a, b) => a - b);
    const p95Duration = sortedDur.length
      ? sortedDur[Math.min(sortedDur.length - 1, Math.floor(sortedDur.length * 0.95))]
      : null;

    // Consecutive failures from the most-recent attempt backwards. Stops
    // at the first delivered row.
    let consecutiveFailures = 0;
    for (const r of recent) {
      if (r.status === 'delivered') break;
      consecutiveFailures += 1;
    }

    const lastDelivery = recent[0];
    const lastSuccess = recent.find((r) => r.status === 'delivered');

    return {
      endpoint_id: endpointId,
      window_hours: 24,
      total,
      delivered: counts.delivered ?? 0,
      failed: counts.failed ?? 0,
      pending: counts.pending ?? 0,
      abandoned: counts.abandoned ?? 0,
      success_rate: total > 0 ? counts.delivered / total : null,
      avg_duration_ms: avgDuration,
      p95_duration_ms: p95Duration,
      last_delivery_at: lastDelivery
        ? lastDelivery.createdAt.toISOString()
        : null,
      last_success_at: lastSuccess
        ? (lastSuccess.deliveredAt ?? lastSuccess.createdAt).toISOString()
        : null,
      consecutive_failures: consecutiveFailures,
    };
  }

  /**
   * Admin "Send test webhook" — fires a webhook.test delivery to the
   * endpoint via the same sendTest path the public /v1/.../test endpoint
   * uses. Useful for an operator helping a customer who's debugging
   * their server's signature verification.
   */
  @Post('workspaces/:slug/webhook-endpoints/:id/test')
  @HttpCode(202)
  async sendTestFromAdmin(
    @Param('slug') slug: string,
    @Param('id') endpointId: string,
  ): Promise<unknown> {
    const ws = await this.workspaces.findBySlug(slug);
    return this.webhooks.sendTest(ws.id, endpointId);
  }

  /**
   * Delete a workspace's webhook endpoint (and, by cascade, its deliveries and
   * pending events). Workspace-scoped via OutboundWebhooksService.remove, which
   * is a no-op for unknown/cross-tenant ids so existence can't leak.
   */
  @Delete('workspaces/:slug/webhook-endpoints/:id')
  async deleteEndpointFromAdmin(
    @Param('slug') slug: string,
    @Param('id') endpointId: string,
  ): Promise<{ deleted: boolean }> {
    const ws = await this.workspaces.findBySlug(slug);
    await this.webhooks.remove(ws.id, endpointId);
    return { deleted: true };
  }

  /**
   * Re-enqueue helper. Uses the SAME BullMQ queue name + payload shape as
   * OutboundWebhooksService — kept here to avoid widening the service's
   * public surface area (admin path uses a different jobId prefix so it
   * never collides with the worker's natural retry pattern).
   */
  private async adminEnqueueDelivery(deliveryId: string): Promise<void> {
    await this.bullmq
      .getQueue<{ deliveryId: string }>('delivery')
      .add('webhook', { deliveryId }, { jobId: `${deliveryId}-admin-${Date.now()}` });
  }

  // ─── Usage telemetry ────────────────────────────────────────────────────

  @Get('usage')
  async usage(
    @Query('days') daysRaw: string | undefined,
  ): Promise<{
    days: string[];
    workspaces: Array<{
      id: string;
      slug: string;
      name: string;
      counts: number[];
      total: number;
    }>;
  }> {
    const days = clampInt(daysRaw, 7, 1, 90);
    const today = Math.floor(Date.now() / 1000);
    const dayKeys: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      dayKeys.push(
        new Date((today - i * 86400) * 1000).toISOString().slice(0, 10),
      );
    }

    const workspaces = await this.prisma.workspace.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, slug: true, name: true },
    });

    // Single round-trip MGET — one key per (workspace, day).
    const keys = workspaces.flatMap((ws) =>
      dayKeys.map((d) => `usage:${ws.id}:${d}`),
    );
    const values = keys.length > 0 ? await this.redis.client.mget(...keys) : [];

    const rows = workspaces.map((ws, wsIdx) => {
      const counts = dayKeys.map((_, dIdx) => {
        const v = values[wsIdx * dayKeys.length + dIdx];
        return v ? parseInt(v, 10) || 0 : 0;
      });
      return {
        id: ws.id,
        slug: ws.slug,
        name: ws.name,
        counts,
        total: counts.reduce((a, b) => a + b, 0),
      };
    });

    return { days: dayKeys, workspaces: rows };
  }

  // ─── Token debug (operator-only) ────────────────────────────────────────

  @Get('accounts/:id/access-token')
  @UseGuards(ConnectToolGuard)
  async showAccessToken(
    @Param('id') rawId: string,
    @Query('product') product: string | undefined,
  ): Promise<{
    account_id: string;
    product: TokenProduct;
    level: 'page' | 'user';
    token: string;
  }> {
    const accountId = parseBigInt(rawId);
    const audience: TokenProduct = ALLOWED_TOKEN_PRODUCTS.includes(
      (product ?? 'page') as TokenProduct,
    )
      ? ((product ?? 'page') as TokenProduct)
      : 'page';
    const { token, level } = await this.accounts.getDecryptedAccessToken(
      accountId,
      audience,
    );
    return {
      account_id: rawId,
      product: audience,
      level,
      token,
    };
  }
}

function parseBigInt(raw: string): bigint {
  if (!/^\d+$/.test(raw)) {
    throw new BadRequestException(`Invalid id: ${raw}`);
  }
  try {
    return BigInt(raw);
  } catch {
    throw new BadRequestException(`Invalid id: ${raw}`);
  }
}

function clampInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new BadRequestException(`Invalid integer: ${raw}`);
  }
  return Math.min(Math.max(n, min), max);
}
