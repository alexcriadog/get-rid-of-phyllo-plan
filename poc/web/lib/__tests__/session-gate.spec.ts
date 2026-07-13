import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('next-auth/jwt', () => ({ getToken: vi.fn() }));
import { getToken } from 'next-auth/jwt';
import { gateStatus } from '../session-gate';

const mockGetToken = getToken as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockGetToken.mockReset();
});

describe('gateStatus', () => {
  it('returns 200 when a token is present', async () => {
    mockGetToken.mockResolvedValue({ email: 'a@b.com' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await gateStatus({ headers: {}, cookies: {} } as any)).toBe(200);
  });
  it('returns 401 when no token', async () => {
    mockGetToken.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await gateStatus({ headers: {}, cookies: {} } as any)).toBe(401);
  });
});
