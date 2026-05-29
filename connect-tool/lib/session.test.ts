import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';

// Minimal in-memory stand-in for the ioredis client. Honours the subset of
// semantics session.ts relies on: SET with PX (expiry) / KEEPTTL, GET, DEL.
class FakeRedis {
  private store = new Map<string, { value: string; expireAt: number | null }>();

  async set(
    key: string,
    value: string,
    mode?: 'PX' | 'KEEPTTL',
    ttlMs?: number,
  ): Promise<'OK'> {
    if (mode === 'PX' && typeof ttlMs === 'number') {
      this.store.set(key, { value, expireAt: Date.now() + ttlMs });
    } else if (mode === 'KEEPTTL') {
      const prev = this.store.get(key);
      this.store.set(key, { value, expireAt: prev?.expireAt ?? null });
    } else {
      this.store.set(key, { value, expireAt: null });
    }
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expireAt !== null && hit.expireAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return hit.value;
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  /** Test helper: force-expire a key to simulate TTL elapse. */
  forceExpire(key: string): void {
    const hit = this.store.get(key);
    if (hit) this.store.set(key, { ...hit, expireAt: Date.now() - 1 });
  }
}

const fake = new FakeRedis();
vi.mock('./redis', () => ({ getRedis: () => fake }));

// Imported AFTER the mock is registered.
import {
  putSession,
  getSession,
  getFbSession,
  getSimpleSession,
  getOAuthContextSession,
  dropSession,
  attachContext,
} from './session';

const simpleInput = {
  kind: 'simple' as const,
  platform: 'tiktok' as const,
  // seedBody shape is exercised elsewhere; cast keeps this spec focused on
  // the store round-trip rather than the SeedBody contract.
  seedBody: {
    platform: 'tiktok',
    external_account_id: 'tt_123',
    access_token: 'tok_abc',
  } as never,
  preview: { handle: '@demo' },
};

describe('session store (Redis-backed)', () => {
  it('round-trips a simple session through put → get', async () => {
    const id = await putSession(simpleInput);
    const got = await getSimpleSession(id);
    expect(got?.kind).toBe('simple');
    expect(got?.platform).toBe('tiktok');
    expect(got?.preview.handle).toBe('@demo');
    expect(typeof got?.createdAt).toBe('number');
  });

  it('typed getters reject the wrong discriminator', async () => {
    const id = await putSession(simpleInput);
    expect(await getFbSession(id)).toBeNull();
    expect(await getOAuthContextSession(id)).toBeNull();
    expect((await getSimpleSession(id))?.kind).toBe('simple');
  });

  it('returns null for unknown / empty ids', async () => {
    expect(await getSession('')).toBeNull();
    expect(await getSession('deadbeef'.repeat(4))).toBeNull();
  });

  it('dropSession removes the key', async () => {
    const id = await putSession(simpleInput);
    expect(await getSimpleSession(id)).not.toBeNull();
    await dropSession(id);
    expect(await getSimpleSession(id)).toBeNull();
  });

  it('attachContext merges ctx onto a simple/fb session', async () => {
    const id = await putSession(simpleInput);
    await attachContext(id, {
      workspaceId: 'ws_1',
      endUserId: 'eu_1',
      workspaceSlug: 'acme',
      environment: 'test',
    });
    const got = await getSimpleSession(id);
    expect(got?.ctx?.workspaceId).toBe('ws_1');
    expect(got?.ctx?.workspaceSlug).toBe('acme');
    expect(got?.ctx?.environment).toBe('test');
  });

  it('attachContext leaves oauth-context sessions unchanged', async () => {
    const id = await putSession({
      kind: 'oauth-context',
      workspaceId: 'ws_2',
      workspaceSlug: 'beta',
      endUserId: 'eu_2',
    });
    await attachContext(id, { workspaceId: 'x', endUserId: 'y' });
    const got = await getOAuthContextSession(id);
    expect(got?.workspaceId).toBe('ws_2');
  });

  it('expired keys read back as null', async () => {
    const id = await putSession(simpleInput);
    fake.forceExpire(`session:${id}`);
    expect(await getSimpleSession(id)).toBeNull();
  });
});
