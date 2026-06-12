import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@shared/database/prisma.service';
import { RedisService } from '@shared/redis/redis.service';

export const DEFAULT_REFRESH_INTERVAL_SECONDS = 21_600; // 6h
export const DEFAULT_REFRESH_WINDOW_DAYS = 90;

// Memoize cadence rows for 60 s. getConfig() is now read on the worker's hot
// path (detection window) AND the dispatcher's reporting path (window_start);
// caching keeps both deterministic + identical within the window without a DB
// round-trip per sync. Mirrors DataEventDispatcher.loadWorkspaceCadence.
const CONFIG_CACHE_TTL_MS = 60_000;

export interface RefreshConfig {
  intervalSeconds: number;
  windowDays: number;
}

interface CachedConfig {
  value: RefreshConfig;
  expiresAt: number;
}

@Injectable()
export class RefreshCadenceService {
  private readonly logger = new Logger(RefreshCadenceService.name);
  private readonly configCache = new Map<string, CachedConfig>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getConfig(platform: string, product: string): Promise<RefreshConfig> {
    const cacheKey = `${platform}:${product}`;
    const now = Date.now();
    const cached = this.configCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.value;

    const row = await this.prisma.cadence.findUnique({
      where: { platform_product: { platform, product } },
    });
    const value: RefreshConfig = {
      intervalSeconds:
        row?.refreshIntervalSeconds ?? DEFAULT_REFRESH_INTERVAL_SECONDS,
      windowDays: row?.refreshWindowDays ?? DEFAULT_REFRESH_WINDOW_DAYS,
    };
    this.configCache.set(cacheKey, {
      value,
      expiresAt: now + CONFIG_CACHE_TTL_MS,
    });
    return value;
  }

  /** Test helper — drops the config cache so the next call refetches. */
  clearCacheForTests(): void {
    this.configCache.clear();
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
