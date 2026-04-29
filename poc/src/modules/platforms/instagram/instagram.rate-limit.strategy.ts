// Instagram rate-limit hints. Phase B1.
// Body lifted verbatim from the previous inline rateLimitHints in
// instagram.adapter.ts — no behaviour change. The point of extracting it is
// to remove HTTP/rate concerns from the adapter; FB now mirrors this exact
// shape and order, closing drift D2 + D3.

import { Injectable } from '@nestjs/common';
import type { RateLimitHint } from '@shared/redis/rate-bucket.service';
import type { PlatformAdapterContext } from '../shared/platform-adapter.port';
import type { RateLimitStrategy } from '../shared/meta-graph/rate-limit-strategy.port';

// 200 calls per hour ≈ 0.05555 tokens/ms.
const IG_REFILL_PER_MS = 200 / (60 * 60 * 1000);
const IG_CAPACITY = 200;

@Injectable()
export class InstagramRateLimitStrategy implements RateLimitStrategy {
  hints(context: PlatformAdapterContext): RateLimitHint[] {
    const hints: RateLimitHint[] = [
      {
        scope: 'user_token',
        keyTemplate: 'rate:ig:user_token:{hash}',
        capacity: IG_CAPACITY,
        refillPerMs: IG_REFILL_PER_MS,
        costPerCall: 1,
        strategy: 'token-bucket',
      },
      {
        scope: 'app',
        keyTemplate: 'rate:ig:app',
        capacity: IG_CAPACITY,
        refillPerMs: IG_REFILL_PER_MS,
        costPerCall: 1,
        strategy: 'token-bucket',
      },
    ];

    if (context?.pageId) {
      hints.push({
        scope: 'page',
        keyTemplate: 'rate:ig:page:{page_id}',
        capacity: IG_CAPACITY,
        refillPerMs: IG_REFILL_PER_MS,
        costPerCall: 1,
        strategy: 'token-bucket',
      });
    }
    return hints;
  }
}
