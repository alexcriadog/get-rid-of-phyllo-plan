// Guard for best-effort catch blocks inside platform fetchers.
//
// Best-effort try/catch exists so SOFT errors (missing scope 403, comments
// disabled, deprecated metric, …) degrade a sync to a partial result instead
// of failing it. But two error classes are CONTROL-FLOW signals the sync
// worker must see, and swallowing them corrupts stored data:
//
//   - RateLimitedError: thrown by the shared clients' rate-bucket `acquire`
//     BEFORE any HTTP call (or mapped from an upstream 429). If a fetcher
//     swallows it across every sub-call, it returns an EMPTY canonical
//     object and the worker's destructive upsert wipes a good Mongo
//     snapshot with blanks. Observed in prod 2026-06-05 (LinkedIn audience
//     + posts blanked after the daily bucket drained). Rethrowing lets the
//     worker back off (no failureCount bump) and keep the stored snapshot.
//
//   - TokenRevokedError: the account needs re-auth; the worker must flip
//     account.status instead of persisting a degraded snapshot.
//
// Usage — FIRST line of every best-effort catch:
//
//   } catch (err) {
//     rethrowCritical(err);
//     this.logger.warn(`… soft-degrade …`);
//     return fallback;
//   }

import { RateLimitedError, TokenRevokedError } from './platform-adapter.port';

/** Rethrow control-flow errors; let soft errors fall through to degrade. */
export function rethrowCritical(err: unknown): void {
  if (err instanceof RateLimitedError || err instanceof TokenRevokedError) {
    throw err;
  }
}
