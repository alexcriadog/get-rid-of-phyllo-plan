import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import { WorkspacesService } from '@modules/workspaces/workspaces.service';
import {
  ApiKeysService,
  IssuedApiKey,
} from '@modules/api-keys/api-keys.service';
import { OutboundWebhooksService } from '@modules/outbound-webhooks/outbound-webhooks.service';
import { AccountsService } from '@modules/accounts/accounts.service';

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
 * existing admin endpoints (admin/accounts, admin/sync-jobs, etc.) are
 * unguarded externally — the operational model is "the /admin/* URL
 * space is operator-trust, with HTTP Basic auth added at the Caddy
 * layer when stricter access control is needed." This controller
 * matches that pattern for read endpoints. The sensitive mutations
 * (workspace + key creation / revocation) and the token-decrypt route
 * carry @UseGuards(ConnectToolGuard) so they require the shared bearer
 * even from inside the network.
 */
@Controller('admin')
export class AdminSaasController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly apiKeys: ApiKeysService,
    private readonly webhooks: OutboundWebhooksService,
    private readonly accounts: AccountsService,
  ) {}

  // ─── Workspaces ─────────────────────────────────────────────────────────

  @Get('workspaces')
  async listWorkspaces(): Promise<{
    data: Array<{
      id: string;
      slug: string;
      name: string;
      plan_tier: string;
      created_at: string;
      account_count: number;
      api_key_count: number;
    }>;
  }> {
    const rows = await this.prisma.workspace.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { accounts: true, apiKeys: true },
        },
      },
    });
    return {
      data: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        plan_tier: r.planTier,
        created_at: r.createdAt.toISOString(),
        account_count: r._count.accounts,
        api_key_count: r._count.apiKeys,
      })),
    };
  }

  @Post('workspaces')
  @HttpCode(201)
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
    const row = await this.prisma.workspace.create({
      data: {
        slug: parsed.data.slug,
        name: parsed.data.name,
        planTier: parsed.data.planTier ?? 'standard',
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

  // ─── API keys ───────────────────────────────────────────────────────────

  @Get('workspaces/:slug/api-keys')
  async listApiKeys(@Param('slug') slug: string): Promise<{
    data: Array<{
      id: string;
      key_prefix: string;
      scope: string;
      label: string | null;
      last_used_at: string | null;
      revoked_at: string | null;
      created_at: string;
    }>;
  }> {
    const ws = await this.workspaces.findBySlug(slug);
    const rows = await this.prisma.apiKey.findMany({
      where: { workspaceId: ws.id },
      orderBy: { createdAt: 'desc' },
    });
    return {
      data: rows.map((r) => ({
        id: r.id,
        key_prefix: r.keyPrefix,
        scope: r.scope,
        label: r.label,
        last_used_at: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
        revoked_at: r.revokedAt ? r.revokedAt.toISOString() : null,
        created_at: r.createdAt.toISOString(),
      })),
    };
  }

  @Post('workspaces/:slug/api-keys')
  @HttpCode(201)
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
  async listAllApiKeys(): Promise<{
    data: Array<{
      id: string;
      workspace_slug: string;
      workspace_name: string;
      key_prefix: string;
      scope: string;
      label: string | null;
      last_used_at: string | null;
      revoked_at: string | null;
      created_at: string;
    }>;
  }> {
    const rows = await this.prisma.apiKey.findMany({
      orderBy: [{ revokedAt: 'asc' }, { lastUsedAt: 'desc' }],
      include: { workspace: { select: { slug: true, name: true } } },
    });
    return {
      data: rows.map((r) => ({
        id: r.id,
        workspace_slug: r.workspace.slug,
        workspace_name: r.workspace.name,
        key_prefix: r.keyPrefix,
        scope: r.scope,
        label: r.label,
        last_used_at: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
        revoked_at: r.revokedAt ? r.revokedAt.toISOString() : null,
        created_at: r.createdAt.toISOString(),
      })),
    };
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
  async listEndpoints(@Param('slug') slug: string): Promise<unknown> {
    const ws = await this.workspaces.findBySlug(slug);
    return { data: await this.webhooks.list(ws.id) };
  }

  @Get('webhook-deliveries')
  async listDeliveries(
    @Query('workspace') workspaceSlug: string | undefined,
    @Query('status') status: string | undefined,
    @Query('event') event: string | undefined,
    @Query('limit') limitRaw: string | undefined,
  ): Promise<{
    data: Array<{
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
    }>;
  }> {
    const limit = clampInt(limitRaw, 100, 1, 500);
    const workspaceId = workspaceSlug
      ? (await this.workspaces.findBySlug(workspaceSlug)).id
      : undefined;
    const rows = await this.prisma.webhookDelivery.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(event ? { event } : {}),
        ...(workspaceId ? { endpoint: { workspaceId } } : {}),
      },
      include: {
        endpoint: {
          include: { workspace: { select: { slug: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return {
      data: rows.map((r) => ({
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
      })),
    };
  }

  // ─── Token debug (operator-only) ────────────────────────────────────────

  @Get('accounts/:id/access-token')
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
