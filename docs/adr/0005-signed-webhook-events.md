# ADR 0005: Signed HTTP webhook events to backend-api

**Status:** Accepted
**Date:** 2026-04-22
**Corresponds to:** D-05

## Context

The connector must notify backend-api when data changes. Four viable approaches: polling from backend-api, signed webhooks from connector, shared queue, or AWS EventBridge.

## Decision

**Outbound HMAC-signed HTTP webhooks from connector → backend-api.** Multi-secret rotation. Dedup on BOTH sides (connector writes `webhook_deliveries` keyed by `(event_id, subscription_id)`; backend-api dedups inbound by `event_id` in an idempotency table). Emitter is fan-out-ready (`webhook_subscriptions` table) from day 1.

## Alternatives considered

- **backend-api polls connector** — rejected; wasteful, high latency, wrong coupling.
- **AWS EventBridge / SNS** — rejected; extra AWS service, added latency for one consumer, overkill for 1-subscriber phase 1.
- **Shared queue (connector writes, backend-api consumes)** — rejected; tight coupling, worst of both worlds.

## Consequences

**Positive:**
- Matches today's Phyllo pattern → minimal change in backend-api's mental model.
- Connector retains full control of delivery semantics (retry, DLQ, rate).
- Fan-out ready — adding mobile or B2B consumer is a row in `webhook_subscriptions`.
- HMAC + multi-secret rotation gives us security without auth-coupling.

**Negative:**
- We own retry logic, DLQ, ack semantics.
- 5s ACK window is a product constraint we must respect in backend-api.

**Mitigations:**
- Retry policy is declarative (exponential backoff: 1s, 5s, 30s, 2m, 10m, 1h, 6h, 24h). 8 attempts before DLQ.
- Metrics + alerts on DLQ depth and delivery latency.

## Related

- [`../06-event-catalog.md`](../06-event-catalog.md)
- [`../08-operations/security.md`](../08-operations/security.md) §HMAC rotation
- [`../09-migration/backend-api-changes.md`](../09-migration/backend-api-changes.md) §Idempotency
