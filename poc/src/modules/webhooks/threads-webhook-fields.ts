// Threads webhook field <-> product mapping + envelope parsing.
//
// Threads webhooks ride the same Meta App Dashboard product as FB/IG (same
// hub.challenge GET verify, same X-Hub-Signature-256 HMAC), but the POST
// envelope is FLAT — NOT the FB/IG `{object, entry[].changes[]}` shape:
//
//   {
//     "app_id": "123456",
//     "topic": "moderate" | "interaction",
//     "target_id": "<threads user id>",        // = account.canonicalUserId
//     "time": 1723226877,
//     "subscription_id": "234567",
//     "values": { "value": { "id": "<post/reply id>", ... }, "field": "replies" }
//   }
//
// Docs: developers.facebook.com/docs/threads/webhooks
// See docs/WEBHOOKS-PLATFORM-STUDY.md for the full capability analysis.

/**
 * Map Threads webhook fields to internal product identifiers. All current
 * fields are content-lifecycle signals, so they all route to engagement_new:
 *   - publish:  the user published a new post/reply  → fetch it
 *   - replies:  someone replied to the user          → engagement changed
 *   - mentions: the user was @-mentioned             → engagement changed
 *   - delete:   the user deleted a post              → re-sync to drop it
 * Quotes/reposts and insights have NO webhook — polling covers those.
 */
export const THREADS_FIELD_TO_PRODUCT: Readonly<Record<string, string>> = {
  publish: 'engagement_new',
  replies: 'engagement_new',
  mentions: 'engagement_new',
  delete: 'engagement_new',
};

export interface ThreadsWebhookEnvelope {
  /** Threads user the event is about — matches account.canonicalUserId. */
  targetId: string;
  /** Which subscribed field fired: publish | replies | mentions | delete. */
  field: string;
  /** Coarse grouping Meta sends: moderate | interaction. */
  topic: string | null;
  /** Event unix timestamp (seconds); 0 when absent. */
  time: number;
  /** The specific post/reply/mention object id, when present. */
  objectId: string | null;
}

/**
 * Best-effort parse of a Threads webhook POST body. Returns null when the
 * payload cannot identify a user + field (nothing actionable to route).
 */
export function parseThreadsEnvelope(
  rawBody: string,
): ThreadsWebhookEnvelope | null {
  let envelope: {
    topic?: unknown;
    target_id?: unknown;
    time?: unknown;
    values?: { value?: { id?: unknown }; field?: unknown };
  };
  try {
    envelope = JSON.parse(rawBody) as typeof envelope;
  } catch {
    return null;
  }

  const targetIdRaw = envelope.target_id;
  const targetId =
    typeof targetIdRaw === 'string'
      ? targetIdRaw
      : typeof targetIdRaw === 'number'
        ? String(targetIdRaw)
        : null;
  const field =
    typeof envelope.values?.field === 'string' ? envelope.values.field : null;

  if (!targetId || !field) return null;

  const objectIdRaw = envelope.values?.value?.id;
  return {
    targetId,
    field,
    topic: typeof envelope.topic === 'string' ? envelope.topic : null,
    time: typeof envelope.time === 'number' ? envelope.time : 0,
    objectId:
      typeof objectIdRaw === 'string'
        ? objectIdRaw
        : typeof objectIdRaw === 'number'
          ? String(objectIdRaw)
          : null,
  };
}
