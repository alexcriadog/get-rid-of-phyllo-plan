import { describe, expect, it } from 'vitest';
import {
  mergeActivity,
  ACTIVITY_CAP,
  type ApiCallRaw,
  type EventRaw,
  type WebhookInRaw,
  type DeliveryRaw,
} from '../activity-merge';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const call200: ApiCallRaw = {
  called_at: '2024-06-11T10:00:00.000Z',
  platform: 'instagram',
  endpoint: '/v14.0/me/media',
  status_code: 200,
  duration_ms: 142,
  account_id: 'acc-1',
};

const call404: ApiCallRaw = {
  called_at: '2024-06-11T10:01:00.000Z',
  platform: 'facebook',
  endpoint: '/v14.0/missing',
  status_code: 404,
  duration_ms: 58,
};

const call500: ApiCallRaw = {
  called_at: '2024-06-11T10:02:00.000Z',
  platform: 'tiktok',
  endpoint: '/v2/video/list',
  status_code: 500,
  duration_ms: 1200,
};

const callPending: ApiCallRaw = {
  called_at: '2024-06-11T10:03:00.000Z',
  platform: 'linkedin',
  endpoint: '/v2/ugcPosts',
  // no status_code → queued tone
};

const event1: EventRaw = {
  id: 'evt-1',
  event_type: 'content.added',
  account_id: 'acc-1',
  emitted_at: '2024-06-11T09:58:00.000Z',
};

const eventReauth: EventRaw = {
  id: 'evt-2',
  event_type: 'account.needs_reauth',
  account_id: 'acc-2',
  emitted_at: '2024-06-11T09:59:00.000Z',
};

const webhookIn: WebhookInRaw = {
  id: 'wh-1',
  platform: 'instagram',
  topic: 'feed',
  received_at: '2024-06-11T09:57:00.000Z',
  status: 'enqueued',
  account_id: 'acc-1',
};

const webhookBadSig: WebhookInRaw = {
  id: 'wh-2',
  platform: 'facebook',
  received_at: '2024-06-11T09:56:00.000Z',
  status: 'invalid_signature',
};

const webhookSkipped: WebhookInRaw = {
  id: 'wh-3',
  platform: 'instagram',
  received_at: '2024-06-11T09:55:00.000Z',
  status: 'skipped',
};

const deliveryOk: DeliveryRaw = {
  id: 'del-1',
  endpoint_url: 'https://example.com/hook',
  workspace_slug: 'acme',
  event: 'account.connected',
  status: 'delivered',
  attempts: 1,
  last_response_code: 200,
  last_error: null,
  created_at: '2024-06-11T09:54:00.000Z',
  delivered_at: '2024-06-11T09:54:01.000Z',
};

const deliveryFailed: DeliveryRaw = {
  id: 'del-2',
  endpoint_url: 'https://bad.example.com/hook',
  workspace_slug: 'acme',
  event: 'content.added',
  status: 'failed',
  attempts: 3,
  last_response_code: 503,
  last_error: 'connection refused',
  created_at: '2024-06-11T09:53:00.000Z',
  delivered_at: null,
};

const deliveryAbandoned: DeliveryRaw = {
  id: 'del-3',
  endpoint_url: 'https://dead.example.com/hook',
  workspace_slug: 'acme',
  event: 'account.disconnected',
  status: 'abandoned',
  attempts: 5,
  last_response_code: null,
  last_error: 'max retries exceeded',
  created_at: '2024-06-11T09:52:00.000Z',
  delivered_at: null,
};

