import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import axios from 'axios';
import { Worker, Job } from 'bullmq';
import { PrismaService } from '@shared/database/prisma.service';
import { BullmqService, QueueName } from '@shared/redis/bullmq.service';

const QUEUE: QueueName = 'delivery';
const ALLOWED_EVENTS: ReadonlyArray<string> = [
  'account.connected',
  'account.disconnected',
  'account.refreshed',
  'token.refresh_failed',
  'token.expired',
];

// Retry schedule (1m, 5m, 30m, 2h, 12h, 24h). Indexed by attempt count
// AFTER the failed attempt — so attempt=1 means we just failed once and
// will retry in 1 minute.
const RETRY_DELAYS_MS: ReadonlyArray<number> = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  12 * 60 * 60_000,
  24 * 60 * 60_000,
];

interface DeliveryJob {
  deliveryId: string;
}

export interface RegisterEndpointInput {
  workspaceId: string;
  url: string;
  events: ReadonlyArray<string>;
  description?: string;
}

export interface RegisteredEndpoint {
  id: string;
  url: string;
  events: ReadonlyArray<string>;
  active: boolean;
  description: string | null;
  /** Signing secret returned exactly ONCE on create. Re-fetches will be null. */
  secret?: string;
  createdAt: string;
}

@Injectable()
export class OutboundWebhooksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboundWebhooksService.name);
  private worker: Worker<DeliveryJob> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bull: BullmqService,
  ) {}

  onModuleInit(): void {
    // Stand up the delivery worker inside the API process for now. A
    // dedicated worker container can be added later by registering this
    // module in the worker bootstrap too.
    this.worker = this.bull.getWorker<DeliveryJob>(
      QUEUE,
      async (job: Job<DeliveryJob>) => this.handleDelivery(job),
      { concurrency: 4 },
    );
    this.logger.log('Webhook delivery worker started');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  // ─── CRUD ───────────────────────────────────────────────────────────────

  async register(input: RegisterEndpointInput): Promise<RegisteredEndpoint> {
    if (!/^https?:\/\//.test(input.url)) {
      throw new BadRequestException('url must start with http:// or https://');
    }
    const events = (input.events ?? []).filter((e) =>
      ALLOWED_EVENTS.includes(e),
    );
    if (events.length === 0) {
      throw new BadRequestException(
        `events must include at least one of: ${ALLOWED_EVENTS.join(', ')}`,
      );
    }
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const row = await this.prisma.webhookEndpoint.create({
      data: {
        workspaceId: input.workspaceId,
        url: input.url,
        secret,
        events,
        description: input.description ?? null,
      },
    });
    return this.toView(row, secret);
  }

  async list(workspaceId: string): Promise<RegisteredEndpoint[]> {
    const rows = await this.prisma.webhookEndpoint.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toView(r));
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const row = await this.prisma.webhookEndpoint.findUnique({ where: { id } });
    if (!row || row.workspaceId !== workspaceId) {
      // Treat cross-tenant + missing identically so existence can't leak.
      return;
    }
    await this.prisma.webhookEndpoint.delete({ where: { id } });
  }

  // ─── Emit + deliver ─────────────────────────────────────────────────────

  /**
   * Persist a delivery row per subscribed endpoint and enqueue dispatch
   * jobs. Best-effort — failure to enqueue is logged but never blocks the
   * caller (we don't want a Redis outage to break account seeding).
   */
  async emit(
    workspaceId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!ALLOWED_EVENTS.includes(event)) {
      this.logger.warn(`Refusing to emit unknown event: ${event}`);
      return;
    }
    try {
      const endpoints = await this.prisma.webhookEndpoint.findMany({
        where: { workspaceId, active: true },
      });
      const subscribed = endpoints.filter((e) =>
        Array.isArray(e.events) && (e.events as unknown as string[]).includes(event),
      );
      for (const endpoint of subscribed) {
        const delivery = await this.prisma.webhookDelivery.create({
          data: {
            endpointId: endpoint.id,
            event,
            payload: payload as object,
            status: 'pending',
          },
        });
        await this.bull
          .getQueue<DeliveryJob>(QUEUE)
          .add('webhook', { deliveryId: delivery.id }, { jobId: delivery.id });
      }
    } catch (err: unknown) {
      this.logger.error(
        `emit('${event}', workspace=${workspaceId}) failed: ${describe(err)}`,
      );
    }
  }

  // ─── Worker ─────────────────────────────────────────────────────────────

  private async handleDelivery(job: Job<DeliveryJob>): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: job.data.deliveryId },
      include: { endpoint: true },
    });
    if (!delivery) {
      this.logger.warn(`Delivery ${job.data.deliveryId} not found, skipping`);
      return;
    }
    if (delivery.status === 'delivered' || delivery.status === 'abandoned') {
      return;
    }

    const ts = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify(delivery.payload);
    const sig = createHmac('sha256', delivery.endpoint.secret)
      .update(`${ts}.${body}`)
      .digest('hex');

    const attempts = delivery.attempts + 1;
    try {
      const res = await axios.post(delivery.endpoint.url, body, {
        timeout: 10_000,
        validateStatus: () => true,
        proxy: false,
        headers: {
          'Content-Type': 'application/json',
          'X-Camaleonic-Event': delivery.event,
          'X-Camaleonic-Delivery': delivery.id,
          'X-Camaleonic-Signature': `t=${ts},v1=${sig}`,
        },
      });
      if (res.status >= 200 && res.status < 300) {
        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            attempts,
            status: 'delivered',
            lastResponseCode: res.status,
            lastError: null,
            nextRetryAt: null,
            deliveredAt: new Date(),
          },
        });
        return;
      }
      await this.scheduleRetry(delivery.id, attempts, res.status, null);
    } catch (err: unknown) {
      await this.scheduleRetry(delivery.id, attempts, null, describe(err));
    }
  }

  private async scheduleRetry(
    id: string,
    attempts: number,
    code: number | null,
    error: string | null,
  ): Promise<void> {
    // attempts is 1-indexed (first failure = 1). RETRY_DELAYS_MS[attempts-1]
    // is the delay until the NEXT attempt.
    if (attempts >= RETRY_DELAYS_MS.length + 1) {
      await this.prisma.webhookDelivery.update({
        where: { id },
        data: {
          attempts,
          status: 'abandoned',
          lastResponseCode: code,
          lastError: error,
          nextRetryAt: null,
        },
      });
      return;
    }
    const delayMs = RETRY_DELAYS_MS[attempts - 1];
    const nextRetryAt = new Date(Date.now() + delayMs);
    await this.prisma.webhookDelivery.update({
      where: { id },
      data: {
        attempts,
        status: 'failed',
        lastResponseCode: code,
        lastError: error,
        nextRetryAt,
      },
    });
    await this.bull
      .getQueue<DeliveryJob>(QUEUE)
      .add('webhook', { deliveryId: id }, {
        delay: delayMs,
        jobId: `${id}:r${attempts}`,
      });
  }

  private toView(
    row: {
      id: string;
      url: string;
      events: unknown;
      active: boolean;
      description: string | null;
      createdAt: Date;
    },
    secret?: string,
  ): RegisteredEndpoint {
    return {
      id: row.id,
      url: row.url,
      events: Array.isArray(row.events) ? (row.events as string[]) : [],
      active: row.active,
      description: row.description,
      createdAt: row.createdAt.toISOString(),
      ...(secret ? { secret } : {}),
    };
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
