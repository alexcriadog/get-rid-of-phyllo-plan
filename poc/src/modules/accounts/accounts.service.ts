import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import { AesLocalService } from '@shared/crypto/aes-local.service';

export type Platform = 'instagram' | 'facebook';

export interface SeedAccountInput {
  platform: Platform;
  accessToken: string;
  canonicalUserId: string;
  handle?: string;
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
  facebook: ['identity', 'audience', 'engagement_new', 'stories'],
};

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aes: AesLocalService,
  ) {}

  async seedAccount(input: SeedAccountInput): Promise<SeedAccountResult> {
    const products = PRODUCTS_BY_PLATFORM[input.platform];
    if (!products) {
      throw new Error(`Unsupported platform: ${input.platform}`);
    }

    const ciphertext = this.aes.encrypt(input.accessToken);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
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
        },
        update: {
          handle: input.handle ?? undefined,
          status: 'ready',
        },
      });

      await tx.oAuthToken.upsert({
        where: { accountId: account.id },
        create: {
          accountId: account.id,
          accessTokenCiphertext: ciphertext,
          scopes: (input.metadata?.scopes as Prisma.InputJsonValue) ?? [],
        },
        update: {
          accessTokenCiphertext: ciphertext,
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
