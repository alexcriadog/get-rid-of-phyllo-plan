# Engagement-Refresh Webhook — Design

**Date:** 2026-06-12
**Repo:** get-rid-of-phyllo (connector / `poc`)
**Status:** Approved design, ready for implementation plan

## Problem

The connector emits content webhooks (`CONTENTS.ADDED` / `CONTENTS.UPDATED`, InsightIQ-standard) **only when a sync finds new items**. The gate is `DataEventDispatcher.fire()`:

```ts
// data-event-dispatcher.service.ts:71
if (args.itemsAdded === 0) return;
```

`itemsAdded` comes from `CanonicalWriteService.persist()` → `deltaFromBulk()`, which counts **only `upsertedCount`** (newly inserted posts). Engagement changes on *existing* posts **are written** to the canonical store (`writeContents` does `coalesceMerge(prev, fresh)` and `$set doc`), but they do **not** produce a delta, so **no webhook is emitted**.

**Consequence:** if an account publishes nothing for days, the downstream consumer (`socialmedia-backend`) never learns that likes/comments/views on existing posts changed → engagement goes stale downstream.

The connector cannot manually re-emit either: there is no on-demand "send this account's content webhook" trigger.

## Goals

1. Propagate engagement changes on **existing** posts to the consumer, scoped to a **recent window (default 90 days)**.
2. Make it **configurable per (platform, product)** — a refresh cadence ("how often at most") — reusing the existing cadence config surface.
3. **Change-gated:** only emit when something in the recent window actually changed (no empty webhooks).
4. Provide a **manual trigger** to force a refresh emit for an account on demand.
5. **Zero changes** to `socialmedia-backend` — reuse `CONTENTS.UPDATED`, which it already consumes by re-fetching.

## Non-Goals

- Full-history engagement refresh (only the recent window).
- Changing the push/webhook model to a consumer-pull model.
- Refreshing non-content snapshot products (identity/audience/ads/engagement_deep) — they already emit immediately on every sync.
- Per-post delivery guarantees beyond the existing sample-cap model (the consumer re-fetches the days it wants).

## Approach (chosen: A + change-gating)

Piggyback the **existing per-account sync loop** (which already runs on a configurable cadence and already updates engagement in the canonical store). Add a cheap change signal, a cadence-throttled refresh emit, and a manual trigger. No new scheduler, no fan-out, no backend change.

### Component 1 — Change signal (`CanonicalWriteService.writeContents`)

`writeContents` already holds `prev` (stored doc) and `fresh` (just-fetched) in memory per post. Extend the delta:

```ts
export interface PersistDelta {
  itemsAdded: number;          // unchanged: newly-inserted posts
  sampleIds: string[];         // unchanged: ids of new posts
  itemsUpdated: number;        // NEW: existing posts in-window whose engagement changed
  updatedSampleIds: string[];  // NEW: ids of those posts (cap 20)
}
```

- "Engagement changed" = a shallow compare of the engagement/metrics fields of `fresh.engagement` vs `prev.engagement` (like/comment/view/share/save counts). Helper `engagementChanged(prev, fresh): boolean`.
- "In-window" = `item.publishedAt >= now - refreshWindowDays`.
- Cost: no extra fetch or DB read; both docs are already in memory in the existing loop.
- `deltaFromBulk` and the snapshot/zero deltas are updated to include the two new fields (default `0` / `[]`). `writeComments` returns `itemsUpdated: 0` (engagement refresh is content-only for now).

### Component 2 — Emit decision (`DataEventDispatcher.fire`)

`sync.worker.ts:389` passes the extended delta. New logic:

```
if (itemsAdded > 0)            → emit as today (CONTENTS.ADDED/UPDATED via marker)
else if (itemsUpdated > 0
         && refreshCadenceElapsed(account, product))
                               → REFRESH emit: standardWebhooks.fireData({ accountId, product, sampleIds: updatedSampleIds })
                                 (marker already past-first ⇒ resolves to CONTENTS.UPDATED)
                                 + native data.<product>.updated with reason:"refresh", window_start/end
else                          → return (nothing to report)
```

- Reuses `StandardWebhookEmitter.fireData`, whose `resolveAddedUpdated` marker (`webhook_emit_state`) makes the refresh resolve to `CONTENTS.UPDATED` automatically (content was already emitted at least once).
- Native payload gains `reason: "refresh"` and `window_start`/`window_end` for observability; the standard (InsightIQ) thin webhook is unchanged in shape (the consumer re-fetches).
- `itemsAdded > 0` path is untouched (no behavior change for new content).

### Component 3 — Config (the per-platform knob)

Reuse the existing cadence surface (`admin updateCadence(platform, product, interval_seconds)` / `webhookCadence`). Add two operator-settable values, defaulting sanely:

