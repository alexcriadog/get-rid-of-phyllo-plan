import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Response } from 'express';
import { RedisService } from '@shared/redis/redis.service';
import type { RequestWithWorkspace } from '@/common/guards/bearer-api-key.guard';

/**
 * Per-workspace fixed-window rate limiter for /v1/*.
 *
 * Implemented as a fixed-window counter in Redis: each minute bucket is a
 * single INCR + EXPIRE pair, so checking a request costs one round-trip
 * to Redis. Fixed-window is coarser than a sliding window but trivially
 * correct and cheap — good enough for an MVP that's protecting the
 * upstream platform rate limits (Meta/Twitch/etc.) from a noisy tenant,
 * not load-balancing a high-QPS app.
 *
 * Limits are per planTier; defaults below are intentionally generous so
 * an integrating client doesn't trip them during normal development.
 *
 *   standard:   120 req/min
 *   pro:        600 req/min
 *   enterprise: 6000 req/min
 *
 * Headers exposed on every response (success or 429):
 *   X-RateLimit-Limit       — requests allowed in the current minute
 *   X-RateLimit-Remaining   — what's left in this minute
 *   X-RateLimit-Reset       — unix seconds when the window flips
 *
 * Lives at the @UseInterceptors level (not a global guard) so the existing
 * /admin/* surface stays untouched.
 */
const LIMITS_BY_PLAN: Record<string, number> = {
  standard: 120,
  pro: 600,
  enterprise: 6000,
};
const DEFAULT_LIMIT = LIMITS_BY_PLAN.standard;
const WINDOW_SECONDS = 60;

@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  constructor(private readonly redis: RedisService) {}

  async intercept(
    ctx: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const req = ctx.switchToHttp().getRequest<RequestWithWorkspace>();
    const ws = req.workspace?.workspaceId;
    const res = ctx.switchToHttp().getResponse<Response>();

    // No workspace context (e.g. /v1/healthz if we ever add one) → no
    // rate limit. The BearerApiKeyGuard runs before us on every guarded
    // route so this branch only catches misconfiguration.
    if (!ws) {
      return next.handle();
    }

    const plan = req.workspace?.planTier ?? 'standard';
    const limit = LIMITS_BY_PLAN[plan] ?? DEFAULT_LIMIT;
    const now = Math.floor(Date.now() / 1000);
    const bucket = Math.floor(now / WINDOW_SECONDS);
    const resetAt = (bucket + 1) * WINDOW_SECONDS;
    const key = `rl:${ws}:${bucket}`;

    let count = 0;
    try {
      count = await this.redis.client.incr(key);
      if (count === 1) {
        // +10s grace so the key expires just after the next window
        // starts — protects against an INCR on a key that already
        // expired between the read and a downstream operation.
        await this.redis.client.expire(key, WINDOW_SECONDS + 10);
      }
      // Long-window usage counter for the admin telemetry dashboard.
      // Same INCR/EXPIRE pattern but keyed per-day, kept for 90 days so
      // the operator can see week-over-week trends without standing up
      // a full metrics pipeline.
      const dayKey = `usage:${ws}:${dayBucket(now)}`;
      const dayCount = await this.redis.client.incr(dayKey);
      if (dayCount === 1) {
        await this.redis.client.expire(dayKey, 90 * 24 * 60 * 60);
      }
    } catch {
      // Fail open on Redis outage. Better to serve traffic than to 503
      // because our limiter is unhappy.
      return next.handle();
    }

    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - count)));
    res.setHeader('X-RateLimit-Reset', String(resetAt));

    if (count > limit) {
      const retryAfter = resetAt - now;
      res.setHeader('Retry-After', String(retryAfter));
      throw new HttpException(
        {
          message: 'Rate limit exceeded',
          limit,
          retry_after_seconds: retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return next.handle();
  }
}

/**
 * UTC day bucket (YYYY-MM-DD). Same calendar day across deployments
 * regardless of host timezone.
 */
function dayBucket(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}
