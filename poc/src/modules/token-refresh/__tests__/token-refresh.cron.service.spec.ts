// Cron error-classification behaviour (the 🔴/🟠 token-refresh edge-case fix).
//
// The proactive sweep must act on WHY a refresh failed, not on whether the
// access token happens to be expired:
//   - transient failure (5xx / network) → retry next hour, NEVER needs_reauth,
//     even when the token has already lapsed (a passing outage must not force
//     a reconnect on an account whose refresh token is still valid).
//   - permanent failure (revoked / invalid_grant) → flag needs_reauth NOW,
//     even with days of lead left, instead of retrying for the whole window.

import { TokenRefreshError } from '@modules/platforms/shared/token-refresh-error';
import { TokenRefreshCronService } from '../token-refresh.cron.service';

const DAY_MS = 24 * 60 * 60_000;

interface Row {
  accountId: bigint;
  expiresAt: Date;
  refreshTokenCiphertext: Buffer | null;
  accessTokenCiphertext: Buffer;
  account: { platform: string; metadata: unknown };
}

function buildService(row: Row, refreshImpls: Record<string, jest.Mock>) {
  const prisma = {
    oAuthToken: { findMany: jest.fn().mockResolvedValue([row]) },
    account: { update: jest.fn().mockResolvedValue({}) },
  };
  const aes = { decrypt: jest.fn(() => 'plain'), encrypt: jest.fn(() => Buffer.from('x')) };
  const metrics = { incr: jest.fn() };
  const lifecycle = { tokenExpired: jest.fn().mockResolvedValue(undefined) };
  const svc = (platform: string) => ({ refresh: refreshImpls[platform] ?? jest.fn() });
  const service = new TokenRefreshCronService(
    prisma as never,
    {} as never, // redis — unused by run()
    aes as never,
    metrics as never,
    lifecycle as never,
    svc('tiktok') as never,
    svc('twitch') as never,
    svc('youtube') as never,
    svc('threads') as never,
    svc('instagram') as never, // igDirect
    svc('linkedin') as never,
  );
  return { service, prisma, lifecycle };
}

// run() is the private sweep body; invoke it directly to bypass the
// api-process gate + Redis lock that refreshExpiringTokens() wraps it in.
const run = (s: TokenRefreshCronService) =>
  (s as unknown as { run: () => Promise<unknown> }).run();

describe('TokenRefreshCronService error classification', () => {
  it('does NOT flag needs_reauth on a transient failure even when the token already expired', async () => {
    const youtube = jest
      .fn()
      .mockRejectedValue(new TokenRefreshError('HTTP 503', false));
    const { service, prisma, lifecycle } = buildService(
      {
        accountId: 1n,
        expiresAt: new Date(Date.now() - 60_000), // already expired
        refreshTokenCiphertext: Buffer.from('rt'),
        accessTokenCiphertext: Buffer.from('at'),
        account: { platform: 'youtube', metadata: null },
      },
      { youtube },
    );

    const result = (await run(service)) as { reauthFlagged: number; failed: number };

    expect(youtube).toHaveBeenCalledTimes(1);
    expect(prisma.account.update).not.toHaveBeenCalled();
    expect(lifecycle.tokenExpired).not.toHaveBeenCalled();
    expect(result.reauthFlagged).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('flags needs_reauth immediately on a permanent failure with days of lead left', async () => {
    const linkedin = jest
      .fn()
      .mockRejectedValue(new TokenRefreshError('invalid_grant', true));
    const { service, prisma, lifecycle } = buildService(
      {
        accountId: 2n,
        expiresAt: new Date(Date.now() + 3 * DAY_MS), // NOT yet expired (within 7d lead)
        refreshTokenCiphertext: Buffer.from('rt'),
        accessTokenCiphertext: Buffer.from('at'),
        account: { platform: 'linkedin', metadata: null },
      },
      { linkedin },
    );

    const result = (await run(service)) as { reauthFlagged: number };

    expect(linkedin).toHaveBeenCalledTimes(1);
    expect(prisma.account.update).toHaveBeenCalledWith({
      where: { id: 2n },
      data: { status: 'needs_reauth' },
    });
    expect(lifecycle.tokenExpired).toHaveBeenCalledTimes(1);
    expect(result.reauthFlagged).toBe(1);
  });

  it('still flags needs_reauth on a permanent failure once the token has expired (legit revoke)', async () => {
    const youtube = jest
      .fn()
      .mockRejectedValue(new TokenRefreshError('invalid_grant', true));
    const { service, prisma, lifecycle } = buildService(
      {
        accountId: 3n,
        expiresAt: new Date(Date.now() - 60_000),
        refreshTokenCiphertext: Buffer.from('rt'),
        accessTokenCiphertext: Buffer.from('at'),
        account: { platform: 'youtube', metadata: null },
      },
      { youtube },
    );

    const result = (await run(service)) as { reauthFlagged: number };

    expect(prisma.account.update).toHaveBeenCalledWith({
      where: { id: 3n },
      data: { status: 'needs_reauth' },
    });
    expect(lifecycle.tokenExpired).toHaveBeenCalledTimes(1);
    expect(result.reauthFlagged).toBe(1);
  });
});

describe('TokenRefreshCronService null-expiry handling (edge 4)', () => {
  it('refreshes a refreshable account whose expiresAt is null instead of skipping it forever', async () => {
    const tiktok = jest.fn().mockResolvedValue('fresh');
    const { service } = buildService(
      {
        accountId: 4n,
        expiresAt: null as unknown as Date, // unknown expiry — must not be excluded
        refreshTokenCiphertext: Buffer.from('rt'),
        accessTokenCiphertext: Buffer.from('at'),
        account: { platform: 'tiktok', metadata: null },
      },
      { tiktok },
    );

    const result = (await run(service)) as { refreshed: number; skipped: number };

    expect(tiktok).toHaveBeenCalledTimes(1);
    expect(result.refreshed).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('scans null-expiresAt rows (they are no longer filtered out of the DB query)', async () => {
    const { service, prisma } = buildService(
      {
        accountId: 5n,
        expiresAt: new Date(Date.now() + 1000),
        refreshTokenCiphertext: Buffer.from('rt'),
        accessTokenCiphertext: Buffer.from('at'),
        account: { platform: 'tiktok', metadata: null },
      },
      { tiktok: jest.fn().mockResolvedValue('fresh') },
    );

    await run(service);

    const where = prisma.oAuthToken.findMany.mock.calls[0][0].where as {
      OR?: unknown[];
    };
    expect(where.OR).toContainEqual({ expiresAt: null });
  });
});
