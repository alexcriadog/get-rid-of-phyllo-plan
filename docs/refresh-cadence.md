# Refresh Cadence

**Status:** Stable reference
**Last updated:** 2026-04-23
**Answers question:** Q2 — How do we set default refreshes but customize per account (VIPs vs demos)?

Not every account deserves the same attention. A flagship creator for a paying client needs engagement data every 30 minutes; a demo sandbox account is fine at once a day. The connector supports **three layers of cadence control** — sensible defaults, tier multipliers, and per-account overrides — resolved deterministically at scheduling time.

---

## 1. Three layers of resolution

Cadence for a given `(account, product)` pair is resolved top-down:

```
1. account_cadences[account_id, product].override_interval_seconds
      ↑ per-account, per-product surgical override (highest priority)
2. cadences[platform, product].default_interval_seconds  ×  tier_multiplier[account.sync_tier]
      ↑ platform default, scaled by the account's sync tier
3. HARDCODED_FALLBACK = 24h
      ↑ safety net if neither row exists (should never happen; alerts)
```

First match wins. The resolver is called once per sync job completion to compute `next_run_at`.

---

## 2. Default cadences per (platform, product)

Stored in table `cadences`. Editable via admin API; changes take effect on the next sync-job completion for each affected row.

| Platform | Product | Default interval | Why |
|---|---|---|---|
| ig | identity | 6h | Cheap API call; totals change slowly |
| ig | audience | 24h | Audience insights change slowly + expensive calls |
| ig | engagement_new | 2h | New-post detection SLO ≤ 2h (NF-30) |
| ig | engagement_metrics_recent | 6h | Posts <7 days old grow fast |
| ig | engagement_metrics_old | 24h | Posts 7–90 days old grow slowly |
| ig | stories | 1h | Stories TTL is 24h; can't miss them |
| fb | identity | 6h | — |
| fb | audience | 24h | Page Insights similar to IG |
| fb | engagement_new | 2h | — |
| fb | engagement_metrics_recent | 6h | — |
| fb | engagement_metrics_old | 24h | — |
| yt | identity | 6h | Channel info changes rarely |
| yt | audience | 24h | Analytics API quota expensive |
| yt | engagement_new | 4h | New-upload SLO (+ PubSubHubbub accelerates) |
| yt | engagement_metrics_recent | 6h | — |
| yt | engagement_metrics_old | 24h | — |
| twitch | identity | 6h | — |
| twitch | audience | 24h | Platform data is thin; no benefit to faster |
| twitch | engagement_new | 4h | (+ EventSub accelerates) |
| twitch | engagement_metrics_recent | 6h | — |
| twitch | engagement_metrics_old | 24h | — |
| twitch | live_status | 5min | Polling backstop; EventSub is primary |
| tiktok | identity | 6h | — |
| tiktok | audience | 24h | Platform data is thin |
| tiktok | engagement_new | 2h | No webhook; polling is sole mechanism |
| tiktok | engagement_metrics_recent | 6h | — |
| tiktok | engagement_metrics_old | 24h | — |

These are **starting values**. They will tune based on observed SLO compliance and rate-limit headroom.

**Row shape in `cadences` table:**
```sql
CREATE TABLE cadences (
  platform         VARCHAR(16) NOT NULL,
  product          VARCHAR(32) NOT NULL,
  default_interval_seconds INT NOT NULL,
  updated_at       TIMESTAMP,
  updated_by       VARCHAR(64),
  PRIMARY KEY (platform, product)
);
```

---

## 3. Sync tiers — account-level multiplier

Every account carries a `sync_tier` enum that multiplies **all** its cadences. Lets the team put a client's VIP accounts on a faster schedule or quiet down demo accounts without writing per-product overrides.

| Tier | Multiplier | Use case |
|---|---|---|
| `vip` | 0.5× | Flagship clients; 2× more frequent syncs |
| `standard` | 1.0× | Default for every newly connected account |
| `lite` | 2.0× | Lower-value accounts; 2× less frequent |
| `demo` | 5.0× | Demo/sandbox accounts; 5× less frequent |
| `paused` | ∞ | No sync scheduled; account stays connected |

**Effect of each tier on Instagram engagement_new (default 2h):**

| Tier | Effective interval |
|---|---|
| vip | 1h |
| standard | 2h |
| lite | 4h |
| demo | 10h |
| paused | — (no job enqueued) |

