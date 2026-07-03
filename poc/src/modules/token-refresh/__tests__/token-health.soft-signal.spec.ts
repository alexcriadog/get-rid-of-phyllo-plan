import { TokenHealthCronService } from '../token-health.cron.service';

// data_access ~2 days out => classifyDataAccess => 'expiring'
const soonMs = Date.now() + 2 * 24 * 3600_000;

function build(account: any) {
  const prisma = {
    oAuthToken: {
      findMany: jest.fn().mockResolvedValue([
        { accountId: 7n, accessTokenCiphertext: Buffer.from('x'), account: {
          platform: 'facebook', handle: 'p', metadata: {},
          reauthRecommendedAt: account.reauthRecommendedAt, status: 'ready',
        } },
      ]),
    },
    account: { update: jest.fn().mockResolvedValue({}) },
  };
  const aes = { decrypt: jest.fn(() => 'plain') };
  const config = { get: jest.fn(() => 'appid') };
  const metrics = { incr: jest.fn() };
  const redis = { client: { set: jest.fn(), get: jest.fn() }, key: () => 'k' };
  const lifecycle = { reauthRecommended: jest.fn().mockResolvedValue(undefined) };
  const svc = new TokenHealthCronService(
    prisma as never, redis as never, aes as never, config as never,
    metrics as never, lifecycle as never,
  );
  // Force debug_token to report the "expiring" cliff without a network call.
  (svc as any).probeDataAccessExpiry = jest.fn().mockResolvedValue(soonMs);
  return { svc, prisma, lifecycle };
}

const run = (s: TokenHealthCronService) =>
  (s as unknown as { run: () => Promise<unknown> }).run();

describe('token-health soft signal', () => {
  it('sets reauthRecommendedAt + fires reauthRecommended once when expiring', async () => {
    const { svc, prisma, lifecycle } = build({ reauthRecommendedAt: null });
    await run(svc);
    expect(prisma.account.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7n },
        data: expect.objectContaining({ reauthRecommendedAt: expect.any(Date) }),
      }),
    );
    expect(lifecycle.reauthRecommended).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: does not re-fire when already flagged', async () => {
    const { svc, lifecycle } = build({ reauthRecommendedAt: new Date() });
    await run(svc);
    expect(lifecycle.reauthRecommended).not.toHaveBeenCalled();
  });

  it('clears reauthRecommendedAt when the account is healthy again (no event)', async () => {
    const { svc, prisma, lifecycle } = build({ reauthRecommendedAt: new Date() });
    // Healthy: data_access far in the future => classifyDataAccess => 'ok'
    (svc as any).probeDataAccessExpiry = jest
      .fn()
      .mockResolvedValue(Date.now() + 200 * 24 * 3600_000);
    await run(svc);
    expect(prisma.account.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7n },
        data: expect.objectContaining({ reauthRecommendedAt: null }),
      }),
    );
    expect(lifecycle.reauthRecommended).not.toHaveBeenCalled();
  });
});
