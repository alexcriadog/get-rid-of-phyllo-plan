// Mapping from our internal data/lifecycle events to InsightIQ (InsightIQ)
// webhook event names + payload kind. See PLAN-canonical-data-api.md §5.

export type PayloadKind = "account" | "profile" | "items";

export interface EventSpec {
  /** InsightIQ event name, e.g. "CONTENTS.ADDED". */
  added: string;
  /** UPDATED variant, when the event distinguishes first vs subsequent. */
  updated?: string;
  /** Human "name" field InsightIQ includes on the envelope. */
  nameAdded: string;
  nameUpdated?: string;
  kind: PayloadKind;
}

/** Internal product → InsightIQ content/profile event spec. */
export const PRODUCT_EVENT_MAP: Record<string, EventSpec> = {
  identity: {
    added: "PROFILES.ADDED",
    updated: "PROFILES.UPDATED",
    nameAdded: "profile added",
    nameUpdated: "profile updated",
    kind: "profile",
  },
  audience: {
    added: "PROFILES_AUDIENCE.ADDED",
    updated: "PROFILES_AUDIENCE.UPDATED",
    nameAdded: "profile audience added",
    nameUpdated: "profile audience updated",
    kind: "profile",
  },
  engagement_new: {
    added: "CONTENTS.ADDED",
    updated: "CONTENTS.UPDATED",
    nameAdded: "contents added",
    nameUpdated: "contents updated",
    kind: "items",
  },
  stories: {
    added: "CONTENTS.ADDED",
    updated: "CONTENTS.UPDATED",
    nameAdded: "contents added",
    nameUpdated: "contents updated",
    kind: "items",
  },
  comments: {
    added: "CONTENTS_COMMENTS.ADDED",
    updated: "CONTENTS_COMMENTS.UPDATED",
    nameAdded: "contents comments added",
    nameUpdated: "contents comments updated",
    kind: "items",
  },
};

/** Lifecycle event specs. */
export const LIFECYCLE_EVENT_MAP: Record<string, EventSpec> = {
  "account.connected": {
    added: "ACCOUNTS.CONNECTED",
    nameAdded: "account is connected",
    kind: "account",
  },
  "account.disconnected": {
    added: "ACCOUNTS.DISCONNECTED",
    nameAdded: "account is disconnected",
    kind: "account",
  },
  "token.expired": {
    added: "SESSION.EXPIRED",
    nameAdded: "session expired",
    kind: "account",
  },
  // NOTE: token.refresh_failed (transient, will retry) deliberately has NO
  // thin mapping. Consumer backends treat SESSION.EXPIRED as a hard
  // disconnect, so a retryable blip must never be delivered under that name.
  "token.recovered": {
    added: "SESSION.RECOVERED",
    nameAdded: "session recovered",
    kind: "account",
  },
};

/**
 * Rollout flag for SESSION.RECOVERED: consumer webhook receivers throw on
 * unknown event names, so thin emission stays off until they handle it.
 */
export const SESSION_RECOVERED_FLAG = "WEBHOOK_STANDARD_SESSION_RECOVERED";

/** Lifecycle spec lookup honouring rollout flags; null = don't emit thin. */
export function standardLifecycleSpec(
  type: string,
  env: Record<string, string | undefined>,
): EventSpec | null {
  const spec = LIFECYCLE_EVENT_MAP[type];
  if (!spec) return null;
  if (type === "token.recovered" && env[SESSION_RECOVERED_FLAG] !== "true") {
    return null;
  }
  return spec;
}

/** Every InsightIQ event name we can emit — used to subscription-filter endpoints. */
export const ALL_STANDARD_EVENTS: ReadonlyArray<string> = [
  ...new Set(
    [
      ...Object.values(PRODUCT_EVENT_MAP),
      ...Object.values(LIFECYCLE_EVENT_MAP),
    ].flatMap((s) => (s.updated ? [s.added, s.updated] : [s.added])),
  ),
];

/** Chunk an array into pieces of at most `size` (InsightIQ caps items at 100). */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
