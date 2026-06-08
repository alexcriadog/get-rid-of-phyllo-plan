// Mapping from our internal data/lifecycle events to Phyllo (InsightIQ)
// webhook event names + payload kind. See PLAN-phyllo-schema-alignment.md §5.

export type PhylloPayloadKind = "account" | "profile" | "items";

export interface PhylloEventSpec {
  /** Phyllo event name, e.g. "CONTENTS.ADDED". */
  added: string;
  /** UPDATED variant, when the event distinguishes first vs subsequent. */
  updated?: string;
  /** Human "name" field Phyllo includes on the envelope. */
  nameAdded: string;
  nameUpdated?: string;
  kind: PhylloPayloadKind;
}

/** Internal product → Phyllo content/profile event spec. */
export const PRODUCT_EVENT_MAP: Record<string, PhylloEventSpec> = {
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
export const LIFECYCLE_EVENT_MAP: Record<string, PhylloEventSpec> = {
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
  "token.refresh_failed": {
    added: "SESSION.EXPIRED",
    nameAdded: "session expired",
    kind: "account",
  },
};

/** Every Phyllo event name we can emit — used to subscription-filter endpoints. */
export const ALL_PHYLLO_EVENTS: ReadonlyArray<string> = [
  ...new Set(
    [
      ...Object.values(PRODUCT_EVENT_MAP),
      ...Object.values(LIFECYCLE_EVENT_MAP),
    ].flatMap((s) => (s.updated ? [s.added, s.updated] : [s.added])),
  ),
];

/** Chunk an array into pieces of at most `size` (Phyllo caps items at 100). */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
