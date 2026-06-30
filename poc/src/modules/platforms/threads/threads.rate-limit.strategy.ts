// Threads rate-limit hints. Mirrors facebook.rate-limit.strategy.ts in shape;
// values are tuned to Threads' published quota.
//
// Threads publishes a 200 BUC pts/h per app + per user-token cap (same family
// as FB Graph) — but rather than a per-Page bucket, the natural per-account
// scope is the connected Threads user. We surface that as `user` (keyed by
// the canonical user id) alongside `user_token` and `app`. The hint order is
// `user_token`, `app`, `user` so admin-dashboard reporting matches FB/IG
// shape (the first hint to deny becomes `acquired.bucketKey`).

import { Injectable } from '@nestjs/common';
import type { RateLimitHint } from '@shared/redis/rate-bucket.service';
import type { PlatformAdapterContext } from '../shared/platform-adapter.port';
import type { RateLimitStrategy } from '../shared/meta-graph/rate-limit-strategy.port';

// 200 calls/h → 0.05555 tokens/ms. Identical to FB; Meta documents the same
// 200 pts/hour budget for Threads Graph endpoints.
const THREADS_REFILL_PER_MS = 200 / (60 * 60 * 1000);
const THREADS_CAPACITY = 200;

@Injectable()
export class ThreadsRateLimitStrategy implements RateLimitStrategy {
  hints(context: PlatformAdapterContext): RateLimitHint[] {
    // No per-token bucket: Threads (Meta) meters per (app, user) pair — "unique
    // for each app and app user pair", never per token. The `user` bucket below
    // (keyed by the stable Threads user id) is the correct per-user limiter; a
    // token-hash bucket would just double-count one user across workspaces +
    // reset on every refresh. We keep the app-level bucket as a global fuse.
    // (rate-limit research)
    const hints: RateLimitHint[] = [
      {
        scope: 'app',
        keyTemplate: 'rate:threads:app',
        capacity: THREADS_CAPACITY,
        refillPerMs: THREADS_REFILL_PER_MS,
        costPerCall: 1,
        strategy: 'token-bucket',
      },
    ];

    if (context?.pageId) {
      // For Threads `pageId` carries the connected user id (see
      // buildThreadsContext) — used for per-account fairness when one OAuth
      // user has multiple connected accounts (rare but legal).
      hints.push({
        scope: 'user',
        keyTemplate: 'rate:threads:user:{page_id}',
        capacity: THREADS_CAPACITY,
        refillPerMs: THREADS_REFILL_PER_MS,
        costPerCall: 1,
        strategy: 'token-bucket',
      });
    }
    return hints;
  }
}
