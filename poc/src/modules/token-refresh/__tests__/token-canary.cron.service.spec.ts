import { TokenCanaryCronService } from '../token-canary.cron.service';

function build(accounts: any[], probe: (p: string) => Promise<unknown>) {
  const prisma = {
    account: {
      findMany: jest.fn().mockResolvedValue(accounts),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const aes = { decrypt: jest.fn(() => 'plain') };
  const metrics = { incr: jest.fn() };
  const redis = { client: {}, key: () => 'k' };
  const lifecycle = {
    tokenRecovered: jest.fn().mockResolvedValue(undefined),
    tokenExpired: jest.fn().mockResolvedValue(undefined),
  };
  const adapters = new Proxy({}, { get: () => ({ fetchProfile: probe }) });
  const svc = new TokenCanaryCronService(
    prisma as never, redis as never, aes as never,
    metrics as never, lifecycle as never, adapters as never,
  );
  return { svc, prisma, lifecycle };
}
const row = (o: any) => ({
  id: o.id, platform: 'facebook', canonicalUserId: 'c', status: o.status,
  metadata: {}, tokens: [{ accessTokenCiphertext: Buffer.from('x'), userAccessTokenCiphertext: null }],
});
const run = (s: TokenCanaryCronService) =>
  (s as unknown as { run: () => Promise<unknown> }).run();

describe('token-canary cron', () => {
  it('self-heals a needs_reauth account whose probe is healthy', async () => {
    const { svc, prisma, lifecycle } = build(
      [row({ id: 2n, status: 'needs_reauth' })], async () => ({ id: '1' }));
    await run(svc);
    expect(prisma.account.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 2n }, data: expect.objectContaining({ status: 'ready' }) }));
    expect(lifecycle.tokenRecovered).toHaveBeenCalledTimes(1);
    expect(lifecycle.tokenExpired).not.toHaveBeenCalled();
  });

  it('flags a quiet ready account whose probe reports reauth', async () => {
    const { TokenRevokedError } = require('@modules/platforms/shared/platform-adapter.port');
    const { svc, prisma, lifecycle } = build(
      [row({ id: 5n, status: 'ready' })],
      async () => { throw new TokenRevokedError('facebook', 'c'); });
    await run(svc);
    expect(prisma.account.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5n }, data: expect.objectContaining({ status: 'needs_reauth' }) }));
    expect(lifecycle.tokenExpired).toHaveBeenCalledTimes(1);
    expect(lifecycle.tokenRecovered).not.toHaveBeenCalled();
  });

  it('does nothing on a transient probe', async () => {
    const { svc, prisma, lifecycle } = build(
      [row({ id: 5n, status: 'ready' })], async () => { throw new Error('503'); });
    await run(svc);
    expect(prisma.account.update).not.toHaveBeenCalled();
    expect(lifecycle.tokenExpired).not.toHaveBeenCalled();
    expect(lifecycle.tokenRecovered).not.toHaveBeenCalled();
  });
});
