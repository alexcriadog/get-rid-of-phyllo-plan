import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import {
  BearerApiKeyGuard,
  RequestWithWorkspace,
} from '@/common/guards/bearer-api-key.guard';
import { RateLimitInterceptor } from '@/common/interceptors/rate-limit.interceptor';
import {
  OutboundWebhooksService,
  RegisteredEndpoint,
} from './outbound-webhooks.service';
import {
  shouldRequireHttps,
  validateWebhookTarget,
} from './webhook-target-validator';

const CreateBodySchema = z
  .object({
    url: z.string().url(),
    events: z.array(z.string().min(1)).min(1).max(20),
    description: z.string().max(256).optional(),
  })
  .strict();

const UpdateBodySchema = z
  .object({
    url: z.string().url().optional(),
    events: z.array(z.string().min(1)).min(1).max(20).optional(),
    description: z.string().max(256).nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'at least one field is required',
  });

/**
 * Run the SSRF/scheme/length validator and throw a clean 400 if the URL
 * is rejected. Reason codes are stable so the client can pattern-match
 * (e.g. show a different UX for `https_required` vs `ssrf_blocked_*`).
 */
async function assertWebhookTarget(url: string): Promise<void> {
  const check = await validateWebhookTarget(url, {
    requireHttps: shouldRequireHttps(process.env),
  });
  if (!check.ok) {
    throw new BadRequestException({
      message: 'Webhook target URL rejected',
      reason: check.reason,
      detail: check.detail,
    });
  }
}

@Controller('v1/webhook-endpoints')
@UseGuards(BearerApiKeyGuard)
@UseInterceptors(RateLimitInterceptor)
export class OutboundWebhooksController {
  constructor(private readonly webhooks: OutboundWebhooksService) {}

  @Post()
  @HttpCode(201)
  async create(
    @Req() req: RequestWithWorkspace,
    @Body() body: unknown,
  ): Promise<RegisteredEndpoint> {
    const ws = this.workspaceId(req);
    const parsed = CreateBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid webhook-endpoint payload',
        issues: parsed.error.issues,
      });
    }
    await assertWebhookTarget(parsed.data.url);
    return this.webhooks.register({
      workspaceId: ws,
      url: parsed.data.url,
      events: parsed.data.events,
      description: parsed.data.description,
    });
  }

  @Get()
  async list(
    @Req() req: RequestWithWorkspace,
  ): Promise<{ data: RegisteredEndpoint[] }> {
    const ws = this.workspaceId(req);
    return { data: await this.webhooks.list(ws) };
  }

  @Patch(':id')
  async update(
    @Req() req: RequestWithWorkspace,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<RegisteredEndpoint> {
    const ws = this.workspaceId(req);
    const parsed = UpdateBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid webhook-endpoint patch',
        issues: parsed.error.issues,
      });
    }
    // If the URL changes, re-run the SSRF validator.
    if (parsed.data.url !== undefined) {
      await assertWebhookTarget(parsed.data.url);
    }
    return this.webhooks.update(ws, id, parsed.data);
  }

  @Post(':id/rotate-secret')
  @HttpCode(200)
  async rotateSecret(
    @Req() req: RequestWithWorkspace,
    @Param('id') id: string,
  ): Promise<{ id: string; secret: string; rotated_at: string }> {
    const ws = this.workspaceId(req);
    return this.webhooks.rotateSecret(ws, id);
  }

  @Post(':id/test')
  @HttpCode(202)
  async sendTest(
    @Req() req: RequestWithWorkspace,
    @Param('id') id: string,
  ): Promise<{ delivery_id: string; status: 'queued' }> {
    const ws = this.workspaceId(req);
    return this.webhooks.sendTest(ws, id);
  }

  @Get(':id/deliveries')
  async listDeliveries(
    @Req() req: RequestWithWorkspace,
    @Param('id') id: string,
    @Query('limit') limitRaw: string | undefined,
    @Query('cursor') cursorRaw: string | undefined,
  ): Promise<unknown> {
    const ws = this.workspaceId(req);
    // Clamp limit to [1, 200].
    const parsed = Number(limitRaw);
    const limit =
      Number.isInteger(parsed) && parsed >= 1 && parsed <= 200 ? parsed : 50;
    return this.webhooks.listDeliveries(ws, id, {
      limit,
      cursor: cursorRaw ?? null,
    });
  }

  @Get(':id/deliveries/:deliveryId')
  async getDelivery(
    @Req() req: RequestWithWorkspace,
    @Param('id') id: string,
    @Param('deliveryId') deliveryId: string,
  ): Promise<unknown> {
    const ws = this.workspaceId(req);
    const detail = await this.webhooks.getDelivery(ws, id, deliveryId);
    if (!detail) {
      throw new NotFoundException(`Delivery ${deliveryId} not found`);
    }
    return detail;
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Req() req: RequestWithWorkspace,
    @Param('id') id: string,
  ): Promise<void> {
    const ws = this.workspaceId(req);
    await this.webhooks.remove(ws, id);
  }

  private workspaceId(req: RequestWithWorkspace): string {
    const ws = req.workspace?.workspaceId;
    if (!ws) {
      throw new Error('Workspace context missing on authenticated request');
    }
    return ws;
  }
}
