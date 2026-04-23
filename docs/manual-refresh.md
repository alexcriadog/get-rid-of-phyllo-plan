# Manual Refresh — On-Demand Trigger

**Status:** Stable reference
**Last updated:** 2026-04-23
**Answers question:** Q4 — How does a user force an immediate data fetch?

Scheduled sync is fast enough for dashboards. But ops, support, and end-users sometimes need "**give me this account's latest data right now**" — after a creator just uploaded, after a data correction, during a demo. Manual refresh is a first-class feature with its own priority path through the queue.

---

## 1. Purpose & principles

- A manual refresh **bypasses the periodic schedule** for a specific `(account, product)` pair.
- It **respects rate limits.** It does not punch through to the platform if our bucket is empty — it waits.
- It **respects the 10-min throttle lock only partially.** Manual refresh has its own shorter anti-spam lock (60s); it is allowed to run while the polling-level throttle is held (they serve different purposes).
- It emits an explicit **completion event** (`refresh.completed`) so the UI can show "data updated" without polling.
- It is **idempotent** — firing the same refresh twice in quick succession produces one fetch.

---

## 2. Endpoint specification

```
POST /v1/accounts/:id/refresh
Authorization: Service-Token <token>     (only backend-api calls this today)
Body:
  {
    products?: ['identity' | 'audience' | 'engagement_new' | 'engagement_metrics' | 'stories' | 'live_status'],
    reason?: string                       // freeform; ends up in audit log
  }

Response:
  202 Accepted
  {
    account_id: 'acc_<id>',
    jobs: [
      { job_id: 'j_<id>', product: 'identity',      status: 'queued',  priority: 'HIGH' },
      { job_id: 'j_<id>', product: 'engagement_new', status: 'queued', priority: 'HIGH' }
    ],
    throttled: [],                        // products silently skipped due to 60s lock
    rate_limited: [                       // products delayed due to empty bucket
      { product: 'audience', resume_at: '2026-04-23T15:32:00Z' }
    ]
  }

Errors:
  401 Unauthorized            — missing/invalid service token
  404 Not Found               — account does not exist
  409 Conflict                — all requested products are throttled (too many recent refreshes)
  503 Service Unavailable     — connector in degraded mode (Redis down, DB down)
```

**Defaults:** if `products` is omitted, refreshes ALL products the adapter supports for that platform. Respects `supportMatrix()` — skips products the platform does not expose.

---

## 3. Priority queue behavior

The connector runs three BullMQ priorities:

| Priority | Source | Typical queue depth |
|---|---|---|
| `HIGH` | Manual refresh, webhook-triggered fetch | <100 under normal load |
| `NORMAL` | Scheduler periodic sync (polling) | thousands (the base load) |
| `BACKFILL` | Initial connect backfill (last 90d content) | bursty, 50-200 per new account |

BullMQ's native priority queues pull HIGH before NORMAL before BACKFILL. Within a priority, it's FIFO. A manual-refresh job sits at the front of the line.

**Starvation prevention:** if HIGH volume is so high that NORMAL is starved for >10 minutes, alert ops. That's misuse of the endpoint (e.g. backend-api firing refresh on every page load). The anti-spam lock (§4) is the primary defense.

---

## 4. Anti-spam lock (60s, separate from polling throttle)

Manual refresh has its own Redis lock, distinct from the 10-min polling throttle (`throttle:{account}:{product}`):

```
Redis key:  manual_refresh:{account_id}:{product}
SET NX EX 60

If acquired: proceed to enqueue HIGH job.
If NOT acquired: return 'throttled' for this product in the response.
                 Recent manual refresh already in flight or just completed.
```

**Why 60s:**
- Shorter than polling throttle (10 min) because a user actively clicking "refresh" expects to retry quickly.
- Long enough to prevent accidental double-submits, rage-clicks, or auto-retry loops in the UI.
- Chosen so a human waiting 5 seconds and clicking again gets a fresh fetch (the first job will have completed within 60s in almost all cases).

**Interaction with polling throttle:**
Manual refresh can fire while the polling `throttle:{account}:{product}` is held. They coexist because:
- Polling throttle protects against duplicate *automatic* work.
- Manual throttle protects against duplicate *explicit user requests*.
- A user explicitly asking for fresh data deserves to punch through the polling cool-down.

The worker sets/respects the polling throttle when enqueued by scheduler or webhook — not by manual refresh.

---

## 5. Interaction with scheduler and webhook

A manual refresh **reschedules** the next automatic run:

```
Manual refresh completes successfully for (account, product):
    UPDATE sync_jobs
    SET last_success_at = NOW(),
        next_run_at     = NOW() + effective_cadence(account, product)
    WHERE account_id = ... AND product = ...
```

After a manual refresh, the scheduler does NOT immediately re-queue a polling sync. Periodic polling is postponed by one full cadence — exactly the same behavior as a webhook-triggered fetch (see [`ingestion-modes.md`](ingestion-modes.md) §7).

**Edge case — refresh while polling is in flight:**
- Polling worker has already acquired the bucket and started fetching.
- Manual refresh comes in.
- Manual refresh acquires `manual_refresh:…:{product}` (different namespace from `throttle:…:{product}`).
- Manual refresh tries to acquire the rate bucket — finds 0 tokens (polling took them).
- Manual refresh re-queues with `delay = reset_in_ms`.
- Polling finishes, emits events.
- Manual refresh retry runs, fetches again, emits events.

