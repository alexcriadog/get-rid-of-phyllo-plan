import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '@shared/database/prisma.service';
import { BullMqService, SyncJobPayload } from '@shared/redis/bullmq.service';
import { ThrottleLockService } from '@modules/sync/throttle-lock.service';
import {
  ADAPTER_REGISTRY,
  AdapterRegistry,
} from '@modules/platforms/platforms.module';

const SYNC_QUEUE_NAME = 'sync';
const SUPPORTED_PRODUCTS: ReadonlyArray<string> = [
  'identity',
  'audience',
  'engagement_new',
  'stories',
];

const RefreshBodySchema = z
  .object({
    products: z.array(z.string().min(1)).optional(),
    reason: z.string().max(256).optional(),
  })
  .strict();

interface JobAccepted {
  product: string;
  job_id: string;
}

interface ManualRefreshResponse {
  account_id: string;
  reason: string | null;
  jobs: JobAccepted[];
  throttled: string[];
  rate_limited: string[];
}

@Controller()
export class ManualRefreshController {
  private readonly logger = new Logger(ManualRefreshController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bullmq: BullMqService,
    private readonly throttle: ThrottleLockService,
    @Inject(ADAPTER_REGISTRY) private readonly adapters: AdapterRegistry,
  ) {}

  @Post('v1/accounts/:id/refresh')
  @HttpCode(202)
  async refresh(
    @Param('id') rawId: string,
    @Body() body: unknown,
  ): Promise<ManualRefreshResponse> {
    const accountId = this.parseBigInt(rawId);
    const parsed = RefreshBodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid refresh payload',
        issues: parsed.error.issues,
      });
    }

    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, platform: true, status: true, syncTier: true },
    });
    if (!account) {
      throw new NotFoundException(`Account ${rawId} not found`);
    }

    const adapter = this.adapters[account.platform];
    const defaultProducts = adapter
      ? this.defaultProductsForAdapter(adapter)
      : [...SUPPORTED_PRODUCTS];

    const requested =
      parsed.data.products && parsed.data.products.length > 0
        ? parsed.data.products.filter((p) => SUPPORTED_PRODUCTS.includes(p))
        : defaultProducts;

    const unique = Array.from(new Set(requested));
    const jobs: JobAccepted[] = [];
    const throttled: string[] = [];
    const rateLimited: string[] = [];

    if (account.syncTier === 'paused' || account.status === 'needs_reauth') {
      // Treat a paused/needs-reauth account as throttled across every
      // requested product — caller can still see the reason in logs.
      this.logger.warn(
        `Manual refresh rejected: account ${rawId} status=${account.status} tier=${account.syncTier}`,
      );
      return {
        account_id: account.id.toString(),
        reason: parsed.data.reason ?? null,
        jobs: [],
        throttled: unique,
        rate_limited: [],
      };
    }

    const queue = this.bullmq.getQueue<SyncJobPayload>(SYNC_QUEUE_NAME);

    for (const product of unique) {
      const acquired = await this.throttle.acquireManualRefresh(account.id, product);
      if (!acquired) {
        throttled.push(product);
        continue;
      }

      const syncJob = await this.prisma.syncJob.findUnique({
        where: { accountId_product: { accountId: account.id, product } },
        select: { id: true },
      });

      const payload: SyncJobPayload = {
        jobId: syncJob?.id.toString() ?? `adhoc-${account.id.toString()}-${product}`,
        accountId: account.id.toString(),
        product,
      };

      const addedJob = await queue.add('sync', payload, {
        priority: this.bullmq.toPriorityNumber('HIGH'),
        jobId: `refresh-${account.id.toString()}-${product}-${Date.now()}`,
        removeOnComplete: { age: 3600, count: 500 },
        removeOnFail: { age: 86_400, count: 200 },
      });

      jobs.push({ product, job_id: String(addedJob.id ?? '') });
    }

    return {
      account_id: account.id.toString(),
      reason: parsed.data.reason ?? null,
      jobs,
      throttled,
      rate_limited: rateLimited,
    };
  }

  private defaultProductsForAdapter(adapter: { fetchStories?: unknown }): string[] {
    const base = ['identity', 'audience', 'engagement_new'];
    if (typeof adapter.fetchStories === 'function') {
      base.push('stories');
    }
    return base;
  }

  private parseBigInt(raw: string): bigint {
    if (!/^\d+$/.test(raw)) {
      throw new BadRequestException(`Invalid account id: ${raw}`);
    }
    try {
      return BigInt(raw);
    } catch {
      throw new BadRequestException(`Invalid account id: ${raw}`);
    }
  }
}
