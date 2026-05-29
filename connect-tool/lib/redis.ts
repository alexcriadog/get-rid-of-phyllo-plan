// Shared ioredis client for connect-tool.
//
// connect-tool was single-instance (OAuth sessions lived in an in-memory
// Map), which meant it could not run behind a load balancer — the OAuth
// callback could land on a different instance than the one that started
// the flow. Moving session state to Redis makes connect-tool stateless
// and horizontally scalable. Reuses the same Redis that POC already runs
// (reachable as redis://redis:6379 on the docker-compose network).
//
// The client is anchored on globalThis for the same reason the old
// session Map was: Next.js `output: 'standalone'` bundles API routes and
// page SSR into separate webpack chunks, so a plain module-level
// singleton would be duplicated. globalThis dedupes it to one connection
// per process.

import Redis from 'ioredis';

const GLOBAL_KEY = '__connect_tool_redis__';
type GlobalStore = { [GLOBAL_KEY]?: Redis };
const g = globalThis as unknown as GlobalStore;

export function getRedis(): Redis {
  const existing = g[GLOBAL_KEY];
  if (existing) return existing;
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL is not configured for connect-tool');
  }
  const client = new Redis(url, {
    // connect-tool only does GET/SET/DEL — keep retries bounded so a
    // Redis blip surfaces as a clean error instead of hanging the OAuth
    // request indefinitely.
    maxRetriesPerRequest: 3,
  });
  g[GLOBAL_KEY] = client;
  return client;
}
