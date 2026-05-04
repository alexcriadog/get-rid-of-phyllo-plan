# 02 · Architecture Overview

**Status:** Living — normalized English summary
**Last updated:** 2026-05-04
**Canonical source:** [`../context/phyllo-replacement-structure.md`](../context/phyllo-replacement-structure.md) (v2)

High-level architecture of the connector. For the **visual schema with 3-axis extensibility**, see [`03-extensibility.md`](03-extensibility.md) — that is the faster entry point for a new reader.

> **2026-05-04 deltas:** the Meta family now uses a rate-limit *mirror* (state derived from `X-App-Usage` and `X-Business-Use-Case-Usage` headers) instead of the synthetic token-bucket described historically here. See [ADR 0014](adr/0014-meta-rate-limit-mirror.md). For a plain-language explanation of the app-level bucket (with bar-aforo analogy and MotoGP-scale examples) see [`rate-limit-app-level.md`](rate-limit-app-level.md). Token persistence is gated by a `seedAccount` chokepoint that normalises any User token into a Page token before encryption — see [ADR 0015](adr/0015-token-type-normalization.md). The `engagement_new` job now refreshes the last 90 days of posts on every run instead of an incremental window — see `refresh-cadence.md` §0. All synthetic local-fuse buckets (`user_token`, `app`, `page`) have been retired from the IG/FB strategies; the BUC mirror is the only effective gate. The pending follow-ups are tracked in [`TODO.md`](TODO.md).

---

## Summary

Single Docker image, three processes (API / worker / scheduler) on a dedicated EC2 per environment. NestJS, Prisma, BullMQ over shared Redis, new database on the existing RDS MySQL, envelope-encrypted OAuth tokens with KMS, platform credentials in Secrets Manager. Webhook + polling hybrid ingestion. HMAC-signed outbound events to backend-api. Hexagonal layering around a `PlatformAdapter` port that isolates all platform-specific code.

---

## Eight architectural decisions

From the canonical source §2. All closed.

| # | Decision | Resolution |
|---|---|---|
| D-01 | Deployment topology | New dedicated EC2 per env, Docker Compose |
| D-02 | Service shape | One repo, one image, three processes (api / worker / scheduler) |
| D-03 | Job queue | BullMQ on shared Redis |
| D-04 | Scheduler | Dedicated process, single-instance at launch, HA via leader-lock later |
| D-05 | Event delivery | Signed HTTP webhook connector → backend-api, dedup on both sides |
| D-06 | State store | New `connector` DB on existing RDS MySQL, Prisma |
| D-07 | Secret management | AWS Secrets Manager for platform creds, KMS envelope for OAuth tokens |
| D-08 | Rate-limit enforcement | Token-bucket per `(platform,scope,id)` in Redis + YouTube daily counter |

Further decisions added during planning (2026-04-23): D-09 rate-limit strategy detail, D-10 cadence tiers, D-11 hybrid ingestion, D-12 manual refresh design, D-13 connection portal embedded + shared contract package, D-14 two-tier storage (connector MySQL + backend-api MongoDB).

Each decision has an ADR in [`adr/`](adr/).

---

## System topology

```
AWS VPC
├── EC2: backend-api  ─────────────────────► HTTPS ◄───────  EC2: connector (new)
│     (existing)                                              ├─ connector-api
│     • 5 OAuth ports (adapter feature-flag)                 ├─ connector-worker
│     • inbound event receiver                               └─ connector-scheduler
├── RDS MySQL (existing)                                     (same image, 3 commands)
│     ├─ social_media, shared, camaleonic (backend-api)
│     └─ connector (NEW, separate user)
├── MongoDB (existing) — backend-api only, connector never writes here
├── Redis (shared) — BullMQ queues, buckets, locks, nonces
├── Secrets Manager — /connector/{env}/platform-apps/*
├── KMS — alias/connector-{env}-token (envelope key)
├── S3 — connector/{env}/raw-responses/… (30-90d lifecycle)
└── Observability: Prometheus scrapes /metrics; Promtail tails logs; Grafana dashboards
```

Full rendered view in [`03-extensibility.md`](03-extensibility.md) §1.

---

## Layered architecture (hexagonal)

- **Interfaces layer** — internal REST v1 (for backend-api), public OAuth callback (browser redirects), admin API (ops).
- **Application layer** — account lifecycle (state machine), sync orchestration (scheduler + worker coordination), event emission (outbound webhook delivery). Uses `PlatformAdapter` port; never knows which platform is being called.
- **Domain layer** — the `PlatformAdapter` port itself, events, entities, value objects. The **abstraction that absorbs all platform difference.**
- **Infrastructure layer** — per-platform adapters, Prisma clients, Redis clients, KMS envelope wrapper, Secrets Manager, HTTP clients, Prometheus exporter.

Full diagram in [`03-extensibility.md`](03-extensibility.md) §2.

---

## Component inventory

