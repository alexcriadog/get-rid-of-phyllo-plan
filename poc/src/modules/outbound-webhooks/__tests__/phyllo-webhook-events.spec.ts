import {
  PRODUCT_EVENT_MAP,
  LIFECYCLE_EVENT_MAP,
  ALL_PHYLLO_EVENTS,
  chunk,
} from '../phyllo-webhook-events';

describe('Phyllo webhook event mapping', () => {
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
  });

  test('ALL_PHYLLO_EVENTS is the deduped union and matches Phyllo names', () => {
    expect(ALL_PHYLLO_EVENTS).toEqual(expect.arrayContaining([
      'PROFILES.ADDED', 'PROFILES.UPDATED',
      'PROFILES_AUDIENCE.ADDED', 'PROFILES_AUDIENCE.UPDATED',
      'CONTENTS.ADDED', 'CONTENTS.UPDATED',
      'CONTENTS_COMMENTS.ADDED', 'CONTENTS_COMMENTS.UPDATED',
      'ACCOUNTS.CONNECTED', 'ACCOUNTS.DISCONNECTED', 'SESSION.EXPIRED',
    ]));
    expect(new Set(ALL_PHYLLO_EVENTS).size).toBe(ALL_PHYLLO_EVENTS.length);
  });

  test('chunk caps at size', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
    const chunks = chunk(ids, 100);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(100);
    expect(chunks[2]).toHaveLength(50);
  });
});
