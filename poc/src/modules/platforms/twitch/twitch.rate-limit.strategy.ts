// Twitch rate-limit hints.
//
// Helix uses a points system per app token. The default bucket is
// 800 points/minute (refills continuously). Endpoints we call cost 1 point.
//
// We model two hints:
//   - app-level bucket keyed flat to the project (all users share it)
//   - per-token bucket keyed by token hash (so a single noisy user can't
//     starve the others before tripping the app cap)

import { Injectable } from '@nestjs/common';
import type { RateLimitHint } from '@shared/redis/rate-bucket.service';
import type { PlatformAdapterContext } from '../shared/platform-adapter.port';
import type { RateLimitStrategy } from '../shared/meta-graph/rate-limit-strategy.port';

const APP_CAPACITY = 800;
const APP_REFILL_PER_MS = 800 / 60_000;

const PER_TOKEN_CAPACITY = 400;
const PER_TOKEN_REFILL_PER_MS = 400 / 60_000;

@Injectable()
export class TwitchRateLimitStrategy implements RateLimitStrategy {
  hints(context: PlatformAdapterContext): RateLimitHint[] {
    const hints: RateLimitHint[] = [
      {
        scope: 'helix_app',
        keyTemplate: 'rate:twitch:helix_app',
        capacity: APP_CAPACITY,
        refillPerMs: APP_REFILL_PER_MS,
        costPerCall: 1,
        strategy: 'token-bucket',
      },
    ];
    if (context?.tokenHash) {
      hints.push({
        scope: 'helix_user',
        keyTemplate: 'rate:twitch:helix_user:{hash}',
        capacity: PER_TOKEN_CAPACITY,
        refillPerMs: PER_TOKEN_REFILL_PER_MS,
        costPerCall: 1,
        strategy: 'token-bucket',
      });
    }
    return hints;
  }
}
