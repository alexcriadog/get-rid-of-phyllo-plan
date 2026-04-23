# ADR 0012: Manual refresh — priority in shared queue + 60s lock

**Status:** Accepted
**Date:** 2026-04-23
**Corresponds to:** D-12

## Context

Users and ops need an on-demand "fetch this account's data now" action. Must respect rate limits, be idempotent, give clear UX completion signal, and not allow abuse.

## Decision

**Dedicated endpoint `POST /v1/accounts/:id/refresh` enqueues jobs at `priority=HIGH` in the same BullMQ queue as periodic syncs.** HIGH jobs are served before NORMAL. Anti-spam lock in Redis: `manual_refresh:{account}:{product}` TTL 60s — rejects duplicate submits while allowing legitimate retry in 1 min. Rate buckets are still respected (HIGH doesn't bypass platform limits, it just jumps our internal queue).

Event `refresh.completed` emitted on completion; backend-api forwards to frontend via WebSocket/SSE.

## Alternatives considered

- **Synchronous API** (connector holds HTTP connection until fetch completes) — rejected; fetches can take tens of seconds (rate-limit backoffs), HTTP timeout risk.
- **Dedicated high-priority queue** — rejected; BullMQ's priority-within-a-queue is simpler and sufficient for our scale.
- **Fire-and-forget with no completion event** — rejected; UX requires "Updated" confirmation after the spinner.

## Consequences

**Positive:**
- Shares all rate-limit / observability infrastructure with periodic sync.
- User gets clear completion signal via events — no polling.
- 60s lock is short enough to not frustrate, long enough to prevent accidental rage-clicks.

**Negative:**
- HIGH priority can starve NORMAL if misused (e.g., if backend-api fires refresh on every page view). Anti-spam lock is the first line; alert on sustained HIGH volume is the second.
- Events for manual refresh could race with events for concurrent polling of the same account. Each is idempotent; result is redundant but safe.

**Mitigations:**
- Alert if `manual_refresh_throttled_total` rate > N/min — signal of a misbehaving client.
- Consider `sync_jobs.status` check to short-circuit if polling completed recently (deferred optimization).

## Related

- [`../manual-refresh.md`](../manual-refresh.md)
- [`../rate-limiting.md`](../rate-limiting.md) — HIGH still respects buckets
