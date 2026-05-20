import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '@shared/database/prisma.service';
import {
  BearerApiKeyGuard,
  RequestWithWorkspace,
} from '@/common/guards/bearer-api-key.guard';

const StatusEnum = z.enum(['pending', 'delivered', 'failed', 'abandoned']);

@Controller('v1/webhook-deliveries')
@UseGuards(BearerApiKeyGuard)
export class WebhookDeliveriesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Req() req: RequestWithWorkspace,
    @Query('status') statusRaw: string | undefined,
    @Query('endpoint_id') endpointId: string | undefined,
    @Query('event') event: string | undefined,
    @Query('limit') limitRaw: string | undefined,
  ): Promise<{ data: DeliveryView[]; meta: { count: number } }> {
    const workspaceId = this.requireWorkspace(req);

    let status: string | undefined;
    if (statusRaw) {
      const parsed = StatusEnum.safeParse(statusRaw);
      if (!parsed.success) {
        throw new BadRequestException(
          `invalid status (allowed: pending|delivered|failed|abandoned)`,
        );
      }
      status = parsed.data;
    }

    const limitParsed = z
      .number()
      .int()
      .min(1)
      .max(200)
      .safeParse(limitRaw ? Number(limitRaw) : 50);
    const limit = limitParsed.success ? limitParsed.data : 50;

    const rows = await this.prisma.webhookDelivery.findMany({
      where: {
        endpoint: { workspaceId },
        ...(endpointId ? { endpointId } : {}),
        ...(event ? { event } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        endpoint: { select: { id: true, url: true } },
      },
    });

    return {
      data: rows.map(toView),
      meta: { count: rows.length },
    };
  }

  private requireWorkspace(req: RequestWithWorkspace): string {
    const ws = req.workspace?.workspaceId;
    if (!ws) {
      throw new Error('Workspace context missing on authenticated request');
    }
    return ws;
  }
}

interface DeliveryView {
  id: string;
  endpoint_id: string;
  endpoint_url: string;
  event: string;
  attempts: number;
  status: string;
  last_response_code: number | null;
  last_error: string | null;
  next_retry_at: string | null;
  created_at: string;
  delivered_at: string | null;
}

function toView(row: {
  id: string;
  endpointId: string;
  event: string;
  attempts: number;
  status: string;
  lastResponseCode: number | null;
  lastError: string | null;
  nextRetryAt: Date | null;
  createdAt: Date;
  deliveredAt: Date | null;
  endpoint: { id: string; url: string };
}): DeliveryView {
  return {
    id: row.id,
    endpoint_id: row.endpointId,
    endpoint_url: row.endpoint.url,
    event: row.event,
    attempts: row.attempts,
    status: row.status,
    last_response_code: row.lastResponseCode,
    last_error: row.lastError,
    next_retry_at: row.nextRetryAt ? row.nextRetryAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
    delivered_at: row.deliveredAt ? row.deliveredAt.toISOString() : null,
  };
}
