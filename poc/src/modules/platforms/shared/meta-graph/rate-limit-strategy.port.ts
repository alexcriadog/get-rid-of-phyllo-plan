// Per-platform rate-limit hint declaration. Phase B1 of the platform refactor.
// Each Meta-family adapter implements this and the GraphClient consumes it.
// Other platform families (TikTok, YouTube) get their own analogue under
// their own shared/<family>-api/ folder rather than reusing this port —
// composition over inheritance per docs/platform-refactor.md §2.

import type { RateLimitHint } from '@shared/redis/rate-bucket.service';
import type { PlatformAdapterContext } from '../platform-adapter.port';

export interface RateLimitStrategy {
  /**
   * Hints in priority order. The bucket that denies first becomes
   * `acquired.bucketKey` and surfaces in admin dashboards / api_call_log.
   * The order is part of the API: changing it changes which key shows up
   * as "the blocker" in operations.
   */
  hints(context: PlatformAdapterContext): RateLimitHint[];
}
