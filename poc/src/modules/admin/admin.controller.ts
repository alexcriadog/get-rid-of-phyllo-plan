import { Controller, Get, HttpCode } from '@nestjs/common';
import { PrismaService } from '@shared/database/prisma.service';

interface OverviewResponse {
  accounts_total: number;
  platforms: Record<string, number>;
  note: string;
}

@Controller('admin')
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('overview')
  async overview(): Promise<OverviewResponse> {
    const [total, grouped] = await Promise.all([
      this.prisma.account.count(),
      this.prisma.account.groupBy({
        by: ['platform'],
        _count: { _all: true },
      }),
    ]);

    const platforms: Record<string, number> = {};
    for (const row of grouped) {
      platforms[row.platform] = row._count._all;
    }

    return {
      accounts_total: total,
      platforms,
      note: 'Day 1 minimal — full dashboard from Day 5',
    };
  }

  @Get('healthz')
  @HttpCode(200)
  healthz(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
