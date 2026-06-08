// Phyllo-compatible accounts / users / work-platforms endpoints.
// Mounted at /phyllo/v1/* — Basic auth, workspace-scoped.

import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { PrismaService } from "@shared/database/prisma.service";
import {
  listEnvelope,
  WORK_PLATFORMS,
  type PhylloListEnvelope,
} from "@modules/phyllo-compat";
import type { Platform } from "@modules/accounts/products.catalog";
import {
  PhylloBasicAuthGuard,
  type RequestWithPhylloWorkspace,
} from "./basic-auth.guard";
import { PhylloAccountResolver } from "./phyllo-account-resolver.service";
import { PhylloReadService } from "./phyllo-read.service";
import { accountView, userView, type SyncJobLite } from "./phyllo-views";
import { notFound, parseOffsetLimit } from "./phyllo-http";

@Controller("phyllo/v1")
@UseGuards(PhylloBasicAuthGuard)
export class PhylloAccountsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PhylloAccountResolver,
    private readonly read: PhylloReadService,
  ) {}

  private ws(req: RequestWithPhylloWorkspace): string {
    return req.phylloWorkspaceId as string;
  }

  @Get("accounts")
  async listAccounts(
    @Req() req: RequestWithPhylloWorkspace,
    @Query("offset") offsetRaw: string | undefined,
    @Query("limit") limitRaw: string | undefined,
  ): Promise<PhylloListEnvelope<Record<string, unknown>>> {
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
    @Req() req: RequestWithPhylloWorkspace,
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

  @Get("users")
  async listUsers(
    @Req() req: RequestWithPhylloWorkspace,
    @Query("offset") offsetRaw: string | undefined,
    @Query("limit") limitRaw: string | undefined,
  ): Promise<PhylloListEnvelope<Record<string, unknown>>> {
    const { offset, limit } = parseOffsetLimit(offsetRaw, limitRaw);
    const users = await this.resolver.usersFor(this.ws(req));
    const page = users.slice(offset, offset + limit);
    return listEnvelope(page.map(userView), { offset, limit });
  }

  @Get("users/:id")
  async getUser(
    @Req() req: RequestWithPhylloWorkspace,
    @Param("id") id: string,
  ): Promise<Record<string, unknown>> {
    const user = await this.resolver.byUserUuid(this.ws(req), id);
    if (!user)
      throw notFound("incorrect_user_id", "Requested user id does not exist");
    return userView(user);
  }

  @Get("work-platforms")
  listWorkPlatforms(): PhylloListEnvelope<Record<string, unknown>> {
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