- `refreshIntervalSeconds` per `(platform, product)` — **minimum spacing between refresh emits** for the same `(account, product)`. Default e.g. 21600 (6h). This is the user's "número de veces por plataforma".
- `refreshWindowDays` per `(platform, product)` — recent window for change-detection + sample. Default 90.

Stored alongside the existing platform/product cadence config (extend the same Prisma model / admin endpoint; exact column names decided in the plan). Read through a 60s-memoized loader mirroring `loadWorkspaceCadence`.

### Component 4 — Throttle state (Redis)

Mirror the existing `SET NX EX` throttle pattern:

```
key   = refresh_emit:{accountId}:{product}
SET key "1" EX refreshIntervalSeconds NX
```

- `OK` ⇒ cadence elapsed ⇒ proceed and the key now blocks the next refresh until TTL.
- not-`OK` ⇒ skip (too soon).
- `DataEventDispatcher` needs Redis access (inject the existing ioredis client, as other services do).

### Component 5 — Manual trigger

- `POST /v1/accounts/:accountId/refresh` — workspace-scoped (`BearerApiKeyGuard`), body optional `{ product?: string, windowDays?: number }`.
- Admin variant `POST /admin/accounts/:accountId/refresh` for ops (admin guard).
- Behavior: **bypasses the Redis throttle** (manual = force). Enumerates recent content ids (in-window) from the `contents` canonical collection, then calls the same refresh emit path (`fireData` + native). Returns `{ delivery_ids: string[] }` (or `{ queued: true }` for digest workspaces).
- Lives in a small `RefreshController` + `EngagementRefreshService` so the emit logic is shared with `DataEventDispatcher` (single source of truth for "build + emit a refresh").

### Data flow

```
scheduler → sync.worker.runJob(account, product)
  → fetch platform data
  → CanonicalWriteService.persist() → PersistDelta {itemsAdded, sampleIds, itemsUpdated, updatedSampleIds}
  → DataEventDispatcher.fire(delta)
       new content?           → CONTENTS.ADDED/UPDATED (today's path)
       only engagement change + cadence elapsed → CONTENTS.UPDATED (refresh)
  → StandardWebhookEmitter → outbound delivery → socialmedia-backend re-fetches recent window

manual: POST /v1/accounts/:id/refresh → EngagementRefreshService.emit(account, product, window) → same outbound path
```

## Error handling

- Change-compare and emit are **best-effort** and must never break a sync: wrap in try/catch, log, continue (matches existing `fire()` / canonical-write behavior).
- Redis throttle failure ⇒ fail-open is unacceptable (would spam) → on Redis error, **skip** the refresh emit (fail-closed) and log.
- Manual trigger validates account belongs to the caller's workspace (reuse `phylloAccountValidation`-style check / workspace guard); 404 if not found, 400 on bad `product`.

## Testing (transpile-only / `tsc --noEmit`, per project norms — `npm test` is heavy)

1. `engagementChanged()` unit: returns true/false on metric diffs, ignores non-engagement fields, handles null/partial prev.
2. `writeContents` delta unit: new post ⇒ itemsAdded; existing post w/ changed metrics in-window ⇒ itemsUpdated; out-of-window change ⇒ ignored; unchanged ⇒ neither.
3. `DataEventDispatcher.fire` unit (mock redis + emitters): itemsAdded>0 ⇒ added path only; itemsAdded=0 & itemsUpdated>0 & cadence elapsed ⇒ refresh emit; cadence not elapsed ⇒ no emit; both zero ⇒ no emit.
4. Throttle unit: SET NX returns OK once within TTL.
5. Manual trigger e2e-lite: enumerates in-window ids, calls emit, bypasses throttle, returns delivery ids; rejects cross-workspace account.

## Rollout

- Default `refreshIntervalSeconds` conservative (6h) and `refreshWindowDays` 90; operators tune per platform.
- Ship dark-ish: refresh only fires for products/platforms with config present, else falls back to the default; the `itemsAdded>0` path is unchanged so new-content webhooks are unaffected.
- Observability: `reason:"refresh"` on native payload + a log line per refresh emit; deliveries visible in the existing webhook-deliveries view.

## Files touched (anticipated)

- `poc/src/modules/sync/canonical-write.service.ts` — extend `PersistDelta`, `writeContents`, `deltaFromBulk`, add `engagementChanged`.
- `poc/src/modules/sync/sync.worker.ts` — pass new delta fields to `fire()`.
- `poc/src/modules/outbound-webhooks/data-event-dispatcher.service.ts` — refresh branch + Redis throttle + cadence read.
- `poc/src/modules/outbound-webhooks/engagement-refresh.service.ts` — NEW shared emit builder + manual path.
- `poc/src/modules/outbound-webhooks/refresh.controller.ts` (or under accounts) — NEW manual endpoint.
- Config/admin: extend the cadence config model + admin endpoint for `refreshIntervalSeconds` / `refreshWindowDays`.
- Tests alongside each.
