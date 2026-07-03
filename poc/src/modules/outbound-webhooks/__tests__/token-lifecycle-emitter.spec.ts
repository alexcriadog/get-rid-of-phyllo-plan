import { TokenLifecycleEmitter } from '../token-lifecycle-emitter.service';

function build(account: any) {
  const prisma = { account: { findUnique: jest.fn().mockResolvedValue(account) } };
  const webhooks = { emit: jest.fn().mockResolvedValue(undefined) };
  const standardWebhooks = { fireLifecycle: jest.fn().mockResolvedValue(undefined) };
  const svc = new TokenLifecycleEmitter(prisma as never, webhooks as never, standardWebhooks as never);
  return { svc, webhooks };
}

const acct = {
  id: 7n, workspaceId: 'w1', platform: 'instagram',
  canonicalUserId: 'cid', endUserId: 'eu1', isTest: false,
};

describe('TokenLifecycleEmitter re-auth signals', () => {
  it('reauthRecommended emits token.reauth_required with severity soft', async () => {
    const { svc, webhooks } = build(acct);
    const when = new Date('2026-08-08T00:00:00.000Z');
    await svc.reauthRecommended(7n, { dataAccessExpiresAt: when, reason: 'data_access expiring' });
    expect(webhooks.emit).toHaveBeenCalledWith(
      'w1',
      'token.reauth_required',
      expect.objectContaining({
        account_id: '7',
        platform: 'instagram',
        workspace_id: 'w1',
        severity: 'soft',
        data_access_expires_at: when.toISOString(),
        reason: 'data_access expiring',
      }),
    );
  });

  it('tokenRecovered emits token.recovered', async () => {
    const { svc, webhooks } = build(acct);
    await svc.tokenRecovered(7n, { reason: 'canary probe healthy' });
    expect(webhooks.emit).toHaveBeenCalledWith(
      'w1',
      'token.recovered',
      expect.objectContaining({ account_id: '7', reason: 'canary probe healthy' }),
    );
  });

  it('drops test-mode accounts silently', async () => {
    const { svc, webhooks } = build({ ...acct, isTest: true });
    await svc.reauthRecommended(7n, { dataAccessExpiresAt: null, reason: 'x' });
    expect(webhooks.emit).not.toHaveBeenCalled();
  });
});
