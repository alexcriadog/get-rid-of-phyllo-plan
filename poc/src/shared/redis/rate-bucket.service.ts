import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * Declared rate-limit constraint for an adapter. Every HTTP call an adapter
 * makes must acquire one token across every declared hint atomically.
 */
export type RateLimitHint = {
  scope: string;
  keyTemplate: string;
  capacity: number;
  refillPerMs: number;
  costPerCall: number;
  strategy: 'token-bucket' | 'daily-counter';
};

export type AcquireSuccess = {
  allowed: true;
  tokensRemaining: number;
  bucketKey: string;
};

export type AcquireDenied = {
  allowed: false;
  resetInMs: number;
  bucketKey: string;
};

export type AcquireResult = AcquireSuccess | AcquireDenied;

export interface BucketState {
  bucketKey: string;
  scope: string;
  tokens: number;
  capacity: number;
  refillPerMs: number;
  lastAcquireAt: number | null;
  hits: number;
  denies: number;
  strategy: RateLimitHint['strategy'];
}

export interface BucketRuntimeMeta {
  scope: string;
  capacity: number;
  refillPerMs: number;
  strategy: RateLimitHint['strategy'];
}

/**
 * Atomic multi-bucket acquire.
 *
 * Each KEY corresponds to a bucket. Each bucket has a matching set of
 * arguments: capacity, refill_per_ms, cost, now_ms. The script is an
 * all-or-nothing check — if any bucket cannot pay, none pay. Rejected
 * buckets report the blocking key and the minimum wait until it can pay.
 *
 * Returns either:
 *   { 1, bucketKey, tokensRemaining }  -- allowed
 *   { 0, bucketKey, resetInMs }        -- denied
 */
const LUA_ACQUIRE = `
local now = tonumber(ARGV[#ARGV])
local n = (#ARGV - 1) / 3
local denied_idx = nil
local denied_reset = 0
local new_tokens = {}

for i = 1, n do
  local key = KEYS[i]
  local capacity = tonumber(ARGV[(i - 1) * 3 + 1])
  local refill = tonumber(ARGV[(i - 1) * 3 + 2])
  local cost = tonumber(ARGV[(i - 1) * 3 + 3])

  local h = redis.call('HMGET', key, 'tokens', 'last_refill_ts')
  local tokens = tonumber(h[1])
  local last = tonumber(h[2])

  if tokens == nil then
    tokens = capacity
    last = now
  end

  local elapsed = now - last
  if elapsed < 0 then elapsed = 0 end
  tokens = math.min(capacity, tokens + elapsed * refill)

  if tokens + 1e-9 < cost then
    if denied_idx == nil then
      denied_idx = i
      local needed = cost - tokens
      if refill > 0 then
        denied_reset = math.ceil(needed / refill)
      else
        denied_reset = 0
      end
    end
  end

  new_tokens[i] = { tokens, cost }
end

if denied_idx ~= nil then
  for i = 1, n do
    local key = KEYS[i]
    local tok = new_tokens[i][1]
    local capacity = tonumber(ARGV[(i - 1) * 3 + 1])
    local refill = tonumber(ARGV[(i - 1) * 3 + 2])
    redis.call('HMSET',
      key,
      'tokens', tok,
      'last_refill_ts', now,
      'capacity', capacity,
      'refill_per_ms', refill)
    redis.call('HINCRBY', key, 'denies', 1)
  end
  return { 0, KEYS[denied_idx], denied_reset }
end

local min_remaining = nil
local min_key = KEYS[1]
for i = 1, n do
  local key = KEYS[i]
  local tok = new_tokens[i][1] - new_tokens[i][2]
  local capacity = tonumber(ARGV[(i - 1) * 3 + 1])
  local refill = tonumber(ARGV[(i - 1) * 3 + 2])
  redis.call('HMSET',
    key,
    'tokens', tok,
    'last_refill_ts', now,
    'last_acquire_ts', now,
    'capacity', capacity,
    'refill_per_ms', refill)
  redis.call('HINCRBY', key, 'hits', 1)
  if min_remaining == nil or tok < min_remaining then
    min_remaining = tok
    min_key = key
  end
end

return { 1, min_key, tostring(min_remaining) }
`;

type LuaAcquireReply = [0 | 1, string, number | string];

@Injectable()
export class RateBucketService {
  private readonly logger = new Logger(RateBucketService.name);
  private readonly meta = new Map<string, BucketRuntimeMeta>();

  constructor(private readonly redis: RedisService) {}

  /**
   * Acquire one token across every declared hint atomically. Returns denied
   * on the first bucket that lacks capacity (with wait time), else allowed.
   */
  async acquire(
    hints: ReadonlyArray<RateLimitHint>,
    context: Readonly<Record<string, string>>,
  ): Promise<AcquireResult> {
    if (hints.length === 0) {
      throw new Error('acquire() requires at least one hint');
    }

    const keys: string[] = [];
    const args: Array<string | number> = [];

    for (const h of hints) {
      const raw = this.interpolate(h.keyTemplate, context);
      const fullKey = this.redis.key(raw);
      keys.push(fullKey);
      args.push(h.capacity, h.refillPerMs, h.costPerCall);

      this.meta.set(fullKey, {
        scope: h.scope,
        capacity: h.capacity,
        refillPerMs: h.refillPerMs,
        strategy: h.strategy,
      });
    }

    args.push(Date.now());

    const reply = (await this.redis.client.eval(
      LUA_ACQUIRE,
      keys.length,
      ...keys,
      ...args,
    )) as LuaAcquireReply;

    const [flag, bucketKey, value] = reply;

    if (flag === 1) {
      return {
        allowed: true,
        tokensRemaining: typeof value === 'string' ? Number(value) : value,
        bucketKey,
      };
    }

    return {
      allowed: false,
      resetInMs: typeof value === 'string' ? Number(value) : value,
      bucketKey,
    };
  }

