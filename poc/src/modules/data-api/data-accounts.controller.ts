// InsightIQ-compatible accounts / users / work-platforms endpoints.
// Mounted at /v1/* — Basic auth, workspace-scoped.

import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { PrismaService } from "@shared/database/prisma.service";
import { AccountsService } from "@modules/accounts/accounts.service";
import {
  listEnvelope,
  WORK_PLATFORMS,
  type ApiListEnvelope,
} from "@modules/data-schema";
import type { Platform } from "@modules/accounts/products.catalog";
import {
  ApiBasicAuthGuard,
  type RequestWithApiWorkspace,
} from "./basic-auth.guard";
import { ApiAccountResolver } from "./account-resolver.service";
import { ApiReadService } from "./read.service";
import { accountView, userView, type SyncJobLite } from "./views";
import { notFound, parseOffsetLimit } from "./http";

@Controller("v1")
@UseGuards(ApiBasicAuthGuard)
export class DataAccountsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: ApiAccountResolver,
    private readonly read: ApiReadService,
    private readonly accounts: AccountsService,
  ) {}

  private ws(req: RequestWithApiWorkspace): string {
    return req.apiWorkspaceId as string;
  }

  @Get("accounts")
  async listAccounts(
    @Req() req: RequestWithApiWorkspace,
    @Query("offset") offsetRaw: string | undefined,
    @Query("limit") limitRaw: string | undefined,
  ): Promise<ApiListEnvelope<Record<string, unknown>>> {
    const { offset, limit } = parseOffsetLimit(offsetRaw, limitRaw);
    const all = await this.resolver.accountsFor(this.ws(req));
    const page = all.slice(offset, offset + limit);
    const jobs = await this.jobsByAccount(page.map((a) => a.id));
    const data = page.map((a) =>
      accountView(a, jobs.get(a.id.toString()) ?? [], null),
    );
    return listEnvelope(data, { offset, limit });
  }

  @Get("accounts/:id")
  async getAccount(
    @Req() req: RequestWithApiWorkspace,
    @Param("id") id: string,
  ): Promise<Record<string, unknown>> {
    const acc = await this.resolver.byAccountUuid(this.ws(req), id);
    if (!acc)
      throw notFound(
        "incorrect_account_id",
        "Requested account id does not exist",
      );
    const jobs =
      (await this.jobsByAccount([acc.id])).get(acc.id.toString()) ?? [];
    const profile = await this.read.profileByAccountPk(acc.id.toString());
    return accountView(acc, jobs, profile?.image_url ?? null);
  }

  /**
   * Soft-disconnect a single account by its external UUID. Stops all data
   * collection (drops the OAuth token, parks the sync jobs, and inbound
   * webhooks skip disconnected rows) and emits ACCOUNTS.DISCONNECTED, but
   * KEEPS historical data. Lets a consumer remove one of two coexisting
   * Instagram connections (ig_direct vs fb_login) without touching the other.
   * Workspace-scoped — cross-tenant ids 404.
   */
  @Delete("accounts/:id")
  async disconnectAccount(
    @Req() req: RequestWithApiWorkspace,
    @Param("id") id: string,
  ): Promise<Record<string, unknown>> {
    const ws = this.ws(req);
    const acc = await this.resolver.byAccountUuid(ws, id);
    if (!acc)
      throw notFound(
        "incorrect_account_id",
        "Requested account id does not exist",
      );
    const result = await this.accounts.disconnectAccount(acc.id, ws);
    if (!result)
      throw notFound(
        "incorrect_account_id",
        "Requested account id does not exist",
      );
    return result as unknown as Record<string, unknown>;
  }

  @Get("users")
  async listUsers(
    @Req() req: RequestWithApiWorkspace,
    @Query("offset") offsetRaw: string | undefined,
    @Query("limit") limitRaw: string | undefined,
  ): Promise<ApiListEnvelope<Record<string, unknown>>> {
    const { offset, limit } = parseOffsetLimit(offsetRaw, limitRaw);
    const users = await this.resolver.usersFor(this.ws(req));
    const page = users.slice(offset, offset + limit);
    return listEnvelope(page.map(userView), { offset, limit });
  }

  @Get("users/:id")
  async getUser(
    @Req() req: RequestWithApiWorkspace,
    @Param("id") id: string,
  ): Promise<Record<string, unknown>> {
    const user = await this.resolver.byUserUuid(this.ws(req), id);
    if (!user)
      throw notFound("incorrect_user_id", "Requested user id does not exist");
    return userView(user);
  }

  @Get("work-platforms")
  listWorkPlatforms(): ApiListEnvelope<Record<string, unknown>> {
    const data = Object.entries(WORK_PLATFORMS).map(([platform, wp]) => ({
      id: wp.id,
      name: wp.name,
      logo_url: wp.logo_url,
      category: "SOCIAL",
      status: "ACTIVE",
      internal_platform: platform,
    }));
    return listEnvelope(data, { offset: 0, limit: data.length });
  }

  @Get("work-platforms/:id")
  getWorkPlatform(@Param("id") id: string): Record<string, unknown> {
    const found = Object.entries(WORK_PLATFORMS).find(([, wp]) => wp.id === id);
    if (!found)
      throw notFound(
        "incorrect_work_platform_id",
        "Requested work platform id does not exist",
      );
    const [platform, wp] = found;
    return {
      id: wp.id,
      name: wp.name,
      logo_url: wp.logo_url,
      category: "SOCIAL",
      status: "ACTIVE",
      internal_platform: platform as Platform,
    };
  }

  /** Batch sync_jobs by account for the sync-state block. */
  private async jobsByAccount(
    ids: bigint[],
  ): Promise<Map<string, SyncJobLite[]>> {
    const out = new Map<string, SyncJobLite[]>();
    if (ids.length === 0) return out;
    const rows = await this.prisma.syncJob.findMany({
      where: { accountId: { in: ids } },
      select: {
        accountId: true,
        product: true,
        status: true,
        lastSuccessAt: true,
      },
    });
    for (const r of rows) {
      const key = r.accountId.toString();
      const list = out.get(key) ?? [];
      list.push({
        product: r.product,
        status: r.status,
        lastSuccessAt: r.lastSuccessAt,
      });
      out.set(key, list);
    }
    return out;
  }
}
