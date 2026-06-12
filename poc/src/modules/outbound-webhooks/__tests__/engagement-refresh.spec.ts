import { EngagementRefreshService } from '../engagement-refresh.service';

function mongoWith(ids: string[]) {
  return {
    getCollection: () => ({
      find: () => ({
        sort: () => ({
          limit: () => ({
            toArray: async () => ids.map((external_id) => ({ external_id })),
          }),
        }),
      }),
    }),
  } as any;
}

describe('EngagementRefreshService', () => {
  it('emits with in-window ids, reason=manual', async () => {
    const standardWebhooks = {
      fireData: jest.fn().mockResolvedValue(undefined),
    } as any;
    const webhooks = { emit: jest.fn().mockResolvedValue(undefined) } as any;
    const svc = new EngagementRefreshService(
      mongoWith(['a', 'b']),
      standardWebhooks,
      webhooks,
    );
    const r = await svc.emitForAccount(
      { id: 1n, workspaceId: 'w', platform: 'tiktok' } as any,
      'content',
      90,
    );
    expect(r.sampleCount).toBe(2);
    expect(standardWebhooks.fireData).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 1n,
        product: 'content',
        sampleIds: ['a', 'b'],
      }),
    );
    expect(webhooks.emit).toHaveBeenCalledWith(
      'w',
      'data.content.updated',
      expect.objectContaining({ reason: 'manual' }),
    );
  });

  it('returns sampleCount 0 without throwing when no in-window content', async () => {
    const standardWebhooks = {
      fireData: jest.fn().mockResolvedValue(undefined),
    } as any;
    const webhooks = { emit: jest.fn().mockResolvedValue(undefined) } as any;
    const svc = new EngagementRefreshService(
      mongoWith([]),
      standardWebhooks,
      webhooks,
    );
    const r = await svc.emitForAccount(
      { id: 1n, workspaceId: 'w', platform: 'tiktok' } as any,
      'content',
      90,
    );
    expect(r.sampleCount).toBe(0);
  });
});