  /**
   * Read a single bucket's state. Returns null if the key has never been
   * touched AND we have no runtime meta for it (can't infer capacity).
   */
  async getState(bucketKey: string): Promise<BucketState | null> {
    const meta = this.meta.get(bucketKey);
    const raw = await this.redis.client.hmget(
      bucketKey,
      'tokens',
      'last_refill_ts',
      'last_acquire_ts',
      'hits',
      'denies',
      'capacity',
      'refill_per_ms',
    );

    const [
      tokensRaw,
      lastRefillRaw,
      lastAcquireRaw,
      hitsRaw,
      deniesRaw,
      capacityRaw,
      refillRaw,
    ] = raw;

    if (tokensRaw === null && !meta) {
      return null;
    }

    // Prefer in-process meta (most up-to-date for the worker) but fall back
    // to persisted Redis fields so the API process — which never calls
    // acquire() — can still report capacity/refill in admin endpoints.
    const capacity = meta?.capacity ?? (capacityRaw ? Number(capacityRaw) : 0);
    const refillPerMs = meta?.refillPerMs ?? (refillRaw ? Number(refillRaw) : 0);
    const lastRefillTs = lastRefillRaw ? Number(lastRefillRaw) : null;
    let tokens = tokensRaw !== null ? Number(tokensRaw) : capacity;

    // Apply virtual refill so callers see current-ish state even if no
    // acquire has run since the last refill.
    if (lastRefillTs !== null && refillPerMs > 0) {
      const elapsed = Math.max(0, Date.now() - lastRefillTs);
      tokens = Math.min(capacity, tokens + elapsed * refillPerMs);
    }

    return {
      bucketKey,
      scope: meta?.scope ?? this.deriveScopeFromKey(bucketKey),
      tokens,
      capacity,
      refillPerMs,
      lastAcquireAt: lastAcquireRaw ? Number(lastAcquireRaw) : null,
      hits: hitsRaw ? Number(hitsRaw) : 0,
      denies: deniesRaw ? Number(deniesRaw) : 0,
      strategy: meta?.strategy ?? 'token-bucket',
    };
  }

  /**
   * Return state for every bucket the service knows about. Uses Redis SCAN
   * under the configured namespace to find keys that begin with 'rate:'.
   */
  async listAllBuckets(): Promise<BucketState[]> {
    const pattern = `${this.redis.ns}:rate:*`;
    const found = new Set<string>();
    let cursor = '0';

    do {
      const [next, batch] = await this.redis.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        200,
      );
      for (const k of batch) {
        found.add(k);
      }
      cursor = next;
    } while (cursor !== '0');

    for (const k of this.meta.keys()) {
      found.add(k);
    }

    const states: BucketState[] = [];
    for (const key of found) {
      const s = await this.getState(key);
      if (s) {
        states.push(s);
      }
    }
    return states;
  }

  /**
   * Force-refill by deleting the key. Next acquire recreates it at full
   * capacity. Useful for ops testing (admin 'reset bucket' button).
   */
  async reset(bucketKey: string): Promise<void> {
    await this.redis.client.del(bucketKey);
    this.logger.log(`Bucket reset: ${bucketKey}`);
  }

  /**
   * Expose declared runtime meta. Used by admin controllers to render
   * declared capacity alongside observed drift.
   */
  getMeta(bucketKey: string): BucketRuntimeMeta | null {
    return this.meta.get(bucketKey) ?? null;
  }

  /**
   * Template substitution. Variables look like {name} and are replaced from
   * the context map. Missing variables throw — surfaces missing context
   * bugs in tests rather than silently hitting a garbage key.
   */
  private interpolate(
    template: string,
    context: Readonly<Record<string, string>>,
  ): string {
    const implicit: Record<string, string> = {
      'YYYY-MM-DD-UTC': this.todayUtcIso(),
    };

    return template.replace(/\{([^}]+)\}/g, (_, name: string) => {
      if (name in implicit) {
        return implicit[name];
      }
      if (name in context) {
        return context[name];
      }
      throw new Error(
        `Missing context variable '${name}' for keyTemplate '${template}'`,
      );
    });
  }

  private todayUtcIso(): string {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = `${d.getUTCMonth() + 1}`.padStart(2, '0');
    const day = `${d.getUTCDate()}`.padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private deriveScopeFromKey(bucketKey: string): string {
    // connector-poc:rate:ig:user_token:abcd → 'ig:user_token'
    const stripped = bucketKey.replace(`${this.redis.ns}:rate:`, '');
    const parts = stripped.split(':');
    return parts.slice(0, 2).join(':');
  }
}
