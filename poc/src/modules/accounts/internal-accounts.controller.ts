import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '@shared/database/prisma.service';
import { WorkspacesService } from '@modules/workspaces/workspaces.service';

/**
 * Internal endpoint used by connect-ui's embedded "Connections" screen to
 * list the end-user's existing accounts for a platform. Lives on /internal
 * so it's never exposed at the public ingress — same trust model as
 * /internal/workspaces/:slug/branding and /internal/sdk-tokens/verify.
 */
@Controller('internal/accounts')
export class InternalAccountsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  @Get()
  async list(
    @Query('ws_slug') wsSlug: string,
    @Query('end_user_id') endUserId: string,
    @Query('platform') platform: string | undefined,
  ): Promise<{
    data: Array<{
      id: string;
      platform: string;
      handle: string | null;
      display_name: string | null;
      status: string;
    }>;
  }> {
    if (!wsSlug || !endUserId) {
      throw new BadRequestException('ws_slug and end_user_id are required');
    }
    const ws = await this.workspaces.findBySlug(wsSlug);
    const rows = await this.prisma.account.findMany({
      where: {
        workspaceId: ws.id,
        endUserId,
        status: { not: 'disconnected' },
        ...(platform ? { platform } : {}),
      },
      orderBy: { connectedAt: 'desc' },
      take: 100,
    });
    return {
      data: rows.map((r) => ({
        id: String(r.id),
        platform: r.platform,
        handle: r.handle ?? null,
        display_name: r.displayName ?? null,
        status: r.status,
      })),
    };
  }
}
