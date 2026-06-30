// LinkedIn rate-limit hints. Quotas are DAILY (reset midnight UTC) and not
// surfaced in headers. Dev tier ≈ 500 calls/app/day + 100/member/day; we
// model both as token buckets refilling continuously across the day, which
// under-uses bursts but can never blow the daily cap.

import { Injectable } from '@nestjs/common';
import type { RateLimitHint } from '@shared/redis/rate-bucket.service';
import type { PlatformAdapterContext } from '../shared/platform-adapter.port';
import type { RateLimitStrategy } from '../shared/meta-graph/rate-limit-strategy.port';

const DAY_MS = 86_400_000;
const APP_DAILY_CAPACITY = 500;
const MEMBER_DAILY_CAPACITY = 100;

@Injectable()
export class LinkedInRateLimitStrategy implements RateLimitStrategy {
  hints(context: PlatformAdapterContext): RateLimitHint[] {
    const hints: RateLimitHint[] = [
      {
        scope: 'linkedin_app',
        keyTemplate: 'rate:linkedin:app',
        capacity: APP_DAILY_CAPACITY,
        refillPerMs: APP_DAILY_CAPACITY / DAY_MS,
        costPerCall: 1,
        strategy: 'token-bucket',
      },
    ];
    // LinkedIn meters the "Member" limit per member identity per app — "a
    // single member per application" — not per token. Key by the member/org id
    // (= canonicalId, carried as channelId) so a member's tokens across
    // workspaces + refreshes share one bucket. (rate-limit research)
    if (context?.channelId) {
      hints.push({
        scope: 'linkedin_member',
        keyTemplate: 'rate:linkedin:member:{channel_id}',
        capacity: MEMBER_DAILY_CAPACITY,
        refillPerMs: MEMBER_DAILY_CAPACITY / DAY_MS,
        costPerCall: 1,
        strategy: 'token-bucket',
      });
    }
    return hints;
  }
}
