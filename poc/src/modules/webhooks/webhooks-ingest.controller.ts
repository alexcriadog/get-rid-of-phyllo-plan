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
import { createHash } from 'node:crypto';
import { PrismaService } from '@shared/database/prisma.service';
import { BullMqService, SyncJobPayload } from '@shared/redis/bullmq.service';
import { MetricsService } from '@shared/metrics/metrics.service';
import { FIELD_TO_PRODUCT } from './meta-webhook-fields';
import { InboundWebhookLogService } from './inbound-webhook-log.service';
import {
  extractRawBody,
  payloadSnippet,
  verifyMetaHubSignature,
} from './webhook-ingest.util';

const SYNC_QUEUE_NAME = 'sync';

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
    private readonly webhookLog: InboundWebhookLogService,
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
    const rawBody = extractRawBody(req);
    const signatureValid = verifyMetaHubSignature(
      rawBody,
      signatureHeader,
      process.env.META_APP_SECRET,
    );

    if (!signatureValid) {
      // Log the invalid attempt so the admin UI silence detector can show
      // these — use a synthetic event id so dedupe still works.
      const syntheticEventId = createHash('sha256').update(rawBody).digest('hex');
      await this.webhookLog.record(
        'meta',
        syntheticEventId,
        false,
        payloadSnippet(rawBody),
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

    const inserted = await this.webhookLog.record(
      'meta',
      eventId,
      true,
      payloadSnippet(rawBody),
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

    // The account resolved but has no sync job for this product — it isn't
    // enrolled in it. This is normal on Instagram, whose webhook fields are
    // app-level: we receive story_insights/comments/mentions for every
    // connected IG account regardless of the products it enabled. There's
    // nothing to sync, so record the resolution and skip. (Enqueuing a
    // synthetic jobId here would also crash the worker, which does
    // BigInt(jobId).)
    if (!syncJob) {
      await this.webhookLog.markResolved('meta', eventId, false);
      this.metrics.incr('webhook_skipped_no_product', {
        platform: 'meta',
        product,
      });
      this.logger.log(
        `Meta webhook for account ${account.id.toString()} resolved but product '${product}' not enrolled; skipping sync`,
      );
      return;
    }

    const payload: SyncJobPayload = {
      jobId: syncJob.id.toString(),
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

    await this.webhookLog.markResolved('meta', eventId, true);

    this.metrics.incr('webhook_enqueued', { platform: 'meta', product });
  }

}
