# Token Lifecycle & Re-auth Handling — Design (logic level)

- **Date:** 2026-07-02
- **Status:** Approved design (logic). Implementation plan to follow.
- **Area:** connector (`poc/`) — token health / lifecycle layer.

## Context

A connected social account's token has up to **two independent clocks**, and
neither reliably predicts the only thing that matters — *can we still read the
data*:

1. **Auth lifetime** (`expires_at`) — can the token authenticate at all. Handled
   today by the hourly refresh cron (`token-refresh.cron.service.ts`) for the
   refreshable flows. Meta FB-login PAGE/USER tokens report `expires_at = 0`
   (never).
2. **Data-access window** (`data_access_expires_at`) — Meta's ~90-day
   re-consent policy clock. Only a real end-user re-login resets it;
   `fb_exchange_token` does **not** (verified live). Observed today by the daily
   `token-health.cron.service.ts` (via `debug_token`) but **never actioned**.

Empirical findings (verified live against prod `ec2-conn`, 2026-07-02):

- IG-Direct refresh works: `graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token`
  → HTTP 200 + fresh 60-day token. (Refutes Phyllo's claim that IG-Direct can't refresh.)
- FB-login PAGE and USER tokens both reported `expires_at = 0` (never expire).
- `data_access_expires_at` being in the **past did NOT block reads**: with our
  own connector page token we pulled full media + story insights (reach,
  navigation, profile_visits, etc.) for an account whose window "expired"
  9 days earlier — the same rich data Phyllo shows.
- An IG-Direct account flagged `needs_reauth` in our DB was actually still
  valid and refreshable (false positive that can never self-heal today).

### Gaps this design closes

1. `data_access` is monitored but never actioned — nobody tells the
   workspace/user to reconnect before the cliff.
2. Acting naively on the clock causes **false reconnects** (the clock lies —
   data still flows).
3. **False-positive `needs_reauth`** is terminal: the crons filter
   `status='ready'`, so a wrongly-flagged account is never swept again and can
   never recover — forcing an unnecessary user reconnect.
4. **IG-Direct blind spot**: `graph.instagram.com` has no `debug_token` edge, so
   the health cron records it as `unsupported`.

## Goals

- **Extract data for as long as we possibly can — stop only when the account is
  actually BROKEN.** The soft "re-auth recommended" state must never gate sync.
- Give the **earliest possible warning** before a foreseeable break.
- **Detect a real break instantly** and signal it (not silently, not late).
- **Auto-recover** from false alarms.
- Add **no ban risk** — no blanket polling; near-zero extra API calls.
- Deliver all lifecycle signals as **real outbound webhook deliveries** to the
  workspace, in both the native and the InsightIQ/Phyllo-compatible formats.

## Non-goals (YAGNI)

- No blanket polling of all accounts.
- No new `Account.status` value — the soft signal is a **separate field**.
- No re-auth UI in the connector — the product/workspace owns that UX.
- No attempt to "reset" `data_access_expires_at` server-side (proven impossible;
  only user re-login resets it).

## Principles

- **Extract until ROTA.** Only the hard state (`needs_reauth`) stops sync. Soft
  ("re-auth recommended") keeps syncing at full capacity.
- **Ground truth > clocks.** A real read is authoritative; the clocks are only a
  predictor used to warn early.
- **Legitimate & compliant.** While Meta grants access we keep reading; around
  the 90-day window we prompt re-auth. Maximally useful *and* clean.

## Design

### 1. Health model — 3 states via a separate soft flag (non-invasive)

`Account.status` stays **binary and untouched** (`ready` | `needs_reauth`) — the
product + backend key off it. A new **soft field** rides alongside on the
account (or its token row):

- `reauthRecommendedAt: DateTime?` — set when the soft signal fires; cleared on
  recovery.
- `dataAccessExpiresAt: DateTime?` — cached from `debug_token` so the product
  can read the cliff date without re-hitting Meta.

Derived health:

| status | reauthRecommendedAt | Meaning | Sync |
|---|---|---|---|
| `ready` | null | HEALTHY | full |
| `ready` | set | WORKS — re-auth recommended (soft) | **full (keep extracting)** |
| `needs_reauth` | — | BROKEN (hard) | gated (as today) + **re-probed to self-heal** |

### 2. Two signals

**SOFT (predictive early-warning) — from the clocks.**
Source: `data_access_expires_at` via `debug_token` (Meta/Threads), already swept
daily. When within the warn window (default ≈14 days) or already passed →
set `reauthRecommendedAt`, cache `dataAccessExpiresAt`, and emit
`token.reauth_required` (severity `soft`) **once**. Never changes status, never
stops sync. IG-Direct has no `debug_token` → no soft signal (accepted; the hard
signal covers it).

**HARD (authoritative ground truth) — from real reads.**
One classifier, two feeders:

1. **Real sync outcomes (free):** active accounts already exercise the token.
   A sync failure classified as token-dead / re-auth-class (`OAuthException 190`,
   dead subcodes via `isTokenDeadGraphBody`, `invalid_grant`) → HARD.
2. **Canary probe (targeted fallback):** only for accounts **not exercised
   recently** (no sync success/failure within ≈24–48 h). One cheap read,
   low-frequency, rate-bucket-aware.

