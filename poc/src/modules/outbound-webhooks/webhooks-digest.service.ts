// Digest cron — flushes pending_webhook_events buckets into webhook
// deliveries on the configured cadence.
//
// Buckets are written by DataEventDispatcher when the workspace's
// cadence for a (product) is "hourly" or "daily". This service is the
// other half: every :05 it sweeps hourly buckets older than 1 h, and
// every 09:05 UTC it sweeps daily buckets older than 24 h.
//
// Implementation notes:
//   - Only the `api` container fires the cron (process.argv[2] === 'api')
//     so worker / scheduler don't race it.
//   - Each bucket re-checks the endpoint's `events` array before
//     emitting — if the client unsubscribed between buffer-time and
//     flush-time, we drop the bucket silently.
//   - Failed BullMQ enqueues bubble up to the @nestjs/schedule logger;
//     the bucket is NOT deleted in that case so the next run retries.
//   - Batches of 1000 with a yield between iterations to keep the
//     event loop responsive on huge backlogs.

import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ulid } from 'ulid';
import { PrismaService } from '@shared/database/prisma.service';
import { RedisService } from '@shared/redis/redis.service';
import { runWithLock } from '@shared/redis/cron-lock';
import { OutboundWebhooksService } from './outbound-webhooks.service';

const BATCH_SIZE = 1000;
// Lock TTL must exceed the worst-case flush runtime (100 cycles × ~1k
// buckets). 10 min is comfortably above that; if a flush somehow runs
// longer the lock expires and the next tick can pick up.
const LOCK_TTL_MS = 10 * 60_000;

