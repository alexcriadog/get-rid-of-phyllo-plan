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
      'engagement_new',
      90,
    );
    expect(r.sampleCount).toBe(2);
    expect(standardWebhooks.fireData).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 1n,
        product: 'engagement_new',
        sampleIds: ['a', 'b'],
      }),
    );
    expect(webhooks.emit).toHaveBeenCalledWith(
      'w',
      'data.engagement_new.updated',
      expect.objectContaining({ reason: 'manual' }),
    );
  });

  it('returns sampleCount 0 WITHOUT emitting when no in-window content', async () => {
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
      'engagement_new',
      90,
    );
    expect(r.sampleCount).toBe(0);
    expect(standardWebhooks.fireData).not.toHaveBeenCalled();
    expect(webhooks.emit).not.toHaveBeenCalled();
  });
});
