# PoC Operational Health Report — Request Prompt

Copy the **Prompt** block below verbatim into a fresh chat with me when you want a status report on the Meta connector PoC. Audience is your technical lead first, the CEO second — keep it strategic, not deep-engineering.

---

## Prompt

> Generate an operational health report for the Meta connector PoC. Audience: technical lead and CEO. Cover the last **7 days** unless I say otherwise. Use real data from the running system — Postgres `api_call_log`, `sync_jobs`, `accounts`, `oauth_tokens`, `cadences`, and Mongo `event_log`, `audience_snapshots`, `posts`, `raw_platform_responses`. Do not speculate; if data is missing, say so explicitly.
>
> Output format: Markdown. Start with a 3-bullet **Executive Summary** (≤80 words). Then the sections below. Numbers in tables. End with **Risks & Recommendations** (max 4 items). No raw JSON dumps. English throughout.
>
> ### Sections
>
> 1. **Connected accounts** — one-line per account: id, platform, handle, status, syncTier, when added, current followers count.
>
> 2. **Meta rate-limit posture** *(highest priority)*
>    - Highest `X-App-Usage.call_count` % seen in the window, per platform — query `api_call_log.usage_header`.
>    - Highest `X-Business-Use-Case-Usage.call_count` % per Page (parse the BUC JSON keyed by Page id).
>    - Number of times our **local** rate bucket pre-emptively denied a call (Mongo `event_log` where `event_type='rate.limited' AND payload.source='local'`).
>    - Number of **Meta-side 429s** (`api_call_log.status_code = 429` OR `event_log` where `payload.source='meta'`).
>    - Headroom verdict: how far we are from the documented 200 BUC pts/h ceiling and where the next bottleneck would land at 5×/10× current scale.
>
> 3. **API call volume**
>    - Total Graph calls in the window, grouped by `platform × product × endpoint`.
>    - Top 5 most-called endpoints with call count + avg duration_ms.
>    - p50 / p95 latency by platform.
>    - Status-code mix (200 / 4xx / 429 / 5xx).
>
> 4. **Sync job health**
>    - Per `(account, product)`: `last_success_at`, `failure_count`, `last_error`, `next_run_at` vs cadence. Flag drift > 2× expected interval.
>    - Auto-paused accounts (`syncTier='paused'` or `account.status='needs_reauth'`) with the trigger.
>    - Throttle-lock contention rate.
>
> 5. **Data freshness & coverage**
>    - For each account: most-recent `audience_snapshots.updated_at`, `posts.updated_at` p50.
>    - FB Stories: are we capturing them within the 24h TTL window? Compare expected vs collected.
>    - FB Audience: country and city distributions populated for each Page (or empty because of Meta's privacy threshold for low-follower Pages).
>    - Story metric aggregation lag — call out any story still showing the `1970-01-02T00:00:00+0000` Meta sentinel after >48h.
>
> 6. **Errors & token health**
>    - Top 5 distinct error messages from `sync_jobs.last_error` and `api_call_log` non-2xx rows.
>    - Token revocations (`account.status='needs_reauth'`) with timestamp and reason.
>    - OAuth tokens within 14 days of expiry — flag for refresh.
>    - Any silent failures (`status='idle'` but `lastSuccessAt` older than 2× cadence).
>
> 7. **Compliance with Meta's documented limits**
>    - Meta documents 200 pts/h per Page on BUC, 200 pts/h app-aggregate. Compare actual peak vs ceiling.
>    - Are we respecting `Retry-After` on 429s? (Look for any tight retry loops in `event_log`.)
>    - Are we hitting deprecated metrics? (Search `api_call_log` non-200 with message "must be a valid insights metric" — count distinct metric names.)
>
> 8. **Risks & Recommendations** *(max 4 items, ranked)*
>    - What single signal would block production scale-up.
>    - Where the first bottleneck appears at 10× current account count.
>    - Any silent data quality issue (e.g. Meta's story-metric aggregation lag inflating "0 reach" reports).
>    - Anything Phyllo currently does that we don't (with the actual gap, not just "more polished").
>
> Keep section bodies tight: **3-6 bullets each**, tables where numbers matter. Reference exact data sources for each claim so the reader can audit. Cite docs at `docs/07-platforms/facebook.md`, `docs/07-platforms/instagram.md`, `docs/meta-endpoints.md`, `docs/rate-limiting.md` where relevant.

---

## Where the data comes from (so you know it's real)

This section is for me. When you ask, I'll query these:

| Source | What it tells me |
|---|---|
| Postgres `api_call_log` | Every Graph API call: `platform`, `endpoint`, `method`, `status_code`, `duration_ms`, `rate_bucket_key`, `tokens_before`, `tokens_after`, `usage_header` (JSON with `x-app-usage` / `x-business-use-case-usage` / `x-page-usage`), `account_id`, `product`, `called_at`. **All durably persisted on every call by `MetricsService.observeApiCall()`.** |
| Postgres `sync_jobs` | Cadence adherence, failure counts, last errors, next run times. |
| Postgres `accounts` + `oauth_tokens` | Token expiry, scopes granted, account lifecycle status. |
| Postgres `cadences` | Configured intervals per `(platform, product)`. |
| Mongo `event_log` | Discrete events: `profile.updated`, `audience.updated`, `content.added`, `story.added`, `account.needs_reauth`, **`rate.limited`** (added 2026-04-27 — distinguishes local-bucket denial from Meta 429). |
| Mongo `audience_snapshots` | Most-recent demographic/follower data per account. |
| Mongo `posts` | One row per platform content; `updated_at` tells me freshness. |
| Mongo `raw_platform_responses` | Every Graph response body, hashed and timestamped — backstop if I need to verify a specific call. |

## Things that are NOT durably persisted (gaps to know)

These are kept in-memory only and **reset on worker restart**. Not blockers — `api_call_log` covers most of what they'd say, but worth being aware:

- `MetricsService` counter map (`incr` calls): `acquire_total`, `sync_worker_*`, `scheduler_*` — labelled counters, in-memory only.
- `MetricsService.bucketHistory` (10-second-interval bucket-token snapshots) — last ~hour kept in memory.
- `apiCalls` ring buffer (last 1000 calls for the admin "/admin/api-calls" tail).

If we need any of these to survive restarts, we add a tiny periodic snapshot to a new table. Not done preemptively — keeping the surface small for the PoC.

## Process state caveat

The report can only cover what the worker actually executed. If the worker was down (or the wrong stale process was running, as happened on 2026-04-27), there will be gaps. I'll surface those gaps explicitly rather than hide them.

---

## When to ask for the report

- Before showing the PoC to a stakeholder.
- After a notable change (new platform, new product, scope shift).
- When something feels off ("why are metrics flat?", "is Meta blocking us?").
- Periodically to track the trend.

## What this report is NOT

- Not a SQL dump. I aggregate.
- Not a Phyllo feature parity audit (that's a separate document).
- Not a billing / cost report (Graph API is free; the cost question is engineering time).
- Not a per-post analytics export (use the public dashboard for that).
