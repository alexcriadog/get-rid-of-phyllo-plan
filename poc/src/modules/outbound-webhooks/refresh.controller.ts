// RefreshController — manual engagement-refresh trigger endpoint.
//
// POST /v1/accounts/:accountId/refresh forces a `data.<product>.updated`
// emit for an account's in-window content (reason: 'manual'), bypassing the
// sync-delta throttle. Guarded by the bearer API key; the account must
// belong to the authenticated workspace.

import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { PrismaService } from '@shared/database/prisma.service';
import {
  BearerApiKeyGuard,
  RequestWithWorkspace,
} from '@/common/guards/bearer-api-key.guard';
import { RateLimitInterceptor } from '@/common/interceptors/rate-limit.interceptor';
import { PRODUCT_IDS } from '@modules/accounts/products.catalog';
import { EngagementRefreshService } from './engagement-refresh.service';
import { DEFAULT_REFRESH_WINDOW_DAYS } from './refresh-cadence.service';

// Posts/engagement product the manual refresh targets by default. Must be a
// real catalog product id — 'content' was never one, so the old default
// produced a `data.content.updated` event no subscriber can match.
const DEFAULT_REFRESH_PRODUCT = 'engagement_new';
// Clamp bounds for the operator-supplied window so a huge value can't throw a
// RangeError downstream and 0/negative can't yield an empty window.
const MIN_WINDOW_DAYS = 1;
const MAX_WINDOW_DAYS = 365;

@Controller('v1/accounts')
@UseGuards(BearerApiKeyGuard)
@UseInterceptors(RateLimitInterceptor)
export class RefreshController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refresh: EngagementRefreshService,
  ) {}

  @Post(':accountId/refresh')
  async refreshAccount(
    @Req() req: RequestWithWorkspace,
    @Param('accountId') accountId: string,
    @Body() body: { product?: string; windowDays?: number },
  ): Promise<{ refreshed: boolean; sample_count: number }> {
    const ws = req.workspace?.workspaceId;
    if (!ws) throw new BadRequestException('workspace context missing');

    let id: bigint;
    try {
      id = BigInt(accountId);
    } catch {
      throw new BadRequestException('invalid accountId');
    }

    const account = await this.prisma.account.findUnique({
      where: { id },
      select: { id: true, workspaceId: true, platform: true },
    });
    if (!account || account.workspaceId !== ws) {
      throw new NotFoundException('account not found');
    }

    const product = body.product ?? DEFAULT_REFRESH_PRODUCT;
    if (!PRODUCT_IDS.includes(product as (typeof PRODUCT_IDS)[number])) {
      throw new BadRequestException('invalid product');
    }
    const windowDays = Number.isFinite(body.windowDays)
      ? Math.min(
          Math.max(MIN_WINDOW_DAYS, Math.floor(body.windowDays!)),
          MAX_WINDOW_DAYS,
        )
      : DEFAULT_REFRESH_WINDOW_DAYS;
    const r = await this.refresh.emitForAccount(account, product, windowDays);
    return { refreshed: true, sample_count: r.sampleCount };
  }
}