- **connector-api** (1-2 replicas at launch) — internal REST, public OAuth callback, inbound platform webhooks, outbound event emitter.
- **connector-worker** (N replicas, horizontal scale) — consumes BullMQ jobs, runs adapters, persists, emits events.
- **connector-scheduler** (1 instance at launch, HA-ready) — reads `sync_jobs.next_run_at`, enqueues due jobs, applies rate-limit back-pressure.
- **Platform adapters** — pluggable modules implementing `PlatformAdapter`. Today: IG, FB, YT, Twitch, TikTok.
- **Redis** — BullMQ (queues), rate-limit buckets, throttle locks, manual-refresh locks, OAuth state nonces, leader-lock (future HA).
- **MySQL (`connector` DB)** — `accounts`, `account_organizations`, `oauth_tokens`, `platform_apps`, `sync_jobs`, `cadences`, `account_cadences`, `posts` (normalized), `audience_snapshots`, `identity_snapshots`, `raw_platform_responses` (S3 URIs), `webhook_subscriptions`, `webhook_deliveries`, `inbound_webhook_log`, `audit_log`, `pending_connections`, `platform_field_support`. Full details in [`04-data-model.md`](04-data-model.md).
- **S3** — raw platform response blobs (retention 30-90d via lifecycle policy).

---

## Key flows

Brief. Full sequence diagrams and edge cases in dedicated docs.

### Connect
User → frontend-app → backend-api → connector `/v1/connect/initiate` → returns `authorize_url` → browser redirects to platform → user consents → platform redirects to connector `/oauth/callback/:platform` → connector exchanges code, resolves canonical ID, upserts account, encrypts tokens, enqueues backfill, emits `account.connected` → redirects browser to frontend-app success page.

See [`connection-portal.md`](connection-portal.md) for the full journey + failure paths.

### Periodic sync
scheduler loop every ~30s → reads `sync_jobs WHERE next_run_at <= NOW() LIMIT 500` → enqueues BullMQ jobs → workers pick up → acquire throttle lock + rate bucket → fetch via adapter → upsert in `connector` MySQL → emit events → update `sync_jobs.next_run_at`.

See [`refresh-cadence.md`](refresh-cadence.md) for cadence resolution; [`rate-limiting.md`](rate-limiting.md) for bucket logic.

### Webhook ingestion
Platform → connector-api `/webhooks/ingest/:platform` → verify signature per-platform → ACK 200 immediately → enqueue HIGH-priority fetch job → worker fetches full data.

See [`ingestion-modes.md`](ingestion-modes.md) for per-platform webhook setup.

### Manual refresh
backend-api → connector `POST /v1/accounts/:id/refresh` → connector enqueues HIGH-priority jobs → worker fetches → emit `refresh.completed` → backend-api forwards to frontend via WebSocket/SSE.

See [`manual-refresh.md`](manual-refresh.md).

### Event delivery (outbound)
connector application emits event → connector-api writes to `webhook_deliveries` → delivery worker signs + POSTs to subscribers → retry with backoff on non-2xx → DLQ after N attempts + alert. Idempotency by `event_id` on both ends.

See [`06-event-catalog.md`](06-event-catalog.md) for event types; [`08-operations/security.md`](08-operations/security.md) for HMAC multi-secret rotation.

### Disconnect
Either user-initiated via `DELETE /v1/accounts/:id` (revoke token, mark disconnected, emit `account.disconnected`) or platform-initiated (401 detected during sync → mark `needs_reauth`, emit event). Full handover logic (to scraper, visibility changes) stays in backend-api.

---

## Scaling path

No structural rewrite at any point.

| Stage | Accounts | Structural change | Capacity change |
|---|---|---|---|
| Launch | ~50 | — | t3.small EC2, 1 API / 1 worker / 1 scheduler |
| 12 months | 5,000 | — | t3.medium, 3-5 workers; RDS IOPS bumped if needed |
| 24 months | 20,000 | Optional: scheduler HA via leader-lock | t3.large or 2×EC2 behind LB, 10+ workers |
| 36 months | 50,000+ | Optional: `connector` DB → dedicated RDS; optional ECS/Fargate | 20+ workers, multi-AZ RDS |

---

## Related docs

- [`00-overview.md`](00-overview.md) — scope and responsibility boundary
- [`01-requirements.md`](01-requirements.md) — requirements summary
- [`03-extensibility.md`](03-extensibility.md) — visual schema (read this first)
- [`04-data-model.md`](04-data-model.md) — Prisma schema
- [`05-api-contract.md`](05-api-contract.md) — internal REST OpenAPI
- [`06-event-catalog.md`](06-event-catalog.md) — event types and schemas
- [`08-operations/deployment.md`](08-operations/deployment.md) — Docker, EC2, CI/CD, env vars
- [`../context/phyllo-replacement-structure.md`](../context/phyllo-replacement-structure.md) (canonical)
