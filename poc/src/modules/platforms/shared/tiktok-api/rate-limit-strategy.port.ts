// TikTok rate-limit strategy port.
import type { RateLimitHint } from '@shared/redis/rate-bucket.service';
import type { PlatformAdapterContext } from '../platform-adapter.port';

export interface TikTokRateLimitStrategyPort {
  hints(context: PlatformAdapterContext & { businessId?: string }): RateLimitHint[];
}
