import { AesLocalService } from '../aes-local.service';
import type { AppConfigService } from '@shared/config/config.module';

// Synthetic 32-byte (64 hex char) keys — never used outside this test.
const KEY_A = 'aa'.repeat(32);
const KEY_B = 'bb'.repeat(32);
const KEY_C = 'cc'.repeat(32);

/** Minimal AppConfigService stub backed by a plain map. */
function makeConfig(values: Record<string, string | undefined>): AppConfigService {
  return {
    getOrThrow: <T = string>(key: string): T => {
      const v = values[key];
      if (v === undefined) throw new Error(`missing ${key}`);
      return v as unknown as T;
    },
    get: <T = string>(key: string): T | undefined =>
      values[key] as unknown as T | undefined,
  } as unknown as AppConfigService;
}

function makeService(values: Record<string, string | undefined>): AesLocalService {
  const svc = new AesLocalService(makeConfig(values));
  svc.onModuleInit();
  return svc;
}

describe('AesLocalService', () => {
  it('round-trips a value with the active key', () => {
    const svc = makeService({ LOCAL_AES_KEY: KEY_A });
    const sealed = svc.encrypt('hello-token');
    expect(svc.decrypt(sealed)).toBe('hello-token');
  });

  it('decrypts old ciphertext after the active key rotates (key in OLD list)', () => {
    // Seal with A as the active key.
    const sealed = makeService({ LOCAL_AES_KEY: KEY_A }).encrypt('secret');
    // Rotate: B is now active, A is retired.
    const rotated = makeService({
      LOCAL_AES_KEY: KEY_B,
      LOCAL_AES_KEYS_OLD: KEY_A,
    });
    expect(rotated.decrypt(sealed)).toBe('secret');
  });

  it('re-encrypts with the ACTIVE key (new ciphertext needs no fallback)', () => {
    const rotated = makeService({
      LOCAL_AES_KEY: KEY_B,
      LOCAL_AES_KEYS_OLD: KEY_A,
    });
    const sealed = rotated.encrypt('fresh');
    // A service with ONLY B active (no old keys) still decrypts it →
    // proves encrypt used the active key, not a retired one.
    expect(makeService({ LOCAL_AES_KEY: KEY_B }).decrypt(sealed)).toBe('fresh');
  });

  it('finds the right key among multiple retired keys', () => {
    const sealed = makeService({ LOCAL_AES_KEY: KEY_B }).encrypt('multi');
    const svc = makeService({
      LOCAL_AES_KEY: KEY_C,
      LOCAL_AES_KEYS_OLD: `${KEY_A}, ${KEY_B}`, // whitespace tolerated
    });
    expect(svc.decrypt(sealed)).toBe('multi');
  });

  it('throws when no configured key can decrypt', () => {
    const sealed = makeService({ LOCAL_AES_KEY: KEY_A }).encrypt('orphan');
    const svc = makeService({ LOCAL_AES_KEY: KEY_B }); // A not present
    expect(() => svc.decrypt(sealed)).toThrow(/AES decrypt failed/);
  });

  it('rejects a malformed active key at init', () => {
    expect(() => makeService({ LOCAL_AES_KEY: 'deadbeef' })).toThrow(
      /LOCAL_AES_KEY must decode to 32 bytes/,
    );
  });

  it('rejects a malformed retired key at init', () => {
    expect(() =>
      makeService({ LOCAL_AES_KEY: KEY_A, LOCAL_AES_KEYS_OLD: 'zz' }),
    ).toThrow(/LOCAL_AES_KEYS_OLD\[0\] must decode to 32 bytes/);
  });
});
