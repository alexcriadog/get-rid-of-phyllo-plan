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
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import { BullmqService, QueueName } from '@shared/redis/bullmq.service';
import {
  shouldRequireHttps,
  validateWebhookTarget,
} from './webhook-target-validator';

/** Maximum serialised payload size, bytes. Larger emits are rejected at
 *  the caller to prevent webhook channels from being used as exfil paths
 *  or from generating very large DB rows. */
const PAYLOAD_MAX_BYTES = 256_000;

const QUEUE: QueueName = 'delivery';
export const ALLOWED_EVENTS: ReadonlyArray<string> = [
  // ─── Lifecycle (Phase B of webhooks plan v1) ────────────────────────────
  'account.connected',
  'account.disconnected',
  'account.refreshed',
  'token.refresh_failed',
  'token.expired',
  // Test ping: never emitted by an automated flow; only by the explicit
  // POST /v1/webhook-endpoints/:id/test and the admin "send test
  // webhook" button. Bypasses the subscription filter.
  'webhook.test',
  // ─── Data-update events (data-webhooks plan, Phase C/D) ─────────────────
  // Fire when a sync_job persists new items for the product, or on every
  // successful snapshot sync for non-list products. Cadence (immediate /
  // hourly / daily) is operator-configured per workspace × product.
  'data.identity.updated',
  'data.audience.updated',
  'data.engagement_new.updated',
  'data.engagement_deep.updated',
  'data.stories.updated',
  'data.mentions.updated',
  'data.comments.updated',
  'data.ratings.updated',
  'data.ads.updated',
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
    // Tunable so a deep delivery backlog (e.g. a noisy data.* fan-out) can
    // be drained faster by raising the env without a code change. Parsed
    // defensively: non-numeric / out-of-range falls back to 4.
    const raw = Number(process.env.WEBHOOK_DELIVERY_CONCURRENCY);
    const concurrency = Number.isInteger(raw) && raw >= 1 && raw <= 64 ? raw : 4;
    this.worker = this.bull.getWorker<DeliveryJob>(
      QUEUE,
      async (job: Job<DeliveryJob>) => this.handleDelivery(job),
      { concurrency },
    );
    this.logger.log(`Webhook delivery worker started (concurrency=${concurrency})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  // ─── CRUD ───────────────────────────────────────────────────────────────

  async register(input: RegisterEndpointInput): Promise<RegisteredEndpoint> {
    // URL is already validated by the controller via validateWebhookTarget
    // (scheme + length + SSRF). This service-level guard remains as a
    // defence-in-depth tripwire if a future caller forgets the validator.
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

  async update(
    workspaceId: string,
    id: string,
    patch: {
      url?: string;
      events?: ReadonlyArray<string>;
      description?: string | null;
      active?: boolean;
    },
  ): Promise<RegisteredEndpoint> {
    const row = await this.prisma.webhookEndpoint.findUnique({ where: { id } });
    if (!row || row.workspaceId !== workspaceId) {
      throw new BadRequestException('Webhook endpoint not found');
    }
    // events: validate against the allowlist BEFORE writing. We accept
    // any subset; the controller already enforces min/max size.
    const events =
      patch.events === undefined
        ? undefined
        : patch.events.filter((e) => ALLOWED_EVENTS.includes(e));
    if (events !== undefined && events.length === 0) {
      throw new BadRequestException(
        `events must include at least one of: ${ALLOWED_EVENTS.join(', ')}`,
      );
    }
    const updated = await this.prisma.webhookEndpoint.update({
      where: { id },
      data: {
        ...(patch.url !== undefined ? { url: patch.url } : {}),
        ...(events !== undefined ? { events: events as string[] } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
      },
    });
    return this.toView(updated);
  }

  /**
   * Rotate the signing secret. The old secret becomes invalid immediately
   * (no grace period). Returns the new value once — losing it requires
   * another rotation.
   */
  async rotateSecret(
    workspaceId: string,
    id: string,
  ): Promise<{ id: string; secret: string; rotated_at: string }> {
    const row = await this.prisma.webhookEndpoint.findUnique({ where: { id } });
    if (!row || row.workspaceId !== workspaceId) {
      throw new BadRequestException('Webhook endpoint not found');
    }
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const updated = await this.prisma.webhookEndpoint.update({
      where: { id },
      data: { secret },
    });
    return {
      id: updated.id,
      secret,
      rotated_at: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Enqueue a webhook.test delivery to this endpoint. Bypasses the
   * subscription filter — the client doesn't need to subscribe to
   * webhook.test to receive an explicitly-requested test.
   */
  async sendTest(
    workspaceId: string,
    id: string,
  ): Promise<{ delivery_id: string; status: 'queued' }> {
    const row = await this.prisma.webhookEndpoint.findUnique({ where: { id } });
    if (!row || row.workspaceId !== workspaceId || !row.active) {
      throw new BadRequestException('Webhook endpoint not found or inactive');
    }
    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        endpointId: row.id,
        event: 'webhook.test',
        payload: {
          endpoint_id: row.id,
          message: 'test',
          occurred_at: new Date().toISOString(),
        },
        status: 'pending',
      },
    });
    await this.bull
      .getQueue<DeliveryJob>(QUEUE)
      .add('webhook', { deliveryId: delivery.id }, { jobId: delivery.id });
    return { delivery_id: delivery.id, status: 'queued' };
  }

  /**
   * List deliveries for a given endpoint, paginated by createdAt+id
   * cursor. Returns a Paginated<DeliverySummary> envelope. Cross-tenant
   * lookups return an empty page.
   */
  async listDeliveries(
    workspaceId: string,
    endpointId: string,
    opts: { limit: number; cursor: string | null },
  ): Promise<{
    data: Array<{
      id: string;
      event: string;
      status: string;
      attempts: number;
      last_response_code: number | null;
      last_error: string | null;
      next_retry_at: string | null;
      created_at: string;
      delivered_at: string | null;
    }>;
    meta: { count: number; has_more: boolean; next_cursor: string | null };
  }> {
    const endpoint = await this.prisma.webhookEndpoint.findUnique({
      where: { id: endpointId },
    });
    if (!endpoint || endpoint.workspaceId !== workspaceId) {
      return { data: [], meta: { count: 0, has_more: false, next_cursor: null } };
    }

    // We use a composite createdAt+id cursor (delivery PKs are cuid).
    // Imported lazily to keep this service's import footprint minimal.
    const {
      decodeCompositeCursor,
      encodeCompositeCursor,
      paginate,
    } = await import('@shared/pagination/cursor');
    const cursor = decodeCompositeCursor(opts.cursor);
    return paginate(
      opts.limit,
      (take) =>
        this.prisma.webhookDelivery.findMany({
          where: {
            endpointId,
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
        event: r.event,
        status: r.status,
        attempts: r.attempts,
        last_response_code: r.lastResponseCode,
        last_error: r.lastError,
        next_retry_at: r.nextRetryAt ? r.nextRetryAt.toISOString() : null,
        created_at: r.createdAt.toISOString(),
        delivered_at: r.deliveredAt ? r.deliveredAt.toISOString() : null,
      }),
      (r) => encodeCompositeCursor(r.createdAt, r.id),
    );
  }

  /**
   * Single-delivery detail for the client. Includes payload but NOT
   * response_body — that's admin-only (Phase D capture). Cross-tenant
   * reads return null.
   */
  async getDelivery(
    workspaceId: string,
    endpointId: string,
    deliveryId: string,
  ): Promise<{
    id: string;
    endpoint_id: string;
    event: string;
    payload: unknown;
    status: string;
    attempts: number;
    last_response_code: number | null;
    last_error: string | null;
    next_retry_at: string | null;
    created_at: string;
    delivered_at: string | null;
  } | null> {
    const row = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { endpoint: { select: { workspaceId: true } } },
    });
    if (
      !row ||
      row.endpointId !== endpointId ||
      row.endpoint.workspaceId !== workspaceId
    ) {
      return null;
    }
    return {
      id: row.id,
      endpoint_id: row.endpointId,
      event: row.event,
      payload: row.payload,
      status: row.status,
      attempts: row.attempts,
      last_response_code: row.lastResponseCode,
      last_error: row.lastError,
      next_retry_at: row.nextRetryAt ? row.nextRetryAt.toISOString() : null,
      created_at: row.createdAt.toISOString(),
      delivered_at: row.deliveredAt ? row.deliveredAt.toISOString() : null,
    };
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
    // Reject oversized payloads before persisting. 256 KB is well above any
    // sensible business event but well below the DB row limit; emits that
    // overshoot are programmer errors (e.g. accidentally serialising an
    // adapter response) and should fail loudly, not silently truncate.
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    if (payloadBytes > PAYLOAD_MAX_BYTES) {
      this.logger.error(
        `emit('${event}') rejected: payload ${payloadBytes}B exceeds ${PAYLOAD_MAX_BYTES}B cap`,
      );
      throw new BadRequestException(
        `webhook payload too large (${payloadBytes} bytes, max ${PAYLOAD_MAX_BYTES})`,
      );
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
      if (err instanceof BadRequestException) throw err;
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

    // Anti DNS-rebinding: re-validate the target URL immediately before
    // sending. If a malicious workspace has flipped its DNS to point at a
    // private IP since registration, this catches it and marks the
    // delivery as a terminal failure (no retry) so we don't keep probing.
    const targetCheck = await validateWebhookTarget(delivery.endpoint.url, {
      requireHttps: shouldRequireHttps(process.env),
    });
    if (!targetCheck.ok) {
      this.logger.warn(
        `Delivery ${delivery.id} aborted by SSRF re-check: ${targetCheck.reason} (${targetCheck.detail ?? ''})`,
      );
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts: delivery.attempts + 1,
          status: 'abandoned',
          lastResponseCode: null,
          lastError: `ssrf_rejected:${targetCheck.reason}`,
          nextRetryAt: null,
        },
      });
      return;
    }

    const ts = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify(delivery.payload);
    // InsightIQ-format endpoints (PLAN-canonical-data-api.md §5) sign with a
    // bare `Webhook-Signatures` header = HMAC-SHA256(secret, raw body), hex —
    // exactly what InsightIQ sends. Native endpoints keep the timestamped
    // X-Camaleonic-Signature scheme.
    const isStandard =
      (delivery.endpoint as { format?: string }).format === 'standard';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (isStandard) {
      const sig = createHmac('sha256', delivery.endpoint.secret).update(body).digest('hex');
      headers['Webhook-Signatures'] = sig;
    } else {
      const sig = createHmac('sha256', delivery.endpoint.secret)
        .update(`${ts}.${body}`)
        .digest('hex');
      headers['X-Camaleonic-Event'] = delivery.event;
      headers['X-Camaleonic-Delivery'] = delivery.id;
      headers['X-Camaleonic-Signature'] = `t=${ts},v1=${sig}`;
    }

    const attempts = delivery.attempts + 1;
    const startedAt = Date.now();
    try {
      const res = await axios.post(delivery.endpoint.url, body, {
        timeout: 10_000,
        validateStatus: () => true,
        proxy: false,
        responseType: 'text',
        // Caps the bytes axios will accept BEFORE we truncate ourselves —
        // saves memory on a misbehaving client that floods the response.
        maxContentLength: 64_000,
        transitional: { clarifyTimeoutError: true },
        headers,
      });
      const durationMs = Date.now() - startedAt;
      const responseBody = truncateBody(res.data);
      const responseHeaders = pickHeaders(res.headers);
      if (res.status >= 200 && res.status < 300) {
        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            attempts,
            status: 'delivered',
            lastResponseCode: res.status,
            lastError: null,
            responseBody,
            responseHeaders: (responseHeaders ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            durationMs,
            nextRetryAt: null,
            deliveredAt: new Date(),
          },
        });
        return;
      }
      await this.scheduleRetry(delivery.id, attempts, res.status, null, {
        responseBody,
        responseHeaders,
        durationMs,
      });
    } catch (err: unknown) {
      await this.scheduleRetry(
        delivery.id,
        attempts,
        null,
        describe(err),
        { responseBody: null, responseHeaders: null, durationMs: Date.now() - startedAt },
      );
    }
  }

  private async scheduleRetry(
    id: string,
    attempts: number,
    code: number | null,
    error: string | null,
    capture: {
      responseBody: string | null;
      responseHeaders: object | null;
      durationMs: number | null;
    } = { responseBody: null, responseHeaders: null, durationMs: null },
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
          responseBody: capture.responseBody,
          responseHeaders: (capture.responseHeaders ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          durationMs: capture.durationMs,
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
        responseBody: capture.responseBody,
        responseHeaders: (capture.responseHeaders ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        durationMs: capture.durationMs,
        nextRetryAt,
      },
    });
    // BullMQ rejects custom jobIds containing ':' — historical retries
    // surfaced "Custom Id cannot contain :" on every reschedule.
    await this.bull
      .getQueue<DeliveryJob>(QUEUE)
      .add('webhook', { deliveryId: id }, {
        delay: delayMs,
        jobId: `${id}-r${attempts}`,
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

/** Stringify axios's response body and truncate to 4 KB so we don't load
 *  unbounded blobs into the DB or admin UI. Returns null on empty input. */
function truncateBody(data: unknown): string | null {
  if (data === null || data === undefined) return null;
  const s = typeof data === 'string' ? data : JSON.stringify(data);
  if (!s) return null;
  const MAX = 4_096;
  return s.length > MAX ? `${s.slice(0, MAX)}...[truncated]` : s;
}

/** Capture only the response headers that help debugging — never the
 *  whole header set (some clients echo Authorization in their reply). */
function pickHeaders(headers: unknown): object | null {
  if (!headers || typeof headers !== 'object') return null;
  const ALLOWED = new Set([
    'content-type',
    'content-length',
    'x-request-id',
    'x-correlation-id',
    'date',
    'server',
  ]);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    if (!ALLOWED.has(k.toLowerCase())) continue;
    out[k] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  return Object.keys(out).length > 0 ? out : null;
}
