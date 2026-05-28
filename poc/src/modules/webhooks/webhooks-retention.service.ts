// Daily retention sweep for the webhook tables.
//
// InboundWebhookLog grows unbounded — every event Meta pushes adds one row
// with a (truncated, but PII-laden) payload snippet. WebhookDelivery has
// the same problem for outbound. Without retention the JSON columns
// eventually become the dominant cost in the DB.
//
// Policy:
//   - InboundWebhookLog        → delete after INBOUND_LOG_RETENTION_DAYS
//                                (default 30). All rows older than the
//                                cutoff go.
//   - WebhookDelivery          → delete after OUTBOUND_DELIVERY_RETENTION_DAYS
//                                (default 90), but ONLY if
//                                status ∈ {delivered, abandoned}. pending
//                                and failed deliveries stay forever so the
//                                operator can see + manually retry them.
//
// Implementation notes:
//   - DELETE in batches of BATCH_SIZE rows so a huge backlog doesn't lock
//     the table on the first run. MySQL holds metadata locks for the
//     duration of a single DELETE; we yield between batches.
//   - WEBHOOKS_RETENTION_DRY_RUN=1 env disables the writes — first prod
//     run is meant to be in dry-run so the operator can see "n rows
//     would be deleted" before committing.
//   - Validates retention days >= 1 at startup. Misconfiguration that
//     would delete everything fails loud at boot rather than silently at
//     3 AM.

import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@shared/database/prisma.service';

const BATCH_SIZE = 1000;
const DEFAULT_INBOUND_DAYS = 30;
const DEFAULT_OUTBOUND_DAYS = 90;

@Injectable()
export class WebhooksRetentionService
  implements OnModuleInit, OnApplicationBootstrap
{
  private readonly logger = new Logger(WebhooksRetentionService.name);
  private inboundDays = DEFAULT_INBOUND_DAYS;
  private outboundDays = DEFAULT_OUTBOUND_DAYS;
  private dryRun = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const ind = this.config.get<string>('INBOUND_LOG_RETENTION_DAYS');
    const outd = this.config.get<string>('OUTBOUND_DELIVERY_RETENTION_DAYS');
    const dry = this.config.get<string>('WEBHOOKS_RETENTION_DRY_RUN');
    this.inboundDays = parsePositiveInt(
      ind,
      DEFAULT_INBOUND_DAYS,
      'INBOUND_LOG_RETENTION_DAYS',
    );
    this.outboundDays = parsePositiveInt(
      outd,
      DEFAULT_OUTBOUND_DAYS,
      'OUTBOUND_DELIVERY_RETENTION_DAYS',
    );
    this.dryRun = dry !== undefined && /^(1|true|yes|on)$/i.test(dry.trim());
    if (this.dryRun) {
      this.logger.warn(
        'WEBHOOKS_RETENTION_DRY_RUN is set — sweep will REPORT but not DELETE',
      );
    }
  }

  onApplicationBootstrap(): void {
    if (process.argv[2] !== 'api') {
      // Only the api process owns the cron (worker / scheduler shouldn't
      // duplicate it).
      this.logger.debug(
        'Retention cron lives on the api process — no-op bootstrap',
      );
      return;
    }
    this.logger.log(
      `Retention sweep scheduled (03:00 UTC daily). inbound=${this.inboundDays}d outbound=${this.outboundDays}d${this.dryRun ? ' [DRY RUN]' : ''}`,
    );
  }

  /**
   * Cron entry point. Runs at 03:00 UTC daily (low-traffic window).
   * Exposed as a public method so operators / tests can call it
   * synchronously.
   */
  @Cron('0 3 * * *', { name: 'webhooks-retention', timeZone: 'UTC' })
  async runRetention(): Promise<{
    inbound_deleted: number;
    outbound_deleted: number;
    duration_ms: number;
  }> {
    if (process.argv[2] !== 'api') {
      // Cron fires in every container by default; gate on the process role
      // so worker/scheduler don't race the api.
      return { inbound_deleted: 0, outbound_deleted: 0, duration_ms: 0 };
    }
    const startedAt = Date.now();
    const inboundCutoff = new Date(
      Date.now() - this.inboundDays * 24 * 60 * 60_000,
    );
    const outboundCutoff = new Date(
      Date.now() - this.outboundDays * 24 * 60 * 60_000,
    );

    const inboundDeleted = await this.sweepInbound(inboundCutoff);
    const outboundDeleted = await this.sweepOutbound(outboundCutoff);

    const ms = Date.now() - startedAt;
    this.logger.log(
      `Retention sweep complete in ${ms}ms — inbound=${inboundDeleted} outbound=${outboundDeleted}${this.dryRun ? ' [DRY RUN]' : ''}`,
    );
    return {
      inbound_deleted: inboundDeleted,
      outbound_deleted: outboundDeleted,
      duration_ms: ms,
    };
  }

  private async sweepInbound(cutoff: Date): Promise<number> {
    let total = 0;
    while (true) {
      const rows = await this.prisma.inboundWebhookLog.findMany({
        where: { receivedAt: { lt: cutoff } },
        select: { id: true },
        take: BATCH_SIZE,
      });
      if (rows.length === 0) break;
      if (!this.dryRun) {
        const ids = rows.map((r) => r.id);
        await this.prisma.inboundWebhookLog.deleteMany({
          where: { id: { in: ids } },
        });
      }
      total += rows.length;
      if (rows.length < BATCH_SIZE) break;
      await yieldToEventLoop();
    }
    return total;
  }

  private async sweepOutbound(cutoff: Date): Promise<number> {
    let total = 0;
    while (true) {
      const rows = await this.prisma.webhookDelivery.findMany({
        where: {
          status: { in: ['delivered', 'abandoned'] },
          createdAt: { lt: cutoff },
        },
        select: { id: true },
        take: BATCH_SIZE,
      });
      if (rows.length === 0) break;
      if (!this.dryRun) {
        const ids = rows.map((r) => r.id);
        await this.prisma.webhookDelivery.deleteMany({
          where: { id: { in: ids } },
        });
      }
      total += rows.length;
      if (rows.length < BATCH_SIZE) break;
      await yieldToEventLoop();
    }
    return total;
  }
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  envName: string,
): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(
      `${envName} must be a positive integer (got: ${JSON.stringify(raw)}). ` +
        `Refusing to start — a zero/negative value would delete every row in the table.`,
    );
  }
  return n;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
