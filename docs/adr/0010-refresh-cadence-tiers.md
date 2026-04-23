# ADR 0010: Refresh cadence — tiers + per-(account,product) overrides

**Status:** Accepted
**Date:** 2026-04-23
**Corresponds to:** D-10

## Context

Not every account deserves the same sync frequency. VIP client accounts need near-real-time engagement tracking; demo accounts can tolerate 24h stale data. Ops needs to adjust this without code deploys.

## Decision

**Three-layer resolution:**

1. Platform default per `(platform, product)` in the `cadences` table.
2. Sync tier per account (`vip 0.5×`, `standard 1.0×`, `lite 2.0×`, `demo 5.0×`, `paused ∞`) multiplying the default.
3. Per-`(account, product)` overrides in `account_cadences` for surgical cases, with optional `expires_at`.

First match wins (override > tier × default > hardcoded fallback).

## Alternatives considered

- **Single override table only** — rejected; ops would need to duplicate rows for every product × account. VIP treatment of a 5-product account = 5 override rows.
- **Free-form rules engine** — rejected; over-engineered. Simple multipliers + overrides handle 99% of cases cleanly.
- **Per-organization cadence defaults** — rejected; organizations span many accounts with different needs. Account is the right granularity for overrides.
- **No tiers, hardcoded defaults** — rejected; ops would resort to per-account overrides for every customization, making the table unmaintainable.

## Consequences

**Positive:**
- Tier covers 90%+ of "this client is important" cases in one change.
- Overrides cover the remaining 10% without adding cases to the tier system.
- Ops API is small and readable.
- `paused` tier gives us a clean way to keep an account connected but quiet.

**Negative:**
- Three layers means resolution logic has three paths — slight mental overhead.
- Changing a platform default recalculates `next_run_at` for all affected rows; at 50k × 7 products that's a 30-60s background job.

**Mitigations:**
- Resolution is a pure function, well-unit-tested.
- Recalc is bounded (LIMIT 1000 per batch) and metrics tracked.

## Related

- [`../refresh-cadence.md`](../refresh-cadence.md)
- [`../rate-limiting.md`](../rate-limiting.md) — overrides still respect rate buckets