Classifier outcomes:
- `200` → reads work → HEALTHY.
- re-auth-class error → BROKEN → `needs_reauth` + hard notify.
- transient (5xx / network / timeout / rate-limit) → **ignore & retry; never
  flip** (same rule the refresh cron already follows).

**Linchpin:** the canary READ is the only uniform health signal across *all*
flows — it works for IG-Direct where `debug_token` doesn't exist, and it is
ground truth where the clocks lie.

### 3. Canary — selective, not a poll

- Active accounts: **zero extra calls** — health comes free from their real sync
  results.
- Quiet/paused accounts + `needs_reauth` accounts: one cheap probe on the daily
  sweep, respecting the existing per-user rate buckets.
- Per-platform interface: each adapter exposes
  `healthProbe(token) → 'healthy' | 'reauth' | 'transient'` (its own cheapest
  read, e.g. `GET /me` or one basic field). Uniform, testable.

### 4. Self-healing

`needs_reauth` accounts are the **one** set we deliberately include in the
canary sweep. If the probe returns `200` → restore `status='ready'` and emit
`token.recovered`. Guard: self-heal only on a genuine `200` data read (not on a
"valid" `debug_token`). This fixes the account-#2 false positive.

### 5. Data flow (components)

- **Refresh cron (hourly)** — unchanged. Keeps `expires_at` alive.
- **Health & canary cron (daily; extends `token-health.cron.service.ts`)** — per
  connected account: (Meta/Threads) read `data_access` via `debug_token` →
  set/clear soft flag + soft notify; decide "exercised recently?"; if not →
  `healthProbe`; **include `needs_reauth` accounts** in the probe set (self-heal).
- **Sync path (real-time)** — a token-dead sync failure routes straight to the
  lifecycle → `needs_reauth` + hard notify immediately (don't wait for the cron).
- **Lifecycle emitter** (`TokenLifecycleEmitter`) — the single assembly point for
  the new events, extending the existing `account.refreshed` / `token.refresh_failed`
  / `token.expired`.

### 6. Webhook deliveries

Every lifecycle signal is a **real delivery**, not just an internal event, via
the existing pipeline (signed, retried, size-capped, recorded). Mapped onto the
existing three events to avoid redundancy:

- **SOFT** → NEW native event `token.reauth_required` via
  `OutboundWebhooksService.emit(workspaceId, 'token.reauth_required', {...})` —
  payload: `account_id`, `platform`, `workspace_id`, `end_user_id`,
  `canonical_user_id`, `severity: 'soft'`, `data_access_expires_at`, `reason`,
  `occurred_at`. Native-only (InsightIQ has no soft equivalent). No status change.
- **HARD** → **reuse the existing** `TokenLifecycleEmitter.tokenExpired()` path:
  status → `needs_reauth`, native `token.expired` + InsightIQ `SESSION.EXPIRED`.
  No new event; the product's existing "send the user back through OAuth"
  handling applies unchanged.
- **RECOVERED** → NEW native event `token.recovered` on the
  `needs_reauth` → `ready` edge. Standard-format mapping (e.g. `ACCOUNTS.CONNECTED`)
  deferred to the plan.
- **Idempotent:** `token.reauth_required` fires once per transition (keyed on
  `reauthRecommendedAt`); `token.recovered` fires once on the recovery edge.
- Test-mode accounts (`isTest`) are dropped (guard already in the emitter).

## Correctness invariants

- Transient ≠ permanent — only re-auth-class errors flip to `needs_reauth`.
- Soft **never** gates sync; hard gates sync (as today).
- Canary is selective + rate-limited → no ban risk; active accounts get no extra
  call.
- Self-heal only on a real `200`.
- Notifications idempotent per transition.
- IG-Direct: soft signal absent (accepted), relies on hard signal only.

## Data model changes

Additive, nullable — no backfill required:
- `reauthRecommendedAt: DateTime?`
- `dataAccessExpiresAt: DateTime?`
(location: `Account` — simplest for the product to read; confirm in the plan.)

## Testing (logic level)

- **Unit:** the classifier (error → healthy/soft/hard/transient); "exercised
  recently?" gate; idempotent-notify transition; self-heal transition.
- **Integration:** the daily sweep over a seeded mix — healthy, data_access
  expiring, token-dead, transient-erroring, paused, and `needs_reauth`-but-alive
  — asserting status/flag/events and that deliveries are enqueued.
- **Regression (#2):** `needs_reauth` + valid token → self-heals to `ready` and
  emits `token.recovered`.

## Tunable defaults (not blocking)

- Soft warn window: ≈14 days before the `data_access` cliff.
- "Exercised recently" window: ≈24–48 h.
- Canary cadence: daily (piggyback on the existing health cron).

## Verification (end-to-end, when built)

- Seed/point at accounts of each flow; run the sweep; assert soft flag + native
  and standard deliveries land in the delivery log for a data_access-expiring
  account, no status change, sync continues.
- Force a token-dead account → assert `needs_reauth` + hard delivery.
- Restore the token → assert self-heal to `ready` + `token.recovered` delivery.
- IG-Direct account with no `debug_token` → assert canary drives health with no
  soft-signal dependency.
