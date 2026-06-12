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
} from '@nestjs/common';
import { PrismaService } from '@shared/database/prisma.service';
import {
  BearerApiKeyGuard,
  RequestWithWorkspace,
} from '@/common/guards/bearer-api-key.guard';
import { EngagementRefreshService } from './engagement-refresh.service';
import { DEFAULT_REFRESH_WINDOW_DAYS } from './refresh-cadence.service';

@Controller('v1/accounts')
@UseGuards(BearerApiKeyGuard)
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

    const product = body.product ?? 'content';
    const windowDays = body.windowDays ?? DEFAULT_REFRESH_WINDOW_DAYS;
    const r = await this.refresh.emitForAccount(account, product, windowDays);
    return { refreshed: true, sample_count: r.sampleCount };
  }
}
