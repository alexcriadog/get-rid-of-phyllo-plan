/**
 * Which products may the deploy-time sync-job backfill (prisma/seed.ts)
 * ensure for one account?
 *
 * Historically the backfill created a job for EVERY catalog product of the
 * account's platform. That silently resurrected products that had been pruned
 * — either by an admin tightening the workspace allow-list or by a narrower
 * per-connection scope on re-connect (the SDK token `products` claim). It also
 * enrolled products the stored OAuth token never consented to.
 *
 * The backfill may only ensure products that are in ALL of:
 *   1. the platform catalog (`catalogProducts`),
 *   2. the workspace allow-list for that platform (`workspaceAllowed`;
 *      undefined → platform not offered → nothing to backfill),
 *   3. the account's connection scope (`accountMetaProducts`, persisted as
 *      `account.metadata.products` at seed time) when present. Legacy accounts
 *      without one fall back to the workspace allow-list alone.
 *
 * Order follows `catalogProducts` so output is stable.
 */
export function resolveBackfillProducts(
  catalogProducts: ReadonlyArray<string>,
  workspaceAllowed: ReadonlyArray<string> | undefined,
  accountMetaProducts: ReadonlyArray<string> | undefined,
): string[] {
  if (!workspaceAllowed || workspaceAllowed.length === 0) return [];
  const ws = new Set(workspaceAllowed);
  const scope = accountMetaProducts ? new Set(accountMetaProducts) : null;
  return catalogProducts.filter(
    (p) => ws.has(p) && (scope === null || scope.has(p)),
  );
}
