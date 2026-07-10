import { AccountsService } from '../accounts.service';

jest.mock('@/common/interceptors/cache.interceptor', () => ({
  purgeV1CacheForWorkspace: jest.fn().mockResolvedValue(undefined),
}));

interface ExistingRow {
  id: bigint;
  syncTier: string;
  status: string;
}

function build(existing: ExistingRow | null) {
  const tx = {
    account: {
      findFirst: jest.fn().mockResolvedValue(existing),
      update: jest.fn().mockResolvedValue({ id: existing?.id ?? 9n, isTest: false }),
      create: jest.fn().mockResolvedValue({ id: 9n, isTest: false }),
    },
    syncJob: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({ id: 1n }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    oAuthToken: { upsert: jest.fn().mockResolvedValue({}) },
  };
  const prisma = { $transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx) };
  const aes = { encrypt: jest.fn().mockReturnValue(Buffer.from('cipher')) };
  const workspaces = { resolveProducts: jest.fn().mockResolvedValue(null) };
  const redis = { client: {} };
  const tokenHistory = { record: jest.fn().mockResolvedValue(undefined) };
  const outboundWebhooks = { emit: jest.fn().mockResolvedValue(undefined) };
  const standardWebhooks = { fireLifecycle: jest.fn().mockResolvedValue(undefined) };
  const svc = new AccountsService(
    prisma as never,
    aes as never,
    workspaces as never,
    redis as never,
    tokenHistory as never,
    outboundWebhooks as never,
    standardWebhooks as never,
  );
  return { svc, tx, outboundWebhooks, standardWebhooks };
}

const seedInput = {
  platform: 'tiktok' as const,
  accessToken: 'tok',
  canonicalUserId: 'cu1',
  workspaceId: 'w1',
};

describe('seedAccount reconnect of a needs_reauth account', () => {
  it('emits token.recovered (native + thin) and clears the soft re-auth flags', async () => {
    const { svc, tx, outboundWebhooks, standardWebhooks } = build({
      id: 5n,
      syncTier: 'standard',
      status: 'needs_reauth',
    });
    await svc.seedAccount(seedInput);

    expect(outboundWebhooks.emit).toHaveBeenCalledWith(
      'w1',
      'token.recovered',
      expect.objectContaining({ account_id: '5', reason: 'reconnected' }),
    );
    expect(standardWebhooks.fireLifecycle).toHaveBeenCalledWith({
      accountId: 5n,
      type: 'token.recovered',
    });
    expect(tx.account.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reauthRecommendedAt: null,
          dataAccessExpiresAt: null,
        }),
      }),
    );
  });

  it('re-seeding a healthy account emits account.connected but NOT token.recovered', async () => {
    const { svc, outboundWebhooks } = build({
      id: 5n,
      syncTier: 'standard',
      status: 'ready',
    });
    await svc.seedAccount(seedInput);

    const events = outboundWebhooks.emit.mock.calls.map((c) => c[1]);
    expect(events).toContain('account.connected');
    expect(events).not.toContain('token.recovered');
  });
});
