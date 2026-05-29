// Best-effort distributed lock for cron jobs.
//
// The webhook digest + retention crons fire in EVERY api instance (the
// @nestjs/schedule decorator is per-process). With a single api container
// that's fine, but the moment you run 2+ api replicas they'd both flush /
// both delete the same rows concurrently. This wraps a cron body so only
// the instance that wins the Redis lock runs it; the rest skip.
//
// Semantics: SET key val NX PX ttl. If acquired, run fn() then release the
// lock ONLY if we still own it (compare-and-delete via Lua, so a slow job
// whose TTL already expired doesn't delete a lock a different instance has
// since taken). If not acquired, return { ran: false } — the caller logs
// and moves on.

import type { Redis } from 'ioredis';

// Atomic compare-and-delete: only DEL if the value still matches ours.
const RELEASE_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`;

export interface CronLockResult<T> {
  ran: boolean;
  result?: T;
}

/**
 * Run `fn` only if this process acquires the lock `key`. The lock
 * auto-expires after `ttlMs` (set it comfortably above the job's worst-case
 * runtime so a long job doesn't lose its lock mid-run). `token` should be
 * unique per attempt — a ULID or `${pid}-${Date.now()}` style value.
 */
export async function runWithLock<T>(
  redis: Redis,
  key: string,
  token: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<CronLockResult<T>> {
  const acquired = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (acquired !== 'OK') {
    return { ran: false };
  }
  try {
    const result = await fn();
    return { ran: true, result };
  } finally {
    try {
      await redis.eval(RELEASE_LUA, 1, key, token);
    } catch {
      // Release failure is non-fatal — the lock expires on its own via PX.
    }
  }
}
