import { probeAccount } from '../token-canary.util';
import { TokenRevokedError } from '@modules/platforms/shared/platform-adapter.port';

const adapterWith = (impl: () => Promise<unknown>) => ({ fetchProfile: impl }) as never;

describe('probeAccount', () => {
  it('returns healthy on a successful read', async () => {
    const r = await probeAccount(adapterWith(async () => ({ id: '1' })), 't', 'c');
    expect(r).toBe('healthy');
  });
  it('returns reauth on TokenRevokedError', async () => {
    const r = await probeAccount(
      adapterWith(async () => { throw new TokenRevokedError('platform', 'canonical'); }), 't', 'c');
    expect(r).toBe('reauth');
  });
  it('returns transient on any other error (default-to-transient)', async () => {
    const r = await probeAccount(
      adapterWith(async () => { throw new Error('503'); }), 't', 'c');
    expect(r).toBe('transient');
  });
});
