// Deterministic UUIDv5 id minting for the Phyllo-compatible surface (§2 of
// PLAN-phyllo-schema-alignment.md). Phyllo ids are opaque UUIDs that must be
// STABLE across syncs. We derive them from immutable internal keys so re-syncs
// and re-connects produce identical ids with zero extra storage.
//
//   ns = uuidv5(DNS, 'connector.camaleonic.internal')   // fixed namespace
//   account_id = uuidv5(ns, 'account:' + accounts.id)   // our BigInt PK
//   ...

import { v5 as uuidv5 } from "uuid";

/** Fixed project namespace. NEVER change — it would re-key every minted id. */
export const PHYLLO_ID_NAMESPACE = uuidv5(
  "connector.camaleonic.internal",
  uuidv5.DNS,
);

function mint(name: string): string {
  return uuidv5(name, PHYLLO_ID_NAMESPACE);
}

/** Stable user id from the workspace's end-user identifier. */
export function phylloUserId(endUserId: string): string {
  return mint(`user:${endUserId}`);
}

/** Stable account id from our accounts table PK (BigInt as string). */
export function phylloAccountId(accountPk: string): string {
  return mint(`account:${accountPk}`);
}

/** One profile per account → derived from the account PK. */
export function phylloProfileId(accountPk: string): string {
  return mint(`profile:${accountPk}`);
}

/** One audience doc per account. */
export function phylloAudienceId(accountPk: string): string {
  return mint(`audience:${accountPk}`);
}

/** Stable content id from (account PK, platform-native content id). */
export function phylloContentId(
  accountPk: string,
  platformContentId: string,
): string {
  return mint(`content:${accountPk}:${platformContentId}`);
}

/** Stable comment id from (account PK, platform-native comment id). */
export function phylloCommentId(
  accountPk: string,
  platformCommentId: string,
): string {
  return mint(`comment:${accountPk}:${platformCommentId}`);
}

/**
 * Synthetic end-user fallback. Some accounts carry no endUserId; we still
 * need a stable user id, so we derive one from the account PK. Keeps the
 * `user` envelope non-null like Phyllo's.
 */
export function phylloUserIdOrFallback(
  endUserId: string | null | undefined,
  accountPk: string,
): string {
  return endUserId
    ? phylloUserId(endUserId)
    : mint(`user:account:${accountPk}`);
}
