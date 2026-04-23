import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@shared/redis/redis.service';

const THROTTLE_PREFIX = 'throttle';
const MANUAL_REFRESH_PREFIX = 'manual_refresh';

/**
 * Default TTLs. Throttle (post-sync cooldown) is 10 minutes — after a
 * successful fetch for (account, product) we don't let the scheduler
 * re-run it within that window. Manual-refresh lock is 60 seconds — a
 * quick user-debounce so we don't DDoS ourselves from a refresh button.
 */
const THROTTLE_TTL_SECONDS = 600;
const MANUAL_REFRESH_TTL_SECONDS = 60;

/**
 * Approximate maximum number of keys returned by `listActive()`. SCAN is
 * paginated; we stop early to keep the admin endpoint responsive.
 */
const LIST_ACTIVE_MAX_KEYS = 500;
const SCAN_COUNT_HINT = 100;

export interface ActiveLock {
  key: string;
  account_id: string | null;
  product: string | null;
  kind: 'throttle' | 'manual_refresh';
  ttl_seconds: number;
}

function throttleKey(accountId: bigint, product: string): string {
  return `${THROTTLE_PREFIX}:${accountId.toString()}:${product}`;
}

function manualRefreshKey(accountId: bigint, product: string): string {
  return `${MANUAL_REFRESH_PREFIX}:${accountId.toString()}:${product}`;
}

@Injectable()
export class ThrottleLockService {
  private readonly logger = new Logger(ThrottleLockService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Non-blocking attempt to acquire a post-sync throttle lock.
   * Returns true only if this caller was the one to set the key.
   */
  async acquire(
    accountId: bigint,
    product: string,
    ttlSeconds: number = THROTTLE_TTL_SECONDS,
  ): Promise<boolean> {
    const key = this.redis.key(throttleKey(accountId, product));
    const result = await this.redis.client.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async isHeld(accountId: bigint, product: string): Promise<boolean> {
    const key = this.redis.key(throttleKey(accountId, product));
    const exists = await this.redis.client.exists(key);
    return exists === 1;
  }

  /**
   * Manual-refresh lock — separate namespace so a throttle cooldown does
   * not block a brand-new manual refresh and vice-versa, but both show up
   * in the admin lock list.
   */
  async acquireManualRefresh(
    accountId: bigint,
    product: string,
    ttlSeconds: number = MANUAL_REFRESH_TTL_SECONDS,
  ): Promise<boolean> {
    const key = this.redis.key(manualRefreshKey(accountId, product));
    const result = await this.redis.client.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  /**
   * Force-release — used by the admin dashboard. Accepts either the raw
   * Redis key (as returned by `listActive`) or a pre-namespaced key;
   * both are handled by stripping the configured namespace prefix if
   * present before re-applying it.
   */
  async release(key: string): Promise<void> {
    const namespaced = this.ensureNamespaced(key);
    await this.redis.client.del(namespaced);
  }

  /**
   * Scan Redis for both kinds of lock. Exposed for `/admin/throttle-locks`.
   * Bounded by LIST_ACTIVE_MAX_KEYS to avoid blocking under high load.
   */
  async listActive(): Promise<ActiveLock[]> {
    const keys = [
      ...(await this.scan(`${THROTTLE_PREFIX}:*`)),
      ...(await this.scan(`${MANUAL_REFRESH_PREFIX}:*`)),
    ];

    if (keys.length === 0) {
      return [];
    }

    const pipeline = this.redis.client.pipeline();
    for (const k of keys) {
      pipeline.ttl(k);
    }
    const ttlResults = await pipeline.exec();

    const locks: ActiveLock[] = [];
    for (let i = 0; i < keys.length; i++) {
      const rawKey = keys[i];
      const ttlRaw = ttlResults?.[i]?.[1];
      const ttl = typeof ttlRaw === 'number' ? ttlRaw : -2;

      // TTL = -2 means the key has already expired between SCAN and TTL.
      if (ttl <= 0) continue;

      locks.push(this.parseKey(rawKey, ttl));
    }

    return locks;
  }

  private async scan(pattern: string): Promise<string[]> {
    const namespacedPattern = this.redis.key(pattern);
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, batch] = await this.redis.client.scan(
        cursor,
        'MATCH',
        namespacedPattern,
        'COUNT',
        SCAN_COUNT_HINT,
      );
      cursor = nextCursor;
      keys.push(...batch);
      if (keys.length >= LIST_ACTIVE_MAX_KEYS) break;
    } while (cursor !== '0');

    return keys.slice(0, LIST_ACTIVE_MAX_KEYS);
  }

  private parseKey(rawKey: string, ttl: number): ActiveLock {
    const unprefixed = this.stripNamespace(rawKey);
    const parts = unprefixed.split(':');
    const kind: ActiveLock['kind'] =
      parts[0] === MANUAL_REFRESH_PREFIX ? 'manual_refresh' : 'throttle';

    // Format: `{kind}:{account_id}:{product}`
    const account_id = parts[1] ?? null;
    const product = parts.slice(2).join(':') || null;

    return {
      key: rawKey,
      account_id,
      product,
      kind,
      ttl_seconds: ttl,
    };
  }

  private ensureNamespaced(key: string): string {
    const ns = this.redis.key('');
    if (ns && key.startsWith(ns)) {
      return key;
    }
    return this.redis.key(key);
  }

  private stripNamespace(key: string): string {
    const ns = this.redis.key('');
    if (ns && key.startsWith(ns)) {
      return key.slice(ns.length);
    }
    return key;
  }
}