**Special case — `paused`:** the scheduler skips enqueueing for paused accounts entirely. `sync_jobs.next_run_at` is not updated; when the account is un-paused the next scheduler tick picks up the row. **Webhooks** for paused accounts are still received and logged but do NOT trigger fetches — `sync_tier=paused` gates both polling and webhook-driven sync.

**Row on `accounts`:**
```sql
ALTER TABLE accounts ADD COLUMN sync_tier ENUM('vip','standard','lite','demo','paused') NOT NULL DEFAULT 'standard';
```

---

## 4. Per-account, per-product overrides

Surgical tool for the "this one account needs engagement_new every 30 minutes, but everything else at standard" case. Override is absolute — the tier multiplier does NOT apply on top.

**Row shape in `account_cadences`:**
```sql
CREATE TABLE account_cadences (
  account_id       BIGINT NOT NULL,
  product          VARCHAR(32) NOT NULL,
  override_interval_seconds INT NOT NULL,
  reason           VARCHAR(255),  -- "client request 2026-05-01, VIP+ during launch week"
  created_at       TIMESTAMP,
  created_by       VARCHAR(64),
  expires_at       TIMESTAMP NULL, -- optional auto-revert
  PRIMARY KEY (account_id, product),
  INDEX idx_expires (expires_at)
);
```

**Auto-revert:** rows with `expires_at <= NOW()` are soft-deleted by a nightly cron. Emits event `account.cadence_override_expired`. Lets ops grant temporary VIP+ treatment for a campaign without remembering to revert.

**Limits:**
- Minimum override: 300 seconds (5 min). Below this we refuse — burns rate-limit budget and rarely helps.
- Maximum override: 30 days. Above this use `tier = demo` instead.

Enforcement at the admin endpoint layer (§6), not in the table schema.

---

## 5. Resolution algorithm

Called after every successful sync job completion and on cadence-change events.

```
fn resolve_next_run_at(account, product, now):
    # Check for per-account override
    override = SELECT override_interval_seconds
               FROM account_cadences
               WHERE account_id = account.id
                 AND product = product
                 AND (expires_at IS NULL OR expires_at > now)
    if override:
        return now + override

    # Paused accounts: do not schedule
    if account.sync_tier == 'paused':
        return NULL   # scheduler ignores NULL next_run_at rows

    # Otherwise: default × tier multiplier
    default = SELECT default_interval_seconds FROM cadences
              WHERE platform = account.platform AND product = product
    if default IS NULL:
        emit_metric('cadence_fallback_used', platform=account.platform, product=product)
        default = 86400   # 24h hardcoded fallback

    multiplier = TIER_MULTIPLIERS[account.sync_tier]
    effective = default * multiplier

    # Clamp to sane bounds
    effective = max(effective, 60)         # min 60s (safety)
    effective = min(effective, 7*86400)    # max 7d (safety)

    return now + effective
```

Called from:
- Worker after successful fetch
- Admin API when tier or override changes (re-computes for all affected `sync_jobs`)
- Cadence default change (cadence table update triggers async re-computation job)

---

## 6. Admin API — changing cadences

All admin endpoints are behind service-token auth; only `backend-api` has the token today. Future ops UI lives on top.

### 6.1 Set sync tier
```
PATCH /v1/admin/accounts/:id/sync-tier
Body: { tier: 'vip' | 'standard' | 'lite' | 'demo' | 'paused', reason?: string }

Response:
  200 { account_id, old_tier, new_tier, jobs_rescheduled: N }
```

Side effects:
- `accounts.sync_tier` updated
- All `sync_jobs` for this account re-computed with new multiplier
- Audit log entry
- Event `account.tier_changed` emitted

### 6.2 Set per-product override
```
POST /v1/admin/accounts/:id/cadence-overrides
Body: { product: 'engagement_new', interval_seconds: 1800, reason: string, expires_at?: ISO8601 }

Response:
  201 { override_id, account_id, product, interval_seconds, expires_at }
```

### 6.3 Remove override
```
DELETE /v1/admin/accounts/:id/cadence-overrides/:product

Response:
  200 { reverted_to_default_interval_seconds: N }
```

### 6.4 Change platform default
```
PATCH /v1/admin/cadences/:platform/:product
Body: { default_interval_seconds: N, reason: string }

Response:
  200 { platform, product, old: M, new: N, accounts_affected: K }
```

Side effect: background job re-computes `next_run_at` for all affected sync_jobs. Large platform × product cohorts complete in <30s. Event `cadence.default_changed` emitted.

