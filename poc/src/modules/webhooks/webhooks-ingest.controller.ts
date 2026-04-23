import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import { BullMqService, SyncJobPayload } from '@shared/redis/bullmq.service';
import { MetricsService } from '@shared/metrics/metrics.service';

const SYNC_QUEUE_NAME = 'sync';
const PAYLOAD_SNIPPET_MAX_BYTES = 2048;

/**
 * Map Meta field names to internal product identifiers. `stories` has a
 * dedicated handler; `media`, `comments`, `mentions`, `feed`, `videos`
 * all resolve to `engagement_new`.
 */
const FIELD_TO_PRODUCT: Readonly<Record<string, string>> = {
  media: 'engagement_new',
  comments: 'engagement_new',
  mentions: 'engagement_new',
  feed: 'engagement_new',
  videos: 'engagement_new',
  live_videos: 'engagement_new',
  story_insights: 'stories',
  stories: 'stories',
};

interface MetaChange {
  field?: string;
  value?: unknown;
}

interface MetaEntry {
  id?: string;
  time?: number;
  changes?: MetaChange[];
}

interface MetaEnvelope {
  object?: string;
  entry?: MetaEntry[];
}

@Controller('webhooks/ingest')
export class WebhooksIngestController {
  private readonly logger = new Logger(WebhooksIngestController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bullmq: BullMqService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Meta challenge verification. Runs at subscription time.
   */
  @Get('meta')
  async verifyMeta(
    @Query('hub.mode') mode: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.verify_token') verifyToken: string,
    @Res() res: Response,
  ): Promise<void> {
    const expected = process.env.META_WEBHOOK_VERIFY_TOKEN ?? '';
    if (mode !== 'subscribe' || !expected || verifyToken !== expected) {
      this.metrics.incr('webhook_verify_rejected', { platform: 'meta' });
      throw new ForbiddenException('Invalid verify token');
    }

    this.metrics.incr('webhook_verify_accepted', { platform: 'meta' });
    res.status(200).type('text/plain').send(challenge ?? '');
  }

  /**
   * Meta ingest. Verifies signature, dedupes by event_id, enqueues a
   * HIGH-priority sync job, returns 200 fast.
   */
  @Post('meta')
  @HttpCode(200)
  async ingestMeta(
    @Req() req: Request,
    @Headers('x-hub-signature-256') signatureHeader: string | undefined,
  ): Promise<void> {
    const rawBody = this.extractRawBody(req);
    const signatureValid = this.verifySignature(rawBody, signatureHeader);

    if (!signatureValid) {
      // Log the invalid attempt so the admin UI silence detector can show
      // these — use a synthetic event id so dedupe still works.
      const syntheticEventId = createHash('sha256').update(rawBody).digest('hex');
      await this.recordWebhook(
        'meta',
        syntheticEventId,
        false,
        this.snippet(rawBody),
        false,
        false,
      );
      this.metrics.incr('webhook_signature_invalid', { platform: 'meta' });
      throw new UnauthorizedException('Invalid signature');
    }

    let envelope: MetaEnvelope;
    try {
      envelope = JSON.parse(rawBody.toString('utf8')) as MetaEnvelope;
    } catch {
      throw new BadRequestException('Invalid JSON payload');
    }

    const entries = envelope.entry ?? [];
    if (entries.length === 0) {
      this.logger.warn('Meta webhook with no entries');
      return;
    }

    for (const entry of entries) {
      await this.handleEntry(entry, rawBody);
    }
  }

  private async handleEntry(entry: MetaEntry, rawBody: Buffer): Promise<void> {
    const change = entry.changes?.[0] ?? {};
    const entryId = typeof entry.id === 'string' ? entry.id : '';
    const entryTime = typeof entry.time === 'number' ? entry.time : 0;
    const eventId = createHash('sha256')
      .update(`${entryId}:${entryTime}:${JSON.stringify(change)}`)
      .digest('hex');

    const inserted = await this.recordWebhook(
      'meta',
      eventId,
      true,
      this.snippet(rawBody),
      false,
      false,
    );
    if (!inserted) {
      this.metrics.incr('webhook_duplicate', { platform: 'meta' });
      return;
    }

    const fieldName = typeof change.field === 'string' ? change.field : '';
    const product = FIELD_TO_PRODUCT[fieldName] ?? 'engagement_new';

    if (!entryId) {
      this.logger.warn(`Meta entry without id; cannot resolve account`);
      return;
    }

    const account = await this.prisma.account.findFirst({
      where: { canonicalUserId: entryId },
      select: { id: true, platform: true },
    });
    if (!account) {
      this.logger.warn(`No account for canonical_user_id=${entryId}`);
      this.metrics.incr('webhook_account_missing', { platform: 'meta' });
      return;
    }

    const syncJob = await this.prisma.syncJob.findUnique({
      where: { accountId_product: { accountId: account.id, product } },
      select: { id: true },
    });

    const payload: SyncJobPayload = {
      jobId: syncJob?.id.toString() ?? `webhook-${account.id.toString()}-${product}`,
      accountId: account.id.toString(),
      product,
    };

    const queue = this.bullmq.getQueue<SyncJobPayload>(SYNC_QUEUE_NAME);
    await queue.add('sync', payload, {
      priority: this.bullmq.toPriorityNumber('HIGH'),
      jobId: `webhook-${eventId}`,
      removeOnComplete: { age: 3600, count: 500 },
      removeOnFail: { age: 86_400, count: 200 },
    });

    await this.prisma.inboundWebhookLog.updateMany({
      where: { platform: 'meta', eventId },
      data: { accountResolved: true, processed: true },
    });

    this.metrics.incr('webhook_enqueued', { platform: 'meta', product });
  }

  private verifySignature(
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): boolean {
    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret || !signatureHeader) return false;

    const prefix = 'sha256=';
    if (!signatureHeader.startsWith(prefix)) return false;

    const providedHex = signatureHeader.slice(prefix.length);
    if (!/^[0-9a-fA-F]+$/.test(providedHex)) return false;

    const computedHex = createHmac('sha256', appSecret).update(rawBody).digest('hex');

    const providedBuf = Buffer.from(providedHex, 'hex');
    const computedBuf = Buffer.from(computedHex, 'hex');

    if (providedBuf.length !== computedBuf.length) return false;

    try {
      return timingSafeEqual(providedBuf, computedBuf);
    } catch {
      return false;
    }
  }

