# ADR 0003: Job queue — BullMQ on Redis

**Status:** Accepted
**Date:** 2026-04-22
**Corresponds to:** D-03

## Context

Async work (sync jobs, event delivery, backfills) needs a queue: durable, retry-aware, priority-capable, observable. Scale at 50k accounts is ~10^5 jobs/day — not heavy.

## Decision

**BullMQ on Redis** (the existing cluster, shared with backend-api). Queue names: `sync`, `events`, `delivery`. Priorities: HIGH, NORMAL, BACKFILL.

## Alternatives considered

- **AWS SQS** — rejected; two queues split for Standard/FIFO; delayed jobs >15min awkward; AWS dependency in local dev.
- **RabbitMQ** — rejected; additional infrastructure to operate with no compensating benefit.
- **Kafka** — rejected; massively over-specced for our throughput.
- **Polling the DB directly** — rejected; no retry/backoff/priority primitives.

## Consequences

**Positive:**
- Redis is already in stack; no new infra.
- Retries, exponential backoff, priority queues, delayed jobs all first-class.
- Observable (BullMQ Board for dev).
- Queue driver is behind an abstraction — swappable if we outgrow.

**Negative:**
- Redis is an SPoF. Outage blocks sync pipeline (not ingestion, which is synchronous at the HTTP layer).
- BullMQ is Node-specific; any non-Node future consumer would need a different client.

**Mitigations:**
- Redis runs with existing HA config (same as backend-api uses).
- Queue abstraction means swapping to SQS or Kafka later is a driver-level change.

## Related

- [`../ingestion-modes.md`](../ingestion-modes.md) §6
- [`../manual-refresh.md`](../manual-refresh.md) §3
