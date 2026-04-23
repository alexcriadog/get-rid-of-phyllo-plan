# ADR 0011: Hybrid ingestion — webhook + polling coexistence

**Status:** Accepted
**Date:** 2026-04-23
**Corresponds to:** D-11

## Context

Each platform offers a different ingestion surface. Meta and YouTube push new-content notifications via webhooks (Meta Graph, PubSubHubbub). Twitch pushes live-stream events (EventSub). TikTok's webhook coverage is incomplete. Metrics are never pushed by any platform — only polling refreshes them.

## Decision

**Webhook + polling coexist for every platform that supports webhooks.** Webhooks accelerate new-content detection; polling is the ground truth that runs regardless. When a webhook triggers a successful fetch, the scheduler postpones the next polling tick for that `(account, product)` by one cadence. Polling is inhibited, not duplicated.

When a webhook silences (no event in 2× expected cadence), ops alert fires; polling continues to cover correctness; auto-resubscribe runs after 7 days of silence.

## Alternatives considered

- **Webhook-only** — rejected; silent subscription failures would go undetected and we'd stop ingesting without knowing.
- **Polling-only** — rejected; new-content freshness SLO is ≤ 2h (NF-30), polling that frequently across 50k accounts burns rate-limit budget.
- **Webhook-primary with polling only when silence detected** — rejected; detecting "silence" reliably requires timers we'd have to engineer and alert on anyway. Simpler to have polling always running at a safe cadence.

## Consequences

**Positive:**
- Defensively correct: polling always catches what webhooks miss.
- Webhook silence is a metric, not a correctness problem.
- Adding a webhook-only platform later (if any exists) requires no architectural change.
- Same sync pipeline handles both triggers — single code path after enqueue.

**Negative:**
- We pay polling cost even when webhooks are healthy. Cadences tuned to offset this (polling less frequently than webhook expected interval).
- Two signal sources for the same event — idempotency must be rigorous (handled by `event_id` + throttle lock).

**Mitigations:**
- Per-platform cadences for webhook-covered products are set at 2× the expected webhook interval, not at the freshness SLO. If webhook works, cadence rarely fires before the webhook does.
- Throttle lock (10min) prevents duplicate fetches from colliding webhook + polling.

## Related

- [`../ingestion-modes.md`](../ingestion-modes.md) — full matrix
- [`../refresh-cadence.md`](../refresh-cadence.md) — cadence values
