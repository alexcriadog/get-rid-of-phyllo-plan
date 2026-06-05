import { purgeV1CacheForWorkspace } from '../cache.interceptor';

type ScanResult = [string, string[]];

/** Minimal ioredis double: paged SCAN results, records DEL calls. */
function makeClient(pages: ScanResult[]): {
  scan: jest.Mock;
  del: jest.Mock;
  deleted: string[];
} {
  const deleted: string[] = [];
  let call = 0;
  const scan = jest.fn().mockImplementation(() => {
    const page = pages[Math.min(call, pages.length - 1)];
    call += 1;
    return Promise.resolve(page);
  });
  const del = jest.fn().mockImplementation((...keys: string[]) => {
    deleted.push(...keys);
    return Promise.resolve(keys.length);
  });
  return { scan, del, deleted };
}

describe('purgeV1CacheForWorkspace', () => {
  it('scans with the workspace prefix and deletes every matched key', async () => {
    const client = makeClient([
      ['42', ['cache:v1:ws_a:k1', 'cache:v1:ws_a:k2']],
      ['0', ['cache:v1:ws_a:k3']],
    ]);
    const n = await purgeV1CacheForWorkspace(client as never, 'ws_a');
    expect(n).toBe(3);
    expect(client.deleted).toEqual([
      'cache:v1:ws_a:k1',
      'cache:v1:ws_a:k2',
      'cache:v1:ws_a:k3',
    ]);
    expect(client.scan).toHaveBeenCalledWith(
      '0',
      'MATCH',
      'cache:v1:ws_a:*',
      'COUNT',
      200,
    );
  });

  it('handles empty scans without calling DEL', async () => {
    const client = makeClient([['0', []]]);
    const n = await purgeV1CacheForWorkspace(client as never, 'ws_b');
    expect(n).toBe(0);
    expect(client.del).not.toHaveBeenCalled();
  });
});
