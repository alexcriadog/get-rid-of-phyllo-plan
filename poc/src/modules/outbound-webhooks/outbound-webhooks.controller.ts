import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
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