const deliveryPending: DeliveryRaw = {
  id: 'del-4',
  endpoint_url: 'https://new.example.com/hook',
  workspace_slug: 'acme',
  event: 'account.connected',
  status: 'pending',
  attempts: 0,
  last_response_code: null,
  last_error: null,
  created_at: '2024-06-11T09:51:00.000Z',
  delivered_at: null,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('mergeActivity — ordering', () => {
  it('returns items in descending timestamp order across all four sources', () => {
    const result = mergeActivity(
      [call200, call404, call500, callPending],
      [event1, eventReauth],
      [webhookIn, webhookBadSig, webhookSkipped],
      [deliveryOk, deliveryFailed, deliveryAbandoned, deliveryPending],
    );

    for (let i = 0; i < result.length - 1; i++) {
      const a = Date.parse(result[i].ts);
      const b = Date.parse(result[i + 1].ts);
      expect(a).toBeGreaterThanOrEqual(b);
    }
  });

  it('the most-recent item (callPending 10:03) is first', () => {
    const result = mergeActivity(
      [call200, call404, call500, callPending],
      [event1, eventReauth],
      [webhookIn, webhookBadSig, webhookSkipped],
      [deliveryOk, deliveryFailed, deliveryAbandoned, deliveryPending],
    );
    expect(result[0].ts).toBe('2024-06-11T10:03:00.000Z');
    expect(result[0].kind).toBe('call');
  });
});

describe('mergeActivity — call normalisation', () => {
  it('maps 200 status_code to ok tone', () => {
    const [item] = mergeActivity([call200], [], [], []);
    expect(item.kind).toBe('call');
    expect(item.status.tone).toBe('ok');
    expect(item.status.text).toContain('200');
    expect(item.platform).toBe('instagram');
  });

  it('maps 404 to warn tone', () => {
    const [item] = mergeActivity([call404], [], [], []);
    expect(item.status.tone).toBe('warn');
    expect(item.status.text).toContain('404');
  });

  it('maps 500 to danger tone', () => {
    const [item] = mergeActivity([call500], [], [], []);
    expect(item.status.tone).toBe('danger');
  });

  it('maps missing status_code to queued tone', () => {
    const [item] = mergeActivity([callPending], [], [], []);
    expect(item.status.tone).toBe('queued');
  });

  it('includes duration in status text when present', () => {
    const [item] = mergeActivity([call200], [], [], []);
    expect(item.status.text).toContain('142ms');
  });

  it('uses endpoint as summary', () => {
    const [item] = mergeActivity([call200], [], [], []);
    expect(item.summary).toBe('/v14.0/me/media');
  });

  it('preserves the original object as raw', () => {
    const [item] = mergeActivity([call200], [], [], []);
    expect(item.raw).toBe(call200);
  });
});

describe('mergeActivity — event normalisation', () => {
  it('maps content.added to ok tone', () => {
    const [item] = mergeActivity([], [event1], [], []);
    expect(item.kind).toBe('event');
    expect(item.status.tone).toBe('ok');
  });

  it('maps account.needs_reauth to danger tone', () => {
    const [item] = mergeActivity([], [eventReauth], [], []);
    expect(item.status.tone).toBe('danger');
  });

  it('includes account_id in summary', () => {
    const [item] = mergeActivity([], [event1], [], []);
    expect(item.summary).toContain('#acc-1');
  });

  it('preserves raw event', () => {
    const [item] = mergeActivity([], [event1], [], []);
    expect(item.raw).toBe(event1);
  });
});

describe('mergeActivity — webhook_in normalisation', () => {
  it('maps enqueued to ok tone', () => {
    const [item] = mergeActivity([], [], [webhookIn], []);
    expect(item.kind).toBe('webhook_in');
    expect(item.status.tone).toBe('ok');
    expect(item.platform).toBe('instagram');
  });

  it('maps invalid_signature to danger tone', () => {
    const [item] = mergeActivity([], [], [webhookBadSig], []);
    expect(item.status.tone).toBe('danger');
  });

  it('maps skipped to queued tone', () => {
    const [item] = mergeActivity([], [], [webhookSkipped], []);
    expect(item.status.tone).toBe('queued');
  });

  it('includes topic in summary', () => {
    const [item] = mergeActivity([], [], [webhookIn], []);
    expect(item.summary).toContain('feed');
  });
});

describe('mergeActivity — delivery normalisation', () => {
  it('maps delivered to ok tone with response code in text', () => {
    const [item] = mergeActivity([], [], [], [deliveryOk]);
    expect(item.kind).toBe('delivery');
    expect(item.status.tone).toBe('ok');
    expect(item.status.text).toContain('200');
  });

  it('maps failed to warn tone', () => {
    const [item] = mergeActivity([], [], [], [deliveryFailed]);
    expect(item.status.tone).toBe('warn');
    expect(item.status.text).toContain('503');
  });

  it('maps abandoned to danger tone', () => {
    const [item] = mergeActivity([], [], [], [deliveryAbandoned]);
    expect(item.status.tone).toBe('danger');
  });

  it('maps pending to queued tone', () => {
    const [item] = mergeActivity([], [], [], [deliveryPending]);
    expect(item.status.tone).toBe('queued');
  });

  it('summary includes event name and url', () => {
    const [item] = mergeActivity([], [], [], [deliveryOk]);
    expect(item.summary).toContain('account.connected');
    expect(item.summary).toContain('https://example.com/hook');
  });

  it('surfaces platform and account handle when resolved server-side', () => {
    const delivery: DeliveryRaw = {
      ...deliveryOk,
      event: 'PROFILES.UPDATED',
      platform: 'threads',
      account: 'camaleonicanalytics',
      account_id: '5c4fcefe-82b1-5f0d-9ba4-04665267f756',
    };
    const [item] = mergeActivity([], [], [], [delivery]);
    expect(item.platform).toBe('threads');
    expect(item.summary).toContain('PROFILES.UPDATED');
    expect(item.summary).toContain('camaleonicanalytics');
  });

  it('falls back to a short account_id when no handle is resolved', () => {
    const delivery: DeliveryRaw = {
      ...deliveryOk,
      platform: 'tiktok',
      account: null,
      account_id: '5c4fcefe-82b1-5f0d-9ba4-04665267f756',
    };
    const [item] = mergeActivity([], [], [], [delivery]);
    expect(item.platform).toBe('tiktok');
    expect(item.summary).toContain('#5c4fcefe');
  });

  it('leaves platform undefined and summary plain when nothing resolves', () => {
    const [item] = mergeActivity([], [], [], [deliveryOk]);
    expect(item.platform).toBeUndefined();
    expect(item.summary).toBe('account.connected → https://example.com/hook');
  });
});

describe('mergeActivity — cap', () => {
  it(`caps the output at ACTIVITY_CAP (${ACTIVITY_CAP}) items`, () => {
    const manyCalls: ApiCallRaw[] = Array.from({ length: ACTIVITY_CAP + 50 }, (_, i) => ({
      called_at: new Date(Date.now() - i * 1000).toISOString(),
      platform: 'instagram',
      endpoint: `/ep/${i}`,
      status_code: 200,
    }));
    const result = mergeActivity(manyCalls, [], [], []);
    expect(result.length).toBe(ACTIVITY_CAP);
  });

  it('keeps the most-recent items when capping', () => {
    const manyCalls: ApiCallRaw[] = Array.from({ length: ACTIVITY_CAP + 10 }, (_, i) => ({
      called_at: new Date(1_700_000_000_000 + i * 1000).toISOString(),
      platform: 'instagram',
      endpoint: `/ep/${i}`,
      status_code: 200,
    }));
    const result = mergeActivity(manyCalls, [], [], []);
    // Most recent are those with highest index (latest ts)
    expect(result[0].summary).toBe(`/ep/${ACTIVITY_CAP + 10 - 1}`);
  });
});

describe('mergeActivity — empty sources', () => {
  it('returns empty array when all sources are empty', () => {
    expect(mergeActivity([], [], [], [])).toEqual([]);
  });

  it('handles mixed empty/non-empty sources', () => {
    const result = mergeActivity([call200], [], [], []);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('call');
  });
});