### 6.5 Query effective cadence
```
GET /v1/admin/accounts/:id/cadence

Response:
  200 {
    account_id,
    sync_tier,
    entries: [
      { product: 'identity',   effective_interval_seconds: 21600, source: 'tier_multiplier' },
      { product: 'audience',   effective_interval_seconds: 86400, source: 'tier_multiplier' },
      { product: 'engagement_new', effective_interval_seconds: 1800, source: 'override',
        override_expires_at: '2026-05-10T00:00:00Z' }
    ]
  }
```

Used by backend-api + ops UI to show current sync behavior.

---

## 7. Applying changes to in-flight jobs

Cadence changes affect scheduling, not work already in flight.

- **Tier change to `paused`:** currently-running jobs for this account **complete** (don't interrupt mid-fetch). Their `next_run_at` result is discarded — the row's `status` stays `idle` but scheduler skips it because `sync_tier=paused`.
- **Tier change from `paused` to active:** next scheduler tick picks up rows whose `next_run_at <= NOW()`. If `next_run_at` was NULL (from the paused write), the re-computation job sets it.
- **Override added:** next completion of that `(account, product)` sync uses the override. No immediate effect — if you need immediate sync, use `/v1/accounts/:id/refresh` (see [`manual-refresh.md`](manual-refresh.md)).
- **Override removed:** next completion reverts.
- **Platform default change:** background re-computation recalculates `next_run_at` for affected rows in batches of 1000. Can take 30-60s at 50k accounts — tracked via metric.

No configuration change ever interrupts work already in progress. Scheduler reads the latest state on each tick.

---

## 8. Observability

Metrics:
- `sync_tier_count{tier}` — gauge, accounts per tier
- `cadence_override_active{product}` — gauge, accounts with active override per product
- `cadence_fallback_used_total{platform,product}` — counter, should be 0; if >0 = missing `cadences` row (bug)
- `cadence_change_rescheduled_total{kind="tier|override|default"}` — counter
- `sync_lag_seconds{platform,product}` — histogram, `NOW() - next_run_at` at enqueue time (should be near 0 when healthy)

Alerts:
- `cadence_fallback_used_total > 0` for 5min → page ops (means missing row in `cadences`)
- `sync_lag_seconds p95 > effective_cadence` → scheduler backlogged; worker capacity too low

Grafana: per-platform × product panel showing effective cadence median + distribution per tier.

---

## 9. Failure modes & edge cases

| Scenario | Behavior | Remediation |
|---|---|---|
| Admin sets tier to paused on account with in-flight sync | In-flight completes; future scheduler ticks skip | Correct behavior. No intervention. |
| Admin sets override shorter than platform rate limit would sustain | Rate bucket rejects; job re-queues with delay | Bucket enforces regardless. Ops sees denials spike; reconsiders override. |
| `cadences` row missing for a platform × product | Fallback to 24h; metric incremented; alert fires | Add row via admin API. |
| Override expires mid-sync | Sync completes with old interval; next computation uses new default | Expected. Auto-revert is lazy. |
| Two admin calls racing on same account | Last write wins (standard DB semantics); events emitted in order | Idempotent; no corruption. |
| Cadence change during scheduler tick | Tick uses snapshot of state at start; next tick sees new state | At most one cadence cycle of lag. |
| Clock skew between connector replicas | `next_run_at` uses DB NOW(); all replicas read from same DB | Not an issue. |
| Backlog: `sync_jobs` with `next_run_at` far in past | Scheduler LIMIT 500 per tick; processes oldest first | Recovers by adding worker capacity. |

---

## 10. ADR

See [`adr/0010-refresh-cadence-tiers.md`](adr/0010-refresh-cadence-tiers.md) for the decision to layer **tier multiplier + per-(account,product) override** instead of a single override mechanism. Alternatives considered:
- **Single override table only** (rejected — ops would need to clone 6 products for every VIP)
- **Free-form rules engine** (rejected — over-engineered; simple multipliers + overrides cover 99% of cases)
- **Per-organization cadence defaults** (rejected — organizations span many accounts with different needs; overrides go at account level)

---

## 11. Related docs

- [`rate-limiting.md`](rate-limiting.md) — aggressive cadences still respect rate buckets
- [`ingestion-modes.md`](ingestion-modes.md) — polling cadence is one input; webhooks accelerate detection without changing cadence state
- [`manual-refresh.md`](manual-refresh.md) — force a fetch ahead of schedule
- [`05-api-contract.md`](05-api-contract.md) — OpenAPI spec for the admin endpoints above
- [`08-operations/runbook.md`](08-operations/runbook.md) — tiering a new client account, handling campaign-week overrides
