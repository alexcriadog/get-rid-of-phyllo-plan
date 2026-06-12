import { RefreshCadenceService } from '../refresh-cadence.service';

const prisma = { cadence: { findUnique: jest.fn() } } as any;

function redisMock(setResult: 'OK' | null) {
  return { client: { set: jest.fn().mockResolvedValue(setResult) } } as any;
}

describe('RefreshCadenceService', () => {
  it('returns config with defaults when row missing', async () => {
    prisma.cadence.findUnique.mockResolvedValue(null);
    const svc = new RefreshCadenceService(prisma, redisMock('OK'));
    expect(await svc.getConfig('tiktok', 'content')).toEqual({
      intervalSeconds: 21600,
      windowDays: 90,
    });
  });

  it('uses row overrides when present', async () => {
    prisma.cadence.findUnique.mockResolvedValue({
      refreshIntervalSeconds: 3600,
      refreshWindowDays: 30,
    });
    const svc = new RefreshCadenceService(prisma, redisMock('OK'));
    expect(await svc.getConfig('tiktok', 'content')).toEqual({
      intervalSeconds: 3600,
      windowDays: 30,
    });
  });

  it('tryAcquire returns true when SET NX returns OK', async () => {
    const r = redisMock('OK');
    const svc = new RefreshCadenceService(prisma, r);
    expect(await svc.tryAcquire(1n, 'content', 3600)).toBe(true);
    expect(r.client.set).toHaveBeenCalledWith(
      'refresh_emit:1:content',
      '1',
      'EX',
      3600,
      'NX',
    );
  });

  it('tryAcquire returns false when SET NX returns null (already set)', async () => {
    const svc = new RefreshCadenceService(prisma, redisMock(null));
    expect(await svc.tryAcquire(1n, 'content', 3600)).toBe(false);
  });

  it('tryAcquire fails closed (false) on redis error', async () => {
    const r = {
      client: { set: jest.fn().mockRejectedValue(new Error('down')) },
    } as any;
    const svc = new RefreshCadenceService(prisma, r);
    expect(await svc.tryAcquire(1n, 'content', 3600)).toBe(false);
  });
});
