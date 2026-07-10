import {
  PRODUCT_EVENT_MAP,
  LIFECYCLE_EVENT_MAP,
  ALL_STANDARD_EVENTS,
  standardLifecycleSpec,
  chunk,
} from '../standard-webhook-events';

describe('InsightIQ webhook event mapping', () => {
  test('content products map to CONTENTS.* with items kind', () => {
    expect(PRODUCT_EVENT_MAP.engagement_new.added).toBe('CONTENTS.ADDED');
    expect(PRODUCT_EVENT_MAP.engagement_new.updated).toBe('CONTENTS.UPDATED');
    expect(PRODUCT_EVENT_MAP.engagement_new.kind).toBe('items');
    expect(PRODUCT_EVENT_MAP.stories.added).toBe('CONTENTS.ADDED');
  });

  test('identity/audience map to profile events', () => {
    expect(PRODUCT_EVENT_MAP.identity.added).toBe('PROFILES.ADDED');
    expect(PRODUCT_EVENT_MAP.audience.added).toBe('PROFILES_AUDIENCE.ADDED');
    expect(PRODUCT_EVENT_MAP.identity.kind).toBe('profile');
  });

  test('comments map to CONTENTS_COMMENTS.*', () => {
    expect(PRODUCT_EVENT_MAP.comments.added).toBe('CONTENTS_COMMENTS.ADDED');
  });

  test('lifecycle map covers connect/disconnect/session', () => {
    expect(LIFECYCLE_EVENT_MAP['account.connected'].added).toBe('ACCOUNTS.CONNECTED');
    expect(LIFECYCLE_EVENT_MAP['account.disconnected'].added).toBe('ACCOUNTS.DISCONNECTED');
    expect(LIFECYCLE_EVENT_MAP['token.expired'].added).toBe('SESSION.EXPIRED');
    expect(LIFECYCLE_EVENT_MAP['token.recovered'].added).toBe('SESSION.RECOVERED');
  });

  test('transient token.refresh_failed never maps to a thin event', () => {
    // A retryable refresh failure must not read as a dead session downstream —
    // SESSION.EXPIRED triggers a hard disconnect in consumer backends.
    expect(LIFECYCLE_EVENT_MAP['token.refresh_failed']).toBeUndefined();
  });

  test('standardLifecycleSpec gates SESSION.RECOVERED behind the env flag', () => {
    expect(standardLifecycleSpec('token.recovered', {})).toBeNull();
    expect(
      standardLifecycleSpec('token.recovered', {
        WEBHOOK_STANDARD_SESSION_RECOVERED: 'true',
      })?.added,
    ).toBe('SESSION.RECOVERED');
    // Other lifecycle events ignore the flag.
    expect(standardLifecycleSpec('token.expired', {})?.added).toBe('SESSION.EXPIRED');
    expect(standardLifecycleSpec('unknown.event', {})).toBeNull();
  });

  test('ALL_STANDARD_EVENTS is the deduped union and matches InsightIQ names', () => {
    expect(ALL_STANDARD_EVENTS).toEqual(expect.arrayContaining([
      'PROFILES.ADDED', 'PROFILES.UPDATED',
      'PROFILES_AUDIENCE.ADDED', 'PROFILES_AUDIENCE.UPDATED',
      'CONTENTS.ADDED', 'CONTENTS.UPDATED',
      'CONTENTS_COMMENTS.ADDED', 'CONTENTS_COMMENTS.UPDATED',
      'ACCOUNTS.CONNECTED', 'ACCOUNTS.DISCONNECTED', 'SESSION.EXPIRED',
      'SESSION.RECOVERED',
    ]));
    expect(new Set(ALL_STANDARD_EVENTS).size).toBe(ALL_STANDARD_EVENTS.length);
  });

  test('chunk caps at size', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
    const chunks = chunk(ids, 100);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(100);
    expect(chunks[2]).toHaveLength(50);
  });
});
