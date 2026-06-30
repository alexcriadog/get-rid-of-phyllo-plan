// TikTok rate-limit hints (v1.3 flow).

import { Injectable } from '@nestjs/common';
import type { RateLimitHint } from '@shared/redis/rate-bucket.service';
import type { PlatformAdapterContext } from '../shared/platform-adapter.port';
import type { TikTokRateLimitStrategyPort } from '../shared/tiktok-api';

const QPS_CAPACITY = 10;
const QPS_REFILL_PER_MS = 10 / 1000;
const DAILY_USER_CAP = 1_000;
const DAILY_BUSINESS_CAP = 5_000;

@Injectable()
export class TikTokRateLimitStrategy implements TikTokRateLimitStrategyPort {
  hints(
    context: PlatformAdapterContext & { businessId?: string },
  ): RateLimitHint[] {
    const hints: RateLimitHint[] = [
      {
        scope: 'qps_app',
        keyTemplate: 'rate:tt:qps_app',
        capacity: QPS_CAPACITY,
        refillPerMs: QPS_REFILL_PER_MS,
        costPerCall: 1,
        strategy: 'token-bucket',
      },
    ];
    // TikTok meters the daily user-data quota per authorized account (open_id),
    // not per token — and tokens rotate every 24h. Key by the canonical user id
    // (open_id, carried as channelId) so a user's tokens across workspaces +
    // refreshes share one daily bucket. (rate-limit research)
    if (context?.channelId) {
      hints.push({
        scope: 'daily_user',
        keyTemplate: 'rate:tt:daily_user:{channel_id}:{YYYY-MM-DD-UTC}',
        capacity: DAILY_USER_CAP,
        refillPerMs: 0,
        costPerCall: 1,
        strategy: 'daily-counter',
      });
    }
    if (context?.businessId) {
      hints.push({
        scope: 'daily_business',
        keyTemplate: 'rate:tt:daily_business:{business_id}:{YYYY-MM-DD-UTC}',
        capacity: DAILY_BUSINESS_CAP,
        refillPerMs: 0,
        costPerCall: 1,
        strategy: 'daily-counter',
      });
    }
    return hints;
  }
}
