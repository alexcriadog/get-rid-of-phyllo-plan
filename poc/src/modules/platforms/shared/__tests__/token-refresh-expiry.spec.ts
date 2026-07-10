// A successful refresh must NEVER persist a null expiresAt: a null would
// exclude the row from both the proactive cron and fetch-time ensureFresh,
// silently disabling refresh until a sync hits a 401 (edge 4). When the
// provider omits `expires_in`, fall back to the platform's documented TTL.

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
import axios from 'axios';

import { resolveRefreshExpiry } from '../token-refresh-expiry';
import { YoutubeTokenRefreshService } from '../youtube-api/youtube-token-refresh.service';

const post = axios.post as jest.Mock;
const NOW = 1_700_000_000_000;

describe('resolveRefreshExpiry', () => {
  it('uses expires_in when present and positive', () => {
    expect(resolveRefreshExpiry(3600, 999_000, NOW)).toEqual(
      new Date(NOW + 3600 * 1000),
    );
  });

  it('falls back to the platform default when expires_in is missing', () => {
    expect(resolveRefreshExpiry(undefined, 5000, NOW)).toEqual(new Date(NOW + 5000));
  });

  it('falls back when expires_in is zero or negative — never returns null', () => {
    expect(resolveRefreshExpiry(0, 5000, NOW)).toEqual(new Date(NOW + 5000));
    expect(resolveRefreshExpiry(-10, 5000, NOW)).toEqual(new Date(NOW + 5000));
  });
});

describe('refresh success never persists a null expiry', () => {
  it('YouTube without expires_in persists a fallback Date, not null', async () => {
    post.mockReset();
    post.mockResolvedValue({ status: 200, data: { access_token: 'new-access' } });
    const prisma = { oAuthToken: { update: jest.fn().mockResolvedValue({}) } };
    const aes = { encrypt: jest.fn(() => Buffer.from('c')), decrypt: jest.fn(() => 'p') };
    const tokenHistory = { record: jest.fn().mockResolvedValue(undefined) };
    const config = { get: jest.fn(() => 'cred') };
    const lifecycle = {
      tokenRefreshed: jest.fn().mockResolvedValue(undefined),
      tokenRefreshFailed: jest.fn().mockResolvedValue(undefined),
    };

    await new YoutubeTokenRefreshService(
      prisma as never,
      aes as never,
      tokenHistory as never,
      config as never,
      lifecycle as never,
    ).refresh(1n, 'rt');

    const arg = prisma.oAuthToken.update.mock.calls[0][0] as {
      data: { expiresAt: unknown };
    };
    expect(arg.data.expiresAt).toBeInstanceOf(Date);
  });
});