**Result:** two fetches, two event sets, small duplicate load. Correct but suboptimal. Optional optimization: endpoint checks `sync_jobs.status` first and returns `already_fresh: true` if polling just completed. Deferred — not critical for launch.

---

## 6. UI flow end-to-end

```
┌─────────────┐                                      ┌───────────┐
│  frontend-  │   POST /integrations/refresh        │backend-api│
│     app     │ ────────────────────────────────►   │           │
└─────────────┘  { account_id, products }           └─────┬─────┘
                                                           │
     User clicks                                           │ 1. Authorize (user owns account)
  "Refresh now" button                                    │ 2. Map to connector account_id
     in dashboard                                          │ 3. Call connector
                                                           │
                                                           ▼
                                   ┌───────────────────────────────────────┐
                                   │ POST /v1/accounts/:id/refresh         │
                                   │ connector-api                         │
                                   │ • acquire manual_refresh lock         │
                                   │ • enqueue HIGH jobs per product       │
                                   │ • return 202 with job_ids             │
                                   └──────────────┬────────────────────────┘
                                                  │
       ┌──────────────────────────────────────────┘
       │ worker picks up HIGH job
       │  • acquires bucket (may wait)
       │  • fetches from platform
       │  • upserts to connector MySQL
       │  • emits 'refresh.completed' event
       ▼
              ┌────────────────────────────────┐
              │ connector-api outbound emitter │
              └───────────────┬────────────────┘
                              │ signed HMAC webhook
                              ▼
                     ┌─────────────────┐
                     │  backend-api    │
                     │  event receiver │
                     │  • enriches     │
                     │  • upserts Mongo│
                     │  • forwards to  │
                     │    frontend via │
                     │    WebSocket/SSE│
                     └────────┬────────┘
                              │
                              ▼
                  ┌───────────────────────┐
                  │     frontend-app      │
                  │  removes spinner,     │
                  │  refreshes UI data    │
                  └───────────────────────┘
```

**UX contract:**
- Button click → spinner → stays until `refresh.completed` arrives → toast "Updated".
- Expected round-trip: <60s for identity; <5min for engagement (depends on rate-limit headroom).
- If >5min without completion, UI shows "Still refreshing — check back later" and stops spinning. Refresh continues server-side; dashboard auto-updates on next nav.

---

## 7. Events emitted

After a manual refresh completes:

```json
{
  "event_id": "evt_<ulid>",
  "event_type": "refresh.completed",
  "version": "v1",
  "emitted_at": "2026-04-23T15:45:12.345Z",
  "account_id": "acc_<id>",
  "product": "engagement_new",
  "trigger": "manual",
  "success": true,
  "changes": { "content_added": 2, "content_updated": 5 },
  "error": null
}
```

On failure:
```json
{
  "event_id": "evt_<ulid>",
  "event_type": "refresh.completed",
  "success": false,
  "error": {
    "code": "PLATFORM_RATE_LIMITED",
    "message": "Rate bucket depleted; automatic retry scheduled.",
    "retry_at": "2026-04-23T15:52:00Z"
  }
}
```

Full event catalog in [`06-event-catalog.md`](06-event-catalog.md).

---

## 8. Failure modes

| Scenario | Behavior | Remediation |
|---|---|---|
| Product throttled (60s lock held) | Response lists in `throttled[]`; no job enqueued | User clicks again 60s later; second call succeeds. |
| Rate bucket empty | Job enqueued, waits; UI keeps spinning | `refresh.completed` arrives when bucket refills + fetch succeeds. |
| Token revoked on platform | Adapter gets 401; marks `needs_reauth`; event `account.needs_reauth` emitted | User sees "Reconnect account" prompt. |
| Platform 5xx | Retry with backoff; after 3 retries, DLQ | `refresh.completed` with `success: false, error.code: PLATFORM_UNAVAILABLE`. Ops alerted. |
| Connector DB down | 503 returned immediately; no work enqueued | Infra incident response; user retries later. |
| User double-clicks inside 60s | Second call returns 202 with product in `throttled[]` | Expected. Single fetch. |
| Accidental API loop calling refresh 100× | First acquires lock; next 99 throttled | Budget-safe. Metric `manual_refresh_throttled_total` detects bad clients. |
| Refresh for paused account | Returns 409 `reason: "account paused"` | Ops un-pauses first. |

---

## 9. ADR

See [`adr/0012-manual-refresh.md`](adr/0012-manual-refresh.md). Alternatives considered:
- **Synchronous API** (rejected — fetch can take tens of seconds due to rate limits; HTTP timeout risk)
- **Dedicated high-priority queue** (rejected — BullMQ's priority-within-single-queue is simpler and sufficient)
- **Fire-and-forget with no completion event** (rejected — UX requires "Updated" confirmation)

---

## 10. Related docs

- [`ingestion-modes.md`](ingestion-modes.md) — polling throttle (10min) distinct from manual-refresh lock (60s)
- [`rate-limiting.md`](rate-limiting.md) — manual refresh respects buckets
- [`refresh-cadence.md`](refresh-cadence.md) — manual refresh resets `next_run_at`
- [`05-api-contract.md`](05-api-contract.md) — OpenAPI spec
- [`06-event-catalog.md`](06-event-catalog.md) — `refresh.completed` schema
- [`connection-portal.md`](connection-portal.md) — how frontend surfaces "Refresh now"
