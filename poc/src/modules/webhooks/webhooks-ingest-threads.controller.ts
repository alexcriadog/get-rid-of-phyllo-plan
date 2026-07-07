import {
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
import { InboundWebhookLogService } from './inbound-webhook-log.service';
import {
  extractRawBody,
  payloadSnippet,
  verifyMetaHubSignature,
} from './webhook-ingest.util';
import {
  THREADS_FIELD_TO_PRODUCT,
  parseThreadsEnvelope,
} from './threads-webhook-fields';

const SYNC_QUEUE_NAME = 'sync';

/**
 * Threads webhooks ride the same Meta webhooks product as FB/IG — same
 * hub.challenge GET verification and X-Hub-Signature-256 HMAC — but the
 * Threads app is a SEPARATE Meta app, so the signature is keyed with
 * THREADS_APP_SECRET (not META_APP_SECRET), and the envelope is flat
 * (see threads-webhook-fields.ts).
 *
 * Subscription is app-level (dashboard) + per-user activation via OAuth
 * scopes — there is no per-account subscribe call like FB Pages.
 */
@Controller('webhooks/ingest')
export class WebhooksIngestThreadsController {
  private readonly logger = new Logger(WebhooksIngestThreadsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bullmq: BullMqService,
    private readonly metrics: MetricsService,
    private readonly webhookLog: InboundWebhookLogService,
  ) {}

  /** Threads challenge verification. Runs at subscription time. */
  @Get('threads')
  async verifyThreads(
    @Query('hub.mode') mode: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.verify_token') verifyToken: string,
    @Res() res: Response,
  ): Promise<void> {
    const expected =
      process.env.THREADS_WEBHOOK_VERIFY_TOKEN ??
      process.env.META_WEBHOOK_VERIFY_TOKEN ??
      '';
    if (mode !== 'subscribe' || !expected || verifyToken !== expected) {
      this.metrics.incr('webhook_verify_rejected', { platform: 'threads' });
      throw new ForbiddenException('Invalid verify token');
    }

    this.metrics.incr('webhook_verify_accepted', { platform: 'threads' });
    res.status(200).type('text/plain').send(challenge ?? '');
  }

  /**
   * Threads ingest. Verifies signature, dedupes by event hash, enqueues a
   * HIGH-priority engagement sync for the target account, returns 200 fast.
   */
  @Post('threads')
  @HttpCode(200)
  async ingestThreads(
    @Req() req: Request,
    @Headers('x-hub-signature-256') signatureHeader: string | undefined,
  ): Promise<void> {
    const rawBody = extractRawBody(req);
    const signatureValid = verifyMetaHubSignature(
      rawBody,
      signatureHeader,
      process.env.THREADS_APP_SECRET,
    );

    if (!signatureValid) {
      const syntheticEventId = createHash('sha256').update(rawBody).digest('hex');
      await this.webhookLog.record(
        'threads',
        syntheticEventId,
        false,
        payloadSnippet(rawBody),
        false,
        false,
      );
      this.metrics.incr('webhook_signature_invalid', { platform: 'threads' });
      throw new UnauthorizedException('Invalid signature');
    }

    const envelope = parseThreadsEnvelope(rawBody.toString('utf8'));
    if (!envelope) {
      this.logger.warn('Threads webhook with unparseable envelope');
      return; // 200 — nothing actionable, don't trigger upstream retries
    }

    const eventId = createHash('sha256')
      .update(
        `${envelope.targetId}:${envelope.time}:${envelope.field}:${envelope.objectId ?? ''}`,
      )
      .digest('hex');

    const inserted = await this.webhookLog.record(
      'threads',
      eventId,
      true,
      payloadSnippet(rawBody),
      false,
      false,
    );
    if (!inserted) {
      this.metrics.incr('webhook_duplicate', { platform: 'threads' });
      return;
    }

    const product = THREADS_FIELD_TO_PRODUCT[envelope.field] ?? 'engagement_new';

    // Threads (like Meta/IG) delivers the event keyed only by the platform user
    // id (= canonicalUserId). Multiple tenant rows can share it — the same real
    // account connected by two different end users (orgs) — so fan out to EVERY
    // non-disconnected account with this canonical id instead of picking one.
    const accounts = await this.prisma.account.findMany({
      where: {
        platform: 'threads',
        canonicalUserId: envelope.targetId,
        status: { not: 'disconnected' },
      },
      select: { id: true },
    });
    if (accounts.length === 0) {
      this.logger.warn(
        `No threads account for canonical_user_id=${envelope.targetId}`,
      );
      this.metrics.incr('webhook_account_missing', { platform: 'threads' });
      return;
    }

    const queue = this.bullmq.getQueue<SyncJobPayload>(SYNC_QUEUE_NAME);
    let enqueued = 0;
    for (const account of accounts) {
      const syncJob = await this.prisma.syncJob.findUnique({
        where: { accountId_product: { accountId: account.id, product } },
        select: { id: true },
      });

      // Row resolved but not enrolled in the product — skip it (a coexisting
      // tenant row may still be enrolled). A synthetic jobId would crash the
      // worker's BigInt(jobId).
      if (!syncJob) {
        this.logger.log(
          `Threads webhook for account ${account.id.toString()} resolved but product '${product}' not enrolled; skipping sync`,
        );
        continue;
      }

      const payload: SyncJobPayload = {
        jobId: syncJob.id.toString(),
        accountId: account.id.toString(),
        product,
      };

      // jobId MUST include the account id: coexisting tenant rows share one
      // eventId and BullMQ dedupes by jobId — without the per-account suffix the
      // second row's sync job would be silently dropped.
      await queue.add('sync', payload, {
        priority: this.bullmq.toPriorityNumber('HIGH'),
        jobId: `webhook-${eventId}-${account.id.toString()}`,
        removeOnComplete: { age: 3600, count: 500 },
        removeOnFail: { age: 86_400, count: 200 },
      });
      enqueued += 1;
    }

    if (enqueued === 0) {
      await this.webhookLog.markResolved('threads', eventId, false);
      this.metrics.incr('webhook_skipped_no_product', {
        platform: 'threads',
        product,
      });
      return;
    }

    await this.webhookLog.markResolved('threads', eventId, true);
    this.metrics.incr('webhook_enqueued', { platform: 'threads', product });
  }
}