@Injectable()
export class WebhooksDigestService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WebhooksDigestService.name);
  // Unique per process — identifies who holds the lock for safe release.
  private readonly instanceToken = ulid();

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: OutboundWebhooksService,
    private readonly redis: RedisService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.argv[2] !== 'api') {
      this.logger.debug(
        'Digest cron lives on the api process — no-op bootstrap',
      );
      return;
    }
    this.logger.log(
      'Digest cron scheduled: hourly at :05, daily at 09:05 UTC',
    );
  }

  @Cron('5 * * * *', { name: 'webhooks-digest-hourly', timeZone: 'UTC' })
  async flushHourly(): Promise<{ flushed: number; failed: number }> {
    if (process.argv[2] !== 'api') return { flushed: 0, failed: 0 };
    const cutoff = new Date(Date.now() - 60 * 60_000);
    const res = await runWithLock(
      this.redis.client,
      this.redis.key('cron', 'webhooks-digest-hourly'),
      this.instanceToken,
      LOCK_TTL_MS,
      () => this.flush('hourly', cutoff),
    );
    if (!res.ran) {
      this.logger.debug('Hourly digest skipped — lock held by another instance');
      return { flushed: 0, failed: 0 };
    }
    return res.result ?? { flushed: 0, failed: 0 };
  }

  @Cron('5 9 * * *', { name: 'webhooks-digest-daily', timeZone: 'UTC' })
  async flushDaily(): Promise<{ flushed: number; failed: number }> {
    if (process.argv[2] !== 'api') return { flushed: 0, failed: 0 };
    const cutoff = new Date(Date.now() - 24 * 60 * 60_000);
    const locked = await runWithLock(
      this.redis.client,
      this.redis.key('cron', 'webhooks-digest-daily'),
      this.instanceToken,
      LOCK_TTL_MS,
      () => this.flush('daily', cutoff),
    );
    if (!locked.ran) {
      this.logger.debug('Daily digest skipped — lock held by another instance');
      return { flushed: 0, failed: 0 };
    }
    return locked.result ?? { flushed: 0, failed: 0 };
  }

  /**
   * Public so tests + ops can call it without waiting for cron.
   */
  async flush(
    cadence: 'hourly' | 'daily',
    cutoff: Date,
  ): Promise<{ flushed: number; failed: number }> {
    let flushed = 0;
    let failed = 0;
    let cycles = 0;

    while (true) {
      cycles += 1;
      const batch = await this.prisma.pendingWebhookEvent.findMany({
        where: { cadence, firstSeenAt: { lte: cutoff } },
        take: BATCH_SIZE,
        include: {
          endpoint: {
            select: {
              id: true,
              active: true,
              events: true,
              workspaceId: true,
            },
          },
        },
      });
      if (batch.length === 0) break;

      // Batch-load every account referenced by this batch in ONE query
      // instead of a findUnique per bucket (was N+1). Build a Map keyed
      // by stringified id (BigInt isn't a usable Map key across re-reads).
      const accountIds = [...new Set(batch.map((b) => b.accountId))];
      const accounts = await this.prisma.account.findMany({
        where: { id: { in: accountIds } },
        select: { id: true, platform: true, workspaceId: true, isTest: true },
      });
      const accountById = new Map(
        accounts.map((a) => [a.id.toString(), a]),
      );

      for (const bucket of batch) {
        try {
          const account = accountById.get(bucket.accountId.toString()) ?? null;
          const ok = await this.flushOne(bucket, account);
          if (ok) flushed += 1;
          else failed += 1;
        } catch (err) {
          this.logger.error(
            `Bucket ${bucket.id} flush failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          failed += 1;
        }
      }

      if (batch.length < BATCH_SIZE) break;
      // Keep event-loop responsive between batches.
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (cycles > 100) {
        // Safety valve: at 1000 buckets per cycle this caps at 100 k per
        // cron tick. Anything larger means upstream is wedged.
        this.logger.warn(
          `Digest flush ${cadence} aborted after 100 cycles; will resume next tick`,
        );
        break;
      }
    }

    if (flushed > 0 || failed > 0) {
      this.logger.log(
        `Digest flush ${cadence}: emitted=${flushed} failed=${failed}`,
      );
    }
    return { flushed, failed };
  }

  /**
   * Flush a single bucket. Returns true if the bucket was processed
   * (delivered or intentionally dropped) and the row deleted; false if
   * we hit a recoverable error and want to retry next cron.
   */
  private async flushOne(
    bucket: {
      id: string;
      endpointId: string;
      accountId: bigint;
      product: string;
      cadence: string;
      itemsAdded: number;
      sampleIds: unknown;
      firstSeenAt: Date;
      endpoint: {
        id: string;
        active: boolean;
        events: unknown;
        workspaceId: string;
      };
    },
    account: { platform: string; workspaceId: string; isTest: boolean } | null,
  ): Promise<boolean> {
    const eventName = `data.${bucket.product}.updated`;

    // Subscription re-check: client may have PATCHed events between
    // buffer-time and now. Drop silently — they explicitly chose not to
    // receive it.
    const events = Array.isArray(bucket.endpoint.events)
      ? (bucket.endpoint.events as string[])
      : [];
    if (!bucket.endpoint.active || !events.includes(eventName)) {
      await this.prisma.pendingWebhookEvent.delete({ where: { id: bucket.id } });
      return true;
    }

    // Account was batch-loaded by the caller. If it's gone or test-mode,
    // drop the bucket — there's no useful payload to send.
    if (!account || account.isTest) {
      await this.prisma.pendingWebhookEvent.delete({ where: { id: bucket.id } });
      return true;
    }

    const sampleIds = Array.isArray(bucket.sampleIds)
      ? (bucket.sampleIds as string[])
      : [];
    const now = new Date();
    await this.webhooks.emit(account.workspaceId, eventName, {
      account_id: bucket.accountId.toString(),
      platform: account.platform,
      workspace_id: account.workspaceId,
      product: bucket.product,
      items_added: bucket.itemsAdded,
      sample_ids: sampleIds,
      window_start: bucket.firstSeenAt.toISOString(),
      window_end: now.toISOString(),
      cadence: bucket.cadence,
      occurred_at: now.toISOString(),
    });
    await this.prisma.pendingWebhookEvent.delete({ where: { id: bucket.id } });
    return true;
  }
}