  private extractRawBody(req: Request): Buffer {
    const body = (req as Request & { body?: unknown }).body;
    if (Buffer.isBuffer(body)) return body;
    // Some middleware configurations attach the raw body as `rawBody`.
    const rawBody = (req as Request & { rawBody?: unknown }).rawBody;
    if (Buffer.isBuffer(rawBody)) return rawBody;
    if (typeof body === 'string') return Buffer.from(body, 'utf8');
    // Last-resort stringify — signature will fail but we still return a
    // deterministic buffer so logging does not crash.
    return Buffer.from(JSON.stringify(body ?? {}), 'utf8');
  }

  private snippet(rawBody: Buffer): string {
    if (rawBody.length <= PAYLOAD_SNIPPET_MAX_BYTES) {
      return rawBody.toString('utf8');
    }
    return `${rawBody.subarray(0, PAYLOAD_SNIPPET_MAX_BYTES).toString('utf8')}...[truncated]`;
  }

  /**
   * Insert a row and report whether it was actually new. Duplicate key
   * violations (same platform+event_id) are swallowed → returns false.
   */
  private async recordWebhook(
    platform: string,
    eventId: string,
    signatureValid: boolean,
    payloadSnippet: string,
    accountResolved: boolean,
    processed: boolean,
  ): Promise<boolean> {
    try {
      await this.prisma.inboundWebhookLog.create({
        data: {
          platform,
          eventId,
          signatureValid,
          payloadSnippet,
          accountResolved,
          processed,
        },
      });
      return true;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return false;
      }
      this.logger.error(
        `Failed to write inbound_webhook_log: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
