// Facebook rate-limit strategy.
//
// Post-2026-05 the synthetic local token-bucket scopes (`user_token`,
// `page`, `app`) have all been retired — they capped throughput at numbers
// we invented (200/h) instead of what Meta is actually willing to serve.
// The single source of truth is now BucTelemetryService.checkGate via
// `bucKeys()`, which mirrors X-App-Usage + X-Business-Use-Case-Usage and
// gates at 75% (Meta's published cap, scaled per Page by Engaged Users).
//
// `hints()` still implements RateLimitStrategy because the GraphClient
// runs RateBucketService.acquire() unconditionally; returning [] makes
// that path a no-op and the BUC mirror becomes the only effective gate.
// Failure mode if Redis is unreachable: BucTelemetryService.checkGate
// returns allowed=true (fail-open) and Meta itself protects us with 429
// → RateLimitedError → worker reschedule.

import { Injectable } from '@nestjs/common';
import type { RateLimitHint } from '@shared/redis/rate-bucket.service';
import type { PlatformAdapterContext } from '../shared/platform-adapter.port';
import type { RateLimitStrategy } from '../shared/meta-graph/rate-limit-strategy.port';

@Injectable()
export class FacebookRateLimitStrategy implements RateLimitStrategy {
  hints(_context: PlatformAdapterContext): RateLimitHint[] {
    return [];
  }

  /**
   * BUC mirror keys. For FB Pages the page_id IS the asset id Meta tracks
   * under x-business-use-case-usage; pageId is already populated in the
   * context by buildFacebookContext.
   */
  bucKeys(context: PlatformAdapterContext): string[] {
    return context.pageId ? [`asset:${context.pageId}`] : [];
  }
}
