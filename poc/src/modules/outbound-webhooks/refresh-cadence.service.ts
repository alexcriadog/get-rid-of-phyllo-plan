import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@shared/database/prisma.service';
import { RedisService } from '@shared/redis/redis.service';

export const DEFAULT_REFRESH_INTERVAL_SECONDS = 21_600; // 6h
export const DEFAULT_REFRESH_WINDOW_DAYS = 90;

export interface RefreshConfig {
  intervalSeconds: number;
  windowDays: number;
}

@Injectable()
export class RefreshCadenceService {
  private readonly logger = new Logger(RefreshCadenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getConfig(platform: string, product: string): Promise<RefreshConfig> {
    const row = await this.prisma.cadence.findUnique({
      where: { platform_product: { platform, product } },
    });
    return {
      intervalSeconds:
        row?.refreshIntervalSeconds ?? DEFAULT_REFRESH_INTERVAL_SECONDS,
      windowDays: row?.refreshWindowDays ?? DEFAULT_REFRESH_WINDOW_DAYS,
    };
  }

  /**
   * SET NX EX — true at most once per interval per (account, product).
   * Fails closed (false) on Redis error to avoid spamming refresh emits.
   */
  async tryAcquire(
    accountId: bigint,
    product: string,
    intervalSeconds: number,
  ): Promise<boolean> {
    const key = `refresh_emit:${accountId.toString()}:${product}`;
    try {
      const res = await this.redis.client.set(
        key,
        '1',
        'EX',
        intervalSeconds,
        'NX',
      );
      return res === 'OK';
    } catch (err) {
      this.logger.warn(
        `refresh throttle redis error for ${key}: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return false;
    }
  }
}
