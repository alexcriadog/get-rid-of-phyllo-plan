import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';

/**
 * Shared inbound_webhook_log writer for all platform ingest controllers.
 * One row per (platform, eventId); duplicate inserts are swallowed so the
 * same upstream delivery retried by the platform never double-processes.
 */
@Injectable()
export class InboundWebhookLogService {
  private readonly logger = new Logger(InboundWebhookLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Insert a row and report whether it was actually new. Duplicate key
   * violations (same platform+event_id) are swallowed → returns false.
   */
  async record(
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

  /** Stamp resolution state on an already-recorded delivery. */
  async markResolved(
    platform: string,
    eventId: string,
    processed: boolean,
  ): Promise<void> {
    await this.prisma.inboundWebhookLog.updateMany({
      where: { platform, eventId },
      data: { accountResolved: true, processed },
    });
  }
}
