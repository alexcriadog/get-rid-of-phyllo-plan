# ADR 0009: Rate-limit strategy — adapter-declared buckets

**Status:** Accepted
**Date:** 2026-04-23
**Corresponds to:** D-09

## Context

Each platform has its own rate-limit model — and the same platform has multiple coexisting budgets (per-token, per-app, per-page for Meta). Hardcoding "N requests per minute" in the core engine would be wrong for any of them.

## Decision

**Each adapter declares its buckets via `rateLimitHints()`**, returning a list of `{scope, keyTemplate, capacity, refillRatePerMs, costPerCall, strategy}`. The core `RateBucketService` applies them uniformly. Platform-specific knowledge stays in the adapter.

Strategies supported: `token-bucket`, `daily-counter`, `per-minute` (the last reserved for future use if a platform requires strict windowing).

## Alternatives considered

- **Single rate-limit algorithm for all platforms** — rejected; YouTube's daily quota is structurally different from Meta's BUC.
- **Hardcoded per-platform limits in the core engine** — rejected; violates the "all platform difference lives in the adapter" principle.
- **Rate-limit config in a database table only** — rejected; couples operational configuration to schema migrations, and the declaration of *what bucket scopes exist* is fundamentally code-level (adapter knows which endpoints it calls).

## Consequences

**Positive:**
- Adapter authors own their platform's rate-limit contract. No friction adding a new platform.
- Core engine is truly platform-agnostic — the "third axis" of extensibility holds.
- Testable: adapter can be unit-tested with declared bucket config.

**Negative:**
- New contributors need to understand both "declare bucket" (adapter) and "acquire bucket" (worker) — two layers.
- YAML configs could drift from adapter declarations; lint enforced.

**Mitigations:**
- Adapter interface is documented; an example (Instagram) exercises all bucket types.
- Alert on mismatch between declared capacity and platform-header-observed usage (§rate-limiting §5).

## Related

- [`0008-token-bucket-rate-limits.md`](0008-token-bucket-rate-limits.md) — the underlying Redis algorithm
- [`../rate-limiting.md`](../rate-limiting.md) — full configuration guide
