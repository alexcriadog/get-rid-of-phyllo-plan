// Resolves Phyllo account/user UUIDs back to our internal rows, scoped to the
// authenticated workspace (tenancy enforcement). The Phyllo ids are
// deterministic UUIDv5 of our PKs, so we recompute them for the workspace's
// accounts and match — no reverse hash needed, and a uuid outside the
// workspace simply never matches (→ 404).

import { Injectable } from "@nestjs/common";
import { PrismaService } from "@shared/database/prisma.service";
import {
  phylloAccountId,
  phylloUserIdOrFallback,
} from "@modules/phyllo-compat";

export interface ResolvedAccount {
  id: bigint;
  platform: string;
  canonicalUserId: string;
  handle: string | null;
  displayName: string | null;
  status: string;
  endUserId: string | null;
  isTest: boolean;
  connectedAt: Date;
  disconnectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const CACHE_TTL_MS = 30_000;

@Injectable()
export class PhylloAccountResolver {
  private readonly cache = new Map<
    string,
    { rows: ResolvedAccount[]; expiresAt: number }
  >();

  constructor(private readonly prisma: PrismaService) {}

  async accountsFor(workspaceId: string): Promise<ResolvedAccount[]> {
    const now = Date.now();
    const hit = this.cache.get(workspaceId);
    if (hit && hit.expiresAt > now) return hit.rows;
    const rows = (await this.prisma.account.findMany({
      where: { workspaceId },
      select: {
        id: true,
        platform: true,
        canonicalUserId: true,
        handle: true,
        displayName: true,
        status: true,
        endUserId: true,
        isTest: true,
        connectedAt: true,
        disconnectedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })) as ResolvedAccount[];
    this.cache.set(workspaceId, { rows, expiresAt: now + CACHE_TTL_MS });
    return rows;
  }

  /** account UUID → row (workspace-scoped). */
  async byAccountUuid(
    workspaceId: string,
    accountUuid: string,
  ): Promise<ResolvedAccount | null> {
    const rows = await this.accountsFor(workspaceId);
    return (
      rows.find((r) => phylloAccountId(r.id.toString()) === accountUuid) ?? null
    );
  }

  /** Distinct end-users in the workspace, mapped to Phyllo user uuids. */
  async usersFor(
    workspaceId: string,
  ): Promise<
    Array<{ uuid: string; endUserId: string; createdAt: Date; updatedAt: Date }>
  > {
    const rows = await this.accountsFor(workspaceId);
    const byUser = new Map<
      string,
      { uuid: string; endUserId: string; createdAt: Date; updatedAt: Date }
    >();
    for (const r of rows) {
      const key = r.endUserId ?? `account:${r.id.toString()}`;
      const uuid = r.endUserId
        ? phylloUserIdOrFallback(r.endUserId, r.id.toString())
        : phylloUserIdOrFallback(null, r.id.toString());
      const existing = byUser.get(key);
      if (!existing) {
        byUser.set(key, {
          uuid,
          endUserId: r.endUserId ?? key,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        });
      } else if (r.createdAt < existing.createdAt) {
        existing.createdAt = r.createdAt;
      }
    }
    return [...byUser.values()];
  }

  async byUserUuid(
    workspaceId: string,
    userUuid: string,
  ): Promise<{
    uuid: string;
    endUserId: string;
    createdAt: Date;
    updatedAt: Date;
  } | null> {
    const users = await this.usersFor(workspaceId);
    return users.find((u) => u.uuid === userUuid) ?? null;
  }
}
