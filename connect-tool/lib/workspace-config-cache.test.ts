import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory Redis stand-in honouring SET ... EX and GET.
class FakeRedis {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  async set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, value);
    return 'OK';
  }
}
const fake = new FakeRedis();
vi.mock('./redis', () => ({ getRedis: () => fake }));

// axios mock — default export with a `.get` we can program per-test.
// vi.hoisted so `get` exists before the hoisted vi.mock factory runs.
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', () => ({ default: { get } }));

import { fetchWorkspaceProducts } from './workspace-config';

const ok = (products: unknown) => ({ status: 200, data: { products } });

describe('fetchWorkspaceProducts caching', () => {
  beforeEach(() => {
    fake.store.clear();
    get.mockReset();
    process.env.POC_API_URL = 'http://api:3000';
  });

  it('caches a successful fetch and serves the 2nd call from Redis', async () => {
    get.mockResolvedValueOnce(ok({ tiktok: ['audience'] }));
    const first = await fetchWorkspaceProducts('acme');
    expect(first).toEqual({ tiktok: ['audience'] });
    const second = await fetchWorkspaceProducts('acme');
    expect(second).toEqual({ tiktok: ['audience'] });
    // Only the first call hit POC.
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('caches a legitimate null (unrestricted) so it is not re-fetched', async () => {
    get.mockResolvedValueOnce(ok(null));
    expect(await fetchWorkspaceProducts('open-ws')).toBeNull();
    expect(await fetchWorkspaceProducts('open-ws')).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
    // The cached envelope distinguishes "known null" from "absent".
    expect(fake.store.get('wsconfig:open-ws')).toBe('{"products":null}');
  });

  it('does NOT cache a non-200 failure (re-fetches next time)', async () => {
    get.mockResolvedValueOnce({ status: 503, data: {} });
    expect(await fetchWorkspaceProducts('flaky')).toBeNull();
    expect(fake.store.has('wsconfig:flaky')).toBe(false);
    // Second call retries POC rather than serving a poisoned cache.
    get.mockResolvedValueOnce(ok({ youtube: [] }));
    expect(await fetchWorkspaceProducts('flaky')).toEqual({ youtube: [] });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('does NOT cache a network error', async () => {
    get.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await fetchWorkspaceProducts('down')).toBeNull();
    expect(fake.store.has('wsconfig:down')).toBe(false);
  });
});
