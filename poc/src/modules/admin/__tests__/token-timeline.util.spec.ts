import {
  buildTokenTimeline,
  TIMELINE_DELIVERY_EVENTS,
} from '../token-timeline.util';

const ACCOUNTS = new Map([
  ['5', { platform: 'tiktok', handle: '@brand' }],
  ['9', { platform: 'threads', handle: '@other' }],
]);

const T0 = new Date('2026-07-10T10:00:00.000Z');
const T1 = new Date('2026-07-10T11:00:00.000Z');
const T2 = new Date('2026-07-10T12:00:00.000Z');

describe('buildTokenTimeline', () => {
  it('merges history + deliveries, newest first, decorated with account info', () => {
    const events = buildTokenTimeline(
      [
        {
          accountId: 5n,
          platform: 'tiktok',
          source: 'refresh',
          capturedAt: T1,
          expiresAt: new Date('2026-07-11T11:00:00.000Z'),
        },
        { accountId: 9n, platform: 'threads', source: 'connect', capturedAt: T0, expiresAt: null },
      ],
      [
        {
          event: 'token.expired',
          payload: { account_id: '5', reason: 'revoked' },
          createdAt: T2,
        },
      ],
      ACCOUNTS,
    );

    expect(events.map((e) => e.kind)).toEqual(['token.expired', 'refresh', 'connect']);
    expect(events[0]).toMatchObject({
      account_id: '5',
      platform: 'tiktok',
      handle: '@brand',
      detail: 'revoked',
    });
    expect(events[1]).toMatchObject({
      account_id: '5',
      expires_at: '2026-07-11T11:00:00.000Z',
    });
  });

  it('dedupes the same delivery fanned out to multiple endpoints', () => {
    const dup = {
      event: 'token.recovered',
      payload: { account_id: '5' },
      createdAt: T1,
    };
    const events = buildTokenTimeline([], [dup, { ...dup }], ACCOUNTS);
    expect(events).toHaveLength(1);
  });

  it('filters by account and honours the limit', () => {
    const events = buildTokenTimeline(
      [
        { accountId: 5n, platform: 'tiktok', source: 'refresh', capturedAt: T1, expiresAt: null },
        { accountId: 9n, platform: 'threads', source: 'refresh', capturedAt: T0, expiresAt: null },
      ],
      [],
      ACCOUNTS,
      { accountId: '5' },
    );
    expect(events).toHaveLength(1);
    expect(events[0].account_id).toBe('5');

    const capped = buildTokenTimeline(
      [
        { accountId: 5n, platform: 'tiktok', source: 'refresh', capturedAt: T1, expiresAt: null },
        { accountId: 5n, platform: 'tiktok', source: 'refresh', capturedAt: T0, expiresAt: null },
      ],
      [],
      ACCOUNTS,
      { limit: 1 },
    );
    expect(capped).toHaveLength(1);
    expect(capped[0].at).toBe(T1.toISOString());
  });

  it('reads account_id from nested thin payloads too', () => {
    const events = buildTokenTimeline(
      [],
      [{ event: 'token.expired', payload: { data: { account_id: '9' } }, createdAt: T0 }],
      ACCOUNTS,
    );
    expect(events[0].account_id).toBe('9');
    expect(events[0].handle).toBe('@other');
  });

  it('exports the delivery-event allow-list used by the query', () => {
    expect(TIMELINE_DELIVERY_EVENTS).toEqual(
      expect.arrayContaining(['token.expired', 'token.recovered', 'token.refresh_failed']),
    );
    expect(TIMELINE_DELIVERY_EVENTS).not.toContain('account.refreshed'); // history covers it
  });
});
