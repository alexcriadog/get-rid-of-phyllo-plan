# ADR 0008: Token-bucket rate limits in Redis

**Status:** Accepted
**Date:** 2026-04-22
**Corresponds to:** D-08

## Context

The connector must respect every platform's published rate limits globally, across all workers and all accounts, without hitting 429 in normal operation. Platforms publish heterogeneous models: hourly budgets, daily quotas, per-minute points, per-endpoint counters.

## Decision

**Token-bucket per `(platform, scope, id)` in Redis**, implemented with atomic Lua for race safety. YouTube uses a separate daily-counter strategy because its quota model differs fundamentally (shared budget, variable per-call cost).

## Alternatives considered

- **Celery-style global limiter (one counter per platform)** — rejected; doesn't capture per-token/per-page scopes that Meta uses.
- **Leaky bucket** — considered; semantically similar, but token bucket maps more naturally to platform usage headers and has simpler cost accounting.
- **Platform-side webhooks only (no proactive limit)** — rejected; platforms don't webhook us for metric updates, so polling is unavoidable, and polling without proactive budgeting burns through quota.
- **React only on 429** — rejected; 429 is a failure signal, not a budget. Leaves bursts of retry work that amplify the problem.

## Consequences

**Positive:**
- Proactive: we reject our own job before hitting the wire.
- Per-scope granularity matches platform reality (IG has user_token + app + page scopes).
- Redis Lua gives us atomic compare-and-set — N workers can't race past each other.
- Separate algorithm for YouTube daily quota is cleanly isolated and doesn't leak into the common bucket code.

**Negative:**
- Redis is in the hot path for every external call. Outage blocks sync.
- Rate limits declared in YAML must be kept up to date with platform-published limits (which platforms occasionally change silently).

**Mitigations:**
- Redis SPoF already present (D-03); limit outage blast radius via worker retry behavior (re-enqueue with delay on Redis error).
- Headers are parsed on every response as a sanity check; divergence metric alerts if declared capacity drifts from platform-observed.

## Related

- [`../rate-limiting.md`](../rate-limiting.md) — full design
- [`0009-rate-limit-strategy.md`](0009-rate-limit-strategy.md) — adapter-declared buckets layer on top
