import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { RedisService } from '@shared/redis/redis.service';
import type { RequestWithWorkspace } from '@/common/guards/bearer-api-key.guard';

/**
 * Per-workspace response cache for /v1/accounts/:id/<product> read endpoints.
 *
 * Each `GET` is keyed by workspace + path + (sorted) query string and
 * persisted for 5 minutes in Redis. Cache hits respond with
 * `X-Cache: HIT` + `X-Cached-At: <iso>`; misses set `X-Cache: MISS` and
 * populate the cache on success.
 *
 * Clients can force a fresh upstream fetch with `?live=true` — useful for
 * post-OAuth flows that need the most recent data, debugging, etc.
 *
 * The point is to protect the platform-side rate limits (Meta/Twitch/...)
 * from a noisy tenant polling identity every second. Live-fetches still
 * happen on every miss; the cache just amortises them.
 */
const CACHE_TTL_SECONDS = 5 * 60;
const KEY_PREFIX = 'cache:v1';

@Injectable()
export class V1CacheInterceptor implements NestInterceptor {
  constructor(private readonly redis: RedisService) {}

  async intercept(
    ctx: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const req = ctx.switchToHttp().getRequest<RequestWithWorkspace>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const ws = req.workspace?.workspaceId;

    if (req.method !== 'GET' || !ws) {
      return next.handle();
    }

    // Bypass when the client explicitly asks for a live fetch.
    const queryLive = (req.query as Record<string, unknown>)['live'];
    if (queryLive === 'true' || queryLive === '1') {
      res.setHeader('X-Cache', 'BYPASS');
      return next.handle();
    }

    const key = this.buildKey(ws, req);
    let cached: string | null = null;
    try {
      cached = await this.redis.client.get(key);
    } catch {
      // Fail open: serve fresh.
      return next.handle();
    }

    if (cached) {
      try {
        const parsed = JSON.parse(cached) as {
          cachedAt: string;
          body: unknown;
        };
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cached-At', parsed.cachedAt);
        return of(parsed.body);
      } catch {
        // Corrupt entry — drop and refetch.
      }
    }

    res.setHeader('X-Cache', 'MISS');
    return next.handle().pipe(
      tap({
        next: (body: unknown) => {
          // Only cache 2xx; we infer success by reaching tap().
          const cachedAt = new Date().toISOString();
          res.setHeader('X-Cached-At', cachedAt);
          this.redis.client
            .set(
              key,
              JSON.stringify({ cachedAt, body }),
              'EX',
              CACHE_TTL_SECONDS,
            )
            .catch(() => {
              // Cache writes are best-effort; never propagate the error.
            });
        },
      }),
    );
  }

  private buildKey(workspaceId: string, req: Request): string {
    // Path without leading slash + sorted query so semantically-equal
    // requests share a cache entry regardless of param order.
    const url = req.originalUrl ?? req.url ?? '';
    const [path, queryStr = ''] = url.split('?');
    const sortedQuery = queryStr
      .split('&')
      .filter((p) => p.length > 0 && !p.startsWith('live='))
      .sort()
      .join('&');
    const composite = `${path}|${sortedQuery}`;
    const digest = createHash('sha1')
      .update(composite)
      .digest('hex')
      .slice(0, 16);
    return `${KEY_PREFIX}:${workspaceId}:${digest}`;
  }
}
