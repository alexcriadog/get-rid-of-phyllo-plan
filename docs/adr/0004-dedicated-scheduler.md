# ADR 0004: Dedicated scheduler process, single-instance at launch

**Status:** Accepted
**Date:** 2026-04-22
**Corresponds to:** D-04

## Context

Periodic syncs need to be enqueued on schedule across 50 → 50k accounts × ~7 products = up to 350k `sync_jobs` rows. Every ~30 seconds, we need to find rows where `next_run_at <= NOW()` and enqueue them.

## Decision

**Dedicated `connector-scheduler` process. Single instance at launch. Adds HA later via leader-lock (Redis or MySQL `GET_LOCK()`).**

The scheduler does exactly one thing: read `sync_jobs WHERE next_run_at <= NOW() LIMIT 500`, enqueue into BullMQ, mark rows `queued`. Every 30s.

## Alternatives considered

- **Cron in `backend-api`** — rejected; wrong coupling direction. Backend-api should not drive connector scheduling.
- **In-process timer in `connector-api`** — rejected; API container dying mid-tick loses scheduled enqueues.
- **BullMQ repeatable jobs only** — rejected; hard to reason about cadence changes and corrections when schedule is embedded in queue state.
- **Multi-instance scheduler from day 1** — rejected; complexity cost not justified at 50-5k account scale. Add it when measured need arises.

## Consequences

**Positive:**
- Clear separation: scheduler does its one thing; worker does fetching; API serves HTTP.
- Survives API/worker restarts independently.
- Backlog self-recovers on restart (query is `next_run_at <= NOW()` — late ticks catch up).
- Upgrading to HA (leader-lock) is additive — no structural rewrite.

**Negative:**
- Single instance means brief scheduler outage during deploy (~30s gap).
- Missed ticks during the gap aren't fatal but delay sync SLOs by up to the cadence window.

**Mitigations:**
- Deploy window < 30s typical; missed ticks caught up on restart.
- HA upgrade planned when measured need arises (roughly year 2 per the scaling path).

## Related

- [`../02-architecture.md`](../02-architecture.md) §Component inventory
- [`../ingestion-modes.md`](../ingestion-modes.md) §6 — scheduler pseudocode
