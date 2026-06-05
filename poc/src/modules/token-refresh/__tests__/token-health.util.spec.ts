import {
  classifyDataAccess,
  parseDebugTokenDataAccessExpiry,
  DATA_ACCESS_WARN_DAYS,
} from '../token-health.util';

const DAY_MS = 24 * 60 * 60_000;
const NOW = Date.UTC(2026, 5, 5); // 2026-06-05T00:00:00Z

describe('classifyDataAccess', () => {
  it('returns unknown when the platform never reported the field', () => {
    expect(classifyDataAccess(null, NOW)).toEqual({
      status: 'unknown',
      daysLeft: null,
    });
  });

  it('returns expired (daysLeft 0) when the window already closed', () => {
    expect(classifyDataAccess(NOW - 1, NOW)).toEqual({
      status: 'expired',
      daysLeft: 0,
    });
    expect(classifyDataAccess(NOW, NOW)).toEqual({
      status: 'expired',
      daysLeft: 0,
    });
  });

  it('returns expiring inside the warn window', () => {
    const justInside = NOW + DATA_ACCESS_WARN_DAYS * DAY_MS - 1;
    expect(classifyDataAccess(justInside, NOW)).toEqual({
      status: 'expiring',
      daysLeft: DATA_ACCESS_WARN_DAYS - 1,
    });
    expect(classifyDataAccess(NOW + 1, NOW)).toEqual({
      status: 'expiring',
      daysLeft: 0,
    });
  });

  it('returns ok at exactly the warn boundary and beyond', () => {
    expect(classifyDataAccess(NOW + DATA_ACCESS_WARN_DAYS * DAY_MS, NOW)).toEqual({
      status: 'ok',
      daysLeft: DATA_ACCESS_WARN_DAYS,
    });
    expect(classifyDataAccess(NOW + 90 * DAY_MS, NOW)).toEqual({
      status: 'ok',
      daysLeft: 90,
    });
  });
});

describe('parseDebugTokenDataAccessExpiry', () => {
  it('extracts the unix-seconds field and converts to ms', () => {
    const body = { data: { data_access_expires_at: 1_753_488_000 } };
    expect(parseDebugTokenDataAccessExpiry(body)).toBe(1_753_488_000_000);
  });

  it('treats 0 (field does not apply) as null', () => {
    expect(
      parseDebugTokenDataAccessExpiry({ data: { data_access_expires_at: 0 } }),
    ).toBeNull();
  });

  it('treats missing/malformed payloads as null', () => {
    expect(parseDebugTokenDataAccessExpiry(null)).toBeNull();
    expect(parseDebugTokenDataAccessExpiry('nope')).toBeNull();
    expect(parseDebugTokenDataAccessExpiry({})).toBeNull();
    expect(parseDebugTokenDataAccessExpiry({ data: {} })).toBeNull();
    expect(
      parseDebugTokenDataAccessExpiry({
        data: { data_access_expires_at: '1753488000' },
      }),
    ).toBeNull();
  });
});
