// Facebook rate-limit hints. Phase B1.
//
// Intentional fixes vs the old inline rateLimitHints in facebook.adapter.ts:
//   D2 — adds a `user_token` bucket scoped by sha256(token).slice(0,16). FB
//        previously had only `app` + optional `page`, meaning two FB Pages
//        connected via different OAuth users shared a single app-scope cap.
//   D3 — hint order is now `user_token`, `app`, `page` — matching Instagram.
//        The first hint to deny becomes `acquired.bucketKey`, so consistent
//        order means consistent admin-dashboard reporting across the family.

import { Injectable } from '@nestjs/common';
import type { RateLimitHint } from '@shared/redis/rate-bucket.service';
import type { PlatformAdapterContext } from '../shared/platform-adapter.port';
import type { RateLimitStrategy } from '../shared/meta-graph/rate-limit-strategy.port';

// 200 BUC pts/h per Page → 0.05555 tokens/ms.
const FB_REFILL_PER_MS = 200 / (60 * 60 * 1000);
const FB_CAPACITY = 200;

@Injectable()
export class FacebookRateLimitStrategy implements RateLimitStrategy {
  hints(context: PlatformAdapterContext): RateLimitHint[] {
    const hints: RateLimitHint[] = [
      {
        scope: 'user_token',
        keyTemplate: 'rate:fb:user_token:{hash}',
        capacity: FB_CAPACITY,
        refillPerMs: FB_REFILL_PER_MS,
        costPerCall: 1,
        strategy: 'token-bucket',
      },
      {
        scope: 'app',
        keyTemplate: 'rate:fb:app',
        capacity: FB_CAPACITY,
        refillPerMs: FB_REFILL_PER_MS,
        costPerCall: 1,
        strategy: 'token-bucket',
      },
    ];

    if (context?.pageId) {
      hints.push({
        scope: 'page',
        keyTemplate: 'rate:fb:page:{page_id}',
        capacity: FB_CAPACITY,
        refillPerMs: FB_REFILL_PER_MS,
        costPerCall: 1,
        strategy: 'token-bucket',
      });
    }
    return hints;
  }
}
