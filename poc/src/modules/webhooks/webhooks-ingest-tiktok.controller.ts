import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { PrismaService } from '@shared/database/prisma.service';
import { MetricsService } from '@shared/metrics/metrics.service';
import { AccountsService } from '@modules/accounts/accounts.service';
import { InboundWebhookLogService } from './inbound-webhook-log.service';
import { extractRawBody, payloadSnippet } from './webhook-ingest.util';
import { verifyTikTokSignature } from './tiktok-webhook-verify';

// TikTok webhook event catalog is tiny (see docs/WEBHOOKS-PLATFORM-STUDY.md):
// the only one valuable to us is authorization.removed — the user revoked our
// app, the token is already dead upstream, so disconnect the account instead
// of discovering the revocation via a failed sync days later.
// `video.publish.*` only fires for API-posted content (we don't post) and is
// logged for audit but not acted on.

const AUTHORIZATION_REMOVED = 'authorization.removed';

/** Reason codes TikTok sends inside content for authorization.removed. */
const REMOVAL_REASONS: Readonly<Record<number, string>> = {
  0: 'unknown',
  1: 'user_disconnected',
  2: 'account_deleted',
  3: 'user_age_changed',
  4: 'account_banned',
  5: 'developer_revoked',
};

interface TikTokWebhookBody {
  client_key?: string;
  event?: string;
  create_time?: number;
  user_openid?: string;
  /** Double-encoded JSON, e.g. "{\"reason\": 1}" — parse a second time. */
  content?: string;
}

@Controller('webhooks/ingest')
export class WebhooksIngestTikTokController {
  private readonly logger = new Logger(WebhooksIngestTikTokController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly accounts: AccountsService,
    private readonly webhookLog: InboundWebhookLogService,
  ) {}

  /**
   * TikTok ingest. Verifies the TikTok-Signature header (HMAC over
   * `${t}.${body}` with the client secret), dedupes, acks 200 fast.
   * Delivery is at-least-once with retries for up to 72h on non-200.
   */
  @Post('tiktok')
  @HttpCode(200)
  async ingestTikTok(
    @Req() req: Request,
    @Headers('tiktok-signature') signatureHeader: string | undefined,
  ): Promise<void> {
    const rawBody = extractRawBody(req);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const secret = process.env.TIKTOK_CLIENT_SECRET ?? '';
    const signatureValid = verifyTikTokSignature(
      rawBody,
      signatureHeader,
      secret,
      nowSeconds,
    );

    if (!signatureValid) {
      const syntheticEventId = createHash('sha256').update(rawBody).digest('hex');
      await this.webhookLog.record(
        'tiktok',
        syntheticEventId,
        false,
        payloadSnippet(rawBody),
        false,
        false,
      );
      this.metrics.incr('webhook_signature_invalid', { platform: 'tiktok' });
      throw new UnauthorizedException('Invalid signature');
    }

    let body: TikTokWebhookBody;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as TikTokWebhookBody;
    } catch {
      this.logger.warn('TikTok webhook with non-JSON body');
      return; // still 200 — nothing actionable, don't trigger 72h of retries
    }

    const event = typeof body.event === 'string' ? body.event : '';
    const openId = typeof body.user_openid === 'string' ? body.user_openid : '';
    const createTime =
      typeof body.create_time === 'number' ? body.create_time : 0;
    const eventId = createHash('sha256')
      .update(`${event}:${openId}:${createTime}:${body.content ?? ''}`)
      .digest('hex');

    const inserted = await this.webhookLog.record(
      'tiktok',
      eventId,
      true,
      payloadSnippet(rawBody),
      false,
      false,
    );
    if (!inserted) {
      this.metrics.incr('webhook_duplicate', { platform: 'tiktok' });
      return;
    }

    if (!openId) {
      this.logger.warn('TikTok webhook without user_openid');
      return;
    }

    // The same real TikTok account can be connected by multiple end users
    // (tenants/orgs) → multiple rows sharing this openId. Resolve them all.
    const accounts = await this.prisma.account.findMany({
      where: { platform: 'tiktok', canonicalUserId: openId },
      select: { id: true, workspaceId: true, status: true },
    });
    if (accounts.length === 0) {
      this.metrics.incr('webhook_account_missing', { platform: 'tiktok' });
      return;
    }

    if (event !== AUTHORIZATION_REMOVED) {
      // video.publish.* / portability.* — log + resolve for the admin panel,
      // nothing to do (we never post via the API).
      await this.webhookLog.markResolved('tiktok', eventId, false);
      this.metrics.incr('webhook_skipped_unhandled_event', {
        platform: 'tiktok',
        event,
      });
      return;
    }

    // A TikTok deauthorization is at the platform-user level: every tenant row
    // that connected this account is now dead, so disconnect them all.
    const reason = this.parseRemovalReason(body.content);
    let disconnected = 0;
    for (const account of accounts) {
      if (account.status === 'disconnected') continue;
      await this.accounts.disconnectAccount(account.id, account.workspaceId);
      disconnected += 1;
      this.logger.log(
        `TikTok deauthorization → disconnected account ${account.id.toString()} (reason=${reason})`,
      );
    }
    await this.webhookLog.markResolved('tiktok', eventId, true);
    if (disconnected > 0) {
      this.metrics.incr('webhook_deauthorization_processed', {
        platform: 'tiktok',
        reason,
      });
    } else {
      this.logger.log(
        `TikTok deauthorization for already-disconnected account(s) openId=${openId} (${reason})`,
      );
    }
  }

  /** content is double-encoded JSON: "{\"reason\": 1}". */
  private parseRemovalReason(content: string | undefined): string {
    if (!content) return 'unknown';
    try {
      const parsed = JSON.parse(content) as { reason?: number };
      return typeof parsed.reason === 'number'
        ? (REMOVAL_REASONS[parsed.reason] ?? `code_${parsed.reason}`)
        : 'unknown';
    } catch {
      return 'unknown';
    }
  }
}
