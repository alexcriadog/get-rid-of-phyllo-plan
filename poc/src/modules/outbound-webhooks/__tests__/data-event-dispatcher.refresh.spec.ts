import { DataEventDispatcher } from '../data-event-dispatcher.service';

function deps(acquire: boolean) {
  const account = { findUnique: jest.fn().mockResolvedValue({ id: 1n, workspaceId: 'w', platform: 'tiktok', isTest: false }) };
  // workspace mock lets the add-path resolveCadence() lookup succeed (no cadence config → defaults to immediate).
  const workspace = { findUnique: jest.fn().mockResolvedValue({ webhookCadence: null }) };
  const prisma = { account, workspace, webhookEndpoint: { findMany: jest.fn().mockResolvedValue([]) } } as any;
  const standardWebhooks = { fireData: jest.fn().mockResolvedValue(undefined) } as any;
  const webhooks = { emit: jest.fn().mockResolvedValue(undefined) } as any;
  const refresh = { getConfig: jest.fn().mockResolvedValue({ intervalSeconds: 3600, windowDays: 90 }), tryAcquire: jest.fn().mockResolvedValue(acquire) } as any;
  return { prisma, standardWebhooks, webhooks, refresh };
}

describe('DataEventDispatcher refresh branch', () => {
  it('emits refresh (fireData) when only engagement changed and cadence elapsed', async () => {
    const d = deps(true);
    const svc = new DataEventDispatcher(d.prisma, d.webhooks, d.standardWebhooks, d.refresh);
    await svc.fire({ accountId: 1n, product: 'content', itemsAdded: 0, sampleIds: [], itemsUpdated: 2, updatedSampleIds: ['a', 'b'] });
    expect(d.standardWebhooks.fireData).toHaveBeenCalledWith(expect.objectContaining({ accountId: 1n, product: 'content', sampleIds: ['a', 'b'] }));
  });
  it('does NOT emit when cadence not elapsed', async () => {
    const d = deps(false);
    const svc = new DataEventDispatcher(d.prisma, d.webhooks, d.standardWebhooks, d.refresh);
    await svc.fire({ accountId: 1n, product: 'content', itemsAdded: 0, sampleIds: [], itemsUpdated: 2, updatedSampleIds: ['a'] });
    expect(d.standardWebhooks.fireData).not.toHaveBeenCalled();
  });
  it('does NOT emit when nothing changed', async () => {
    const d = deps(true);
    const svc = new DataEventDispatcher(d.prisma, d.webhooks, d.standardWebhooks, d.refresh);
    await svc.fire({ accountId: 1n, product: 'content', itemsAdded: 0, sampleIds: [], itemsUpdated: 0, updatedSampleIds: [] });
    expect(d.standardWebhooks.fireData).not.toHaveBeenCalled();
    expect(d.refresh.tryAcquire).not.toHaveBeenCalled();
  });
  it('added path unchanged when itemsAdded>0', async () => {
    const d = deps(true);
    const svc = new DataEventDispatcher(d.prisma, d.webhooks, d.standardWebhooks, d.refresh);
    await svc.fire({ accountId: 1n, product: 'content', itemsAdded: 1, sampleIds: ['n'], itemsUpdated: 5, updatedSampleIds: ['x'] });
    expect(d.standardWebhooks.fireData).toHaveBeenCalledWith(expect.objectContaining({ sampleIds: ['n'] }));
    expect(d.refresh.tryAcquire).not.toHaveBeenCalled();
  });
});
