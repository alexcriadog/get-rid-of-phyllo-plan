# TODO

**Status:** Living doc
**Last updated:** 2026-05-04

What is left to do, ordered by impact and urgency. Each item has a "trigger" — the signal that tells you it's time to start. Don't pick items off this list speculatively; pick them when their trigger fires.

---

## A. Rate-limit mirror — Phase 4 (concurrency hardening)

**Trigger:** any of: (a) connected Meta accounts cross ~200, (b) a single account routinely sees >50 concurrent calls (e.g. heavy backfill), (c) we observe `acquire_total{result="denied_by_buc"}` consistently >0 with `callCountPct < 75` (signals state staleness during burst).

Phases 1-3 left a small set of concurrency edges unresolved; they are fine at current scale (~5 accounts) but will start showing under load.

- **Atomic acquire** — today `BucTelemetryService.checkGate` does N sequential `HGETALL` reads. Replace with a single Lua script that reads, evaluates, and bumps `inflight` atomically. Eliminates the read-decide-write race when many workers consult the same bucket simultaneously.
- **In-flight tracking** — currently a call passes the gate at 70%, fires the HTTP request, and only updates the bucket when the response arrives. Between those two events, dozens of other callers also see 70% and fire. Add an `inflight` counter to each bucket and treat each in-flight call as ~1% of additional load when computing the effective threshold. Decrement on response.
- **Hash-based time bucketing in scheduler** — today `cadence.service.ts` applies ±10% jitter to scheduled `nextRunAt`. With 1000 accounts on the same cron tier, that still bunches up roughly every 8h. Hash `account_id` into N time slots within the cadence window so the load is spread evenly across the period.
- **Priority lanes in BullMQ** — manual refresh (HIGH) should never be denied by local throttle even when scheduled (NORMAL) jobs are. Today both go through the same gate. Use BullMQ priorities to let HIGH skip the local 75% threshold (Meta's own backoff still protects us) and let LOW jobs (backfill, overnight) self-pause at 60%.

## B. Admin observability surface

**Trigger:** the moment an operator looks at `GET /admin/rate-limits` and asks "what was this 6h ago?".

Today the endpoint returns a snapshot. We have no historical view, no alerting, no per-account drill-down.

- **Time-series for app-level + top-N assets** — write the snapshot to a Mongo time-series collection on a 1-min tick; expose a `/admin/rate-limits/history?since=...` endpoint that returns sparkline-ready data.
- **Per-account view in `/admin/accounts/{id}`** — show the asset bucket(s) for that account, last seen at, current pct, recent denies.
- **Alerts** — `meta_buc_pct >= 60` for >1h on any single asset, `app_usage_pct >= 50`. Fire-and-forget for now (log + log query); wire to PagerDuty when there is one to wire.
- **Replay endpoint guard** — `POST /admin/rate-limits/replay` is currently unauthenticated within the admin namespace. Confirm the existing admin auth middleware covers it before exposing publicly.

## C. Token lifecycle hygiene

**Trigger:** approach of any token's `data_access_expires_at` (currently 2026-07-26 for the 4 Meta accounts).

- **`data_access_expires_at` monitor** — Meta's app-level `data_access_expires_at` (visible via `/debug_token`) caps how long even a long-lived Page token works. After it passes, the operator must re-authenticate. Schedule a daily check (`scripts/audit-tokens.ts` style) that flags accounts within 14 days of expiry and emits an admin alert.
- **Threads `data_access_expires_at`** — Threads tokens carry the same field; the proactive refresh in `ThreadsTokenRefreshService.ensureFresh` only handles the access-token expiry, not the underlying data-access window. Add a parallel monitor.
- **Verify TikTok account 7 (@alexcriado1)** — `accounts.status='ready'` was forced via SQL on 2026-05-04 with the original token still in place (option B, conservative). Verify the next sync cycle succeeds; if it doesn't, re-OAuth via the UI (the new normalisation in `seedAccount` will handle it correctly).

## D. Scope and metric coverage

**Trigger:** product asks for a metric we don't have, or a customer flags a missing field.

- **`engagement_new` 90d coverage audit** — verify that for each connected account, the posts in `posts` collection match what the platform UI shows for the last 90d (sample 5 posts per account, compare counts/likes/views). The window change to 90d-always (2026-05-04) should make this match within ±5%.
- **IG `/me/mentions` coverage** — `threads-mentions.fetcher.ts` exists but no equivalent for IG mentions. Decide whether IG mentions are in scope (PRD has it under "phase 2") and either implement or remove the placeholder.
- **FB Page Stories navigation breakdown** — `facebook-stories.fetcher.ts` requests `navigation` only via fallback (`reach-only`); confirm we get the full breakdown when the token has it.
- **IG audience: noisy "Not enough users" debug logs on the `city` breakdown** — Meta enforces a privacy floor (~100 distinct users) on each individual demographic *bucket*. For `age` / `gender` / `country` the totals always clear it (padelwithjud at 60k followers easily hits the threshold), so those breakdowns return data. The `city` breakdown is much more granular and routinely falls below the floor when `timeframe='this_month'` early in the month. The data we end up persisting is correct (the per-breakdown error is swallowed locally), but the worker logs a `debug`-level "Not enough users" line per failing breakdown per audience run. Action: in `instagram-audience.fetcher.ts:130-136`, recognise the literal `"Not enough users"` message and downgrade it to a single info-level log per snapshot, not a debug per-breakdown entry. Cosmetic only; nothing in the data path changes.

## E. Code cleanup (low priority)

**Trigger:** a developer working in an adjacent file decides it's time.

- The `audit-tokens.mjs` and `migrate-account-2.mjs` scripts in `/tmp` were one-shot and have been deleted. If we ever need them again, the structure is described in `docs/adr/0015-token-type-normalization.md` "Files" section.

## F. Open questions

- **App-level cap mystery for FB Page tokens** — the docs say Page tokens are excluded from `200 × DAU/h` but our audit (2026-05-04) confirmed `/{page_id}/insights` and `/{page_id}/stories` calls *do* return `X-App-Usage` even with a Page token. We're treating this empirically (the BUC mirror handles it correctly because it follows the headers, not the docs), but it would be worth filing a Meta developer ticket to confirm whether this is documented behaviour or a bug.
- **Webhooks coverage** — for IG and FB, what events are we subscribed to today via `WebhooksIngestController`? Each webhook avoids one or more `engagement_new` cycles. Audit and gap-fill — likely a 2-3 day project that would meaningfully reduce the `engagement_new` poll load.
- **Batch requests** — Meta supports `POST /?batch=[...]` with up to 50 ops in a single HTTP request. Discussed and deferred; only worthwhile after we hit a latency wall, not a quota wall.
