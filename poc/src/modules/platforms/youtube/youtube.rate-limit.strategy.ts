// YouTube rate-limit hints. Mirrors tiktok.rate-limit.strategy.ts in shape.
//
// YouTube has TWO independent quota systems:
//   - Data API v3: 10 000 "units"/day per Google Cloud project. Different
//     endpoints cost different amounts. Reset at midnight Pacific Time.
//   - Analytics API v2: no units; per-100s rate limit (720/project + 60/user).
//
// We model the daily Data-API budget as a `daily-counter` keyed by date.
// The per-call cost is set to 1 in the hint; the chokepoint client overrides
// it to the per-endpoint cost (e.g. 100 for search.list) before acquiring.
// The Analytics QPS budget is a token-bucket keyed flat at the project
// level + a tighter per-token bucket.

import { Injectable } from '@nestjs/common';
import type { RateLimitHint } from '@shared/redis/rate-bucket.service';
import type { PlatformAdapterContext } from '../shared/platform-adapter.port';
import type { RateLimitStrategy } from '../shared/meta-graph/rate-limit-strategy.port';

const DATA_API_DAILY_CAP = 10_000;

const ANALYTICS_PROJECT_CAPACITY = 720;
const ANALYTICS_PROJECT_REFILL_PER_MS = 720 / 100_000;

const ANALYTICS_USER_CAPACITY = 60;
const ANALYTICS_USER_REFILL_PER_MS = 60 / 100_000;

@Injectable()
export class YoutubeRateLimitStrategy implements RateLimitStrategy {
  hints(context: PlatformAdapterContext): RateLimitHint[] {
    const hints: RateLimitHint[] = [
      {
        scope: 'daily_quota',
        keyTemplate: 'rate:yt:daily_quota:{YYYY-MM-DD-UTC}',
        capacity: DATA_API_DAILY_CAP,
        refillPerMs: 0,
        costPerCall: 1,
        strategy: 'daily-counter',
      },
      {
        scope: 'qps_analytics',
        keyTemplate: 'rate:yt:qps_analytics',
        capacity: ANALYTICS_PROJECT_CAPACITY,
        refillPerMs: ANALYTICS_PROJECT_REFILL_PER_MS,
        costPerCall: 1,
        strategy: 'token-bucket',
      },
    ];
    // Google meters "per minute per user" by the authenticated principal (the
    // Google user/channel), NOT the access token — and tokens rotate ~hourly.
    // Key by the stable channel id (= canonicalId) so all of one user's tokens
    // (across workspaces + refreshes) share one bucket. (rate-limit research)
    if (context?.channelId) {
      hints.push({
        scope: 'qps_analytics_user',
        keyTemplate: 'rate:yt:qps_analytics_user:{channel_id}',
        capacity: ANALYTICS_USER_CAPACITY,
        refillPerMs: ANALYTICS_USER_REFILL_PER_MS,
        costPerCall: 1,
        strategy: 'token-bucket',
      });
    }
    return hints;
  }
}
