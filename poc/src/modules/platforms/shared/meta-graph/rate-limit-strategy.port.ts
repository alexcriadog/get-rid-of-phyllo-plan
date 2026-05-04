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

  /**
   * Phase 2 BUC mirror: Redis sub-keys (under `rate:meta:`) that
   * BucTelemetryService.checkGate should consult before allowing this
   * call. Strategies that don't yet model BUC return [] or omit the
   * method entirely — it's optional.
   *
   * Convention:
   *   - `asset:{id}` for IG Business Account, Facebook Page, Threads user.
   *   - `app:{app_id}` is checked elsewhere (Phase 3); strategies do NOT
   *     need to include it here.
   */
  bucKeys?(context: PlatformAdapterContext): string[];
}
