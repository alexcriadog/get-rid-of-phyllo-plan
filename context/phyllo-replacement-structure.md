# Phyllo Replacement — High-Level Structure (v2)

**Document version:** v2
**Change log vs v1:** corrected DB stack (MySQL, not Postgres — existing RDS instance reused with new schema); locked answers to structural open questions (scheduler non-HA at launch, single event consumer with fan-out ready, same repo/image for all 3 processes, dedup on both sides). Original v1 structure preserved.

**Document purpose:** present the general structural proposal for the connector service that will replace Phyllo. Boundaries, major components, flows, architectural decisions. No implementation detail. No code.

**Prerequisites:** `phyllo-replacement-requirements.md` v2 approved.

---

## 1. Guiding principles

Five principles that explain every other choice in this document:

1. **Match existing patterns where possible.** Team is 2 backend + 1 infra. Docker Compose on EC2, ECR, GitHub Actions, Nginx, Redis, Prometheus, **MySQL on RDS**, MongoDB, Prisma are already in operation. The new service reuses these same patterns.

2. **Decouple, then share nothing (at the logical level).** The service lives in its own deploy unit, its own database *schema*, its own failure domain at the application level. It talks to `backend-api` through a narrow, versioned contract. Failures here cannot bring down the dashboard.

3. **Design for 50× scale, build for 1×.** The *structure* is what the 50k-account system needs. The *capacity* starts small. Going from 50 to 50,000 accounts = "add workers, bigger DB", not "rewrite".

4. **Three load-bearing abstractions: ports, adapters, events.** Port defines what a platform must expose. Adapter implements it. Events decouple us from `backend-api` and from any future consumers.

5. **Do one thing: platform data gateway.** No business logic, no org policy, no notifications, no media storage, no scraping. Boundary per §1.4 of the requirements doc.

---

## 2. Architectural decisions — the 8 that matter

### D-01 · Deployment topology

**Question:** where does the new service run?

| Option | Pros | Cons |
|---|---|---|
| A. Same EC2 as `backend-api` | Zero new infra | Shares failure domain — violates NF-10 |
| **B. New dedicated EC2 (per env)** | **Isolated at process level, same ops model, still simple** | **Slightly more infra to manage** |
| C. ECS Fargate | Native horizontal scaling | New ops model team doesn't run today |
| D. Lambda + EventBridge | Scale to zero | Changes everything; cold starts hurt OAuth callbacks; over-engineered |

**Recommendation: B.** New dedicated EC2 per environment (dev + prod), Docker Compose stack. Process-level isolation from `backend-api`. Reuses the ops pattern the team already runs. Vertical scaling to a bigger EC2 covers up to ~20k accounts. Migration to ECS/Fargate later, if needed, is straightforward — the workload is already in containers.

### D-02 · Service shape

**Question:** one service or many?

| Option | Pros | Cons |
|---|---|---|
| A. Single monolith process | Simplest | Can't scale API independently from workers |
| **B. One service, three process types (API · workers · scheduler)** | **Independent scaling, single codebase, single release** | **Slight compose complexity** |
| C. Microservices | Ultra-decoupled | Way too much for a 3-person team |

**Recommendation: B.** One repo, one codebase, **one Docker image**, three processes declared in compose — all three run the same image with different commands:

- `connector-api` — HTTP only: internal API for `backend-api`, public OAuth callbacks, outbound event emitter.
- `connector-worker` — pulls from job queue, runs platform adapters, persists, emits events. Scales horizontally.
- `connector-scheduler` — reads due rows from `sync_jobs`, enqueues them. Single instance at launch (§D-04).

**Why same image:** worker and scheduler share *all* the code that matters (platform adapters, DB access, token encryption, event client). Splitting into separate images duplicates code and risks version skew between them at runtime.

### D-03 · Job queue

**Question:** how does async work flow between API/scheduler and workers?

| Option | Pros | Cons |
|---|---|---|
| **A. BullMQ on Redis** | **Redis already in stack; delayed jobs, retries, priorities, rate-limit-aware consumers built in** | **Redis is an SPoF unless replicated** |
| B. AWS SQS | Managed, durable | Two queues split (Standard/FIFO); delayed jobs > 15min awkward; AWS dependency in local dev |
| C. RabbitMQ | Flexible routing | One more thing to operate |
| D. Kafka | Replay, partitioning | Massively over-specced |

**Recommendation: A.** BullMQ on Redis. At 5k-50k accounts the job rate is ~10^5 jobs/day, trivially within BullMQ's comfort zone. Retries, backoff, priorities, delayed jobs, per-queue rate limits all first-class. Queue driver is behind an abstraction — swappable if we outgrow it.

### D-04 · Scheduling

**Question:** how do periodic syncs get triggered?

| Option | Pros | Cons |
|---|---|---|
| A. Cron in `backend-api` | Zero new components | Wrong coupling direction |
| B. In-process cron on the API container | Simple | Fails if that container dies mid-tick |
| **C. Dedicated scheduler process, single-instance at launch; HA-capable later via leader lock** | **Clear responsibility, survives API/worker restarts, scales to millions of rows; HA is an additive change later** | **One more container** |
| D. BullMQ repeatable jobs only | Less code | Hard to reason about cadence changes and corrections |

**Recommendation: C.** A `connector-scheduler` process that every ~30 seconds reads `sync_jobs WHERE next_run_at <= NOW() LIMIT N` and enqueues into BullMQ. Does nothing else.

**HA posture:** single-instance at launch. If the process dies, missed ticks catch up on restart (the `next_run_at <= NOW()` query picks up the backlog). Upgrading to HA later is an additive change — wrap the loop in a leader lock (MySQL `GET_LOCK()` or Redis lock with TTL). No structural change needed.

### D-05 · Event delivery to `backend-api`

**Question:** how does the connector tell `backend-api` "new data is ready"?

| Option | Pros | Cons |
|---|---|---|
| A. `backend-api` polls the connector | Ultra simple | Wasteful, high latency |
| **B. Signed HTTP webhook from connector to `backend-api`** | **Push-based, matches today's Phyllo pattern, minimal backend-api change** | **We own retries + DLQ** |
| C. AWS EventBridge / SNS fan-out | Managed | Added latency for one consumer |
| D. Shared queue | Fast | Tight coupling |

**Recommendation: B.** Outbound HTTP webhooks from `connector-api` to `backend-api`, HMAC-SHA256 signed, multi-secret rotation (NF-56).

**Fan-out readiness:** even though `backend-api` is the only consumer today, the emitter layer is designed as "one event → N subscribers" from day 1 — subscribers are just rows in a `webhook_subscriptions` table. Adding a second consumer later is a config change, not code. Cheap insurance.

**Idempotency / dedup (both sides):**
- **Connector side (outbound):** every event has a stable `event_id`. The connector stores each delivery in `webhook_deliveries`; once a target ACKs 2xx, we never re-send for that `(event_id, target)`.
- **`backend-api` side (inbound):** because delivery semantics are at-least-once, `backend-api` keeps an idempotency table keyed by `event_id` and ignores replays. `backend-api` changes to accept this. Standard pattern.

### D-06 · State store for the connector

**Question:** where does the connector keep its own data (accounts, encrypted tokens, sync jobs, cadences, audit, webhook deliveries)?

| Option | Pros | Cons |
|---|---|---|
| A. Reuse one of `backend-api`'s existing MySQL databases | No new anything | Schema entanglement with backend-api — bad |
| **B. New database on the existing RDS MySQL instance** | **No new infrastructure; team already runs Prisma; separate credentials + logical isolation; easy migration to dedicated RDS later if it ever interferes** | **Shares RDS instance with `backend-api`** |
| C. New dedicated RDS instance | Full physical isolation | Extra ~$30/month; one more DB to operate |
| D. DynamoDB / MongoDB | Different tech for different reasons | Wrong shape — we need joins, range scans on `next_run_at`, cheap secondary indexes |

**Recommendation: B.** New MySQL database on the existing RDS instance, with its own user, credentials, and connection pool. Call it `connector` (or whatever naming convention matches `social_media` / `shared` / `camaleonic`).

Trade-off acknowledged: this gives **logical isolation** (separate schema, separate user, Prisma client scoped to this DB only) but not **physical isolation** (same RDS instance as `backend-api`). At launch scale, that is fine. If we ever observe interference (connection-pool contention, IOPS saturation, noisy-neighbour queries), migrating to a dedicated RDS is straightforward:
- Prisma-managed schema transfers cleanly.
- Config change on the connector side only.
- No change in `backend-api`.

**What lives in MySQL vs Redis:**
- MySQL (durable): `accounts`, `oauth_tokens` (envelope-encrypted), `sync_jobs`, `cadences`, `webhook_deliveries`, `audit_log`, `webhook_subscriptions`, `platform_apps` (references only — real secrets live in Secrets Manager).
- Redis (ephemeral, high-churn): BullMQ queues, per-platform rate-limit buckets, per-account throttle locks, OAuth state nonces, scheduler leader lock (when HA is added).

**Note:** the connector does **not** write to MongoDB. Backend-api keeps owning MongoDB (`process_logs`, `accounts` doc, `accounts_stats_history`, `posts`, `accounts_audience_demographics` et al.). The connector only emits events; `backend-api` decides what to persist in MongoDB based on those events.

### D-07 · Secret management

**Question:** how do we handle platform app credentials (few, long-lived) vs per-account OAuth tokens (many, high-churn)?

Two different workloads → two different stores.

- **Platform app credentials** → AWS Secrets Manager. Loaded on boot and on rotation. Rotatable without redeploy (NF-104).
- **Per-account OAuth tokens** → stored in MySQL (`oauth_tokens` table), **envelope-encrypted**: token encrypted with a random data key; the data key itself encrypted with an AWS KMS key and stored alongside. One KMS key per environment. Decryption happens in-memory only at the instant of use; tokens never logged.

Standard pattern for Plaid-like workloads. Resolves the "Apps Secrets — TBD" box in your current architecture diagram.

### D-08 · Rate-limit enforcement

**Question:** how do we prevent concurrent workers from blowing through a platform's limit?

Platforms publish different models:
- Per-user-token budget (Instagram: ~200 req/hr per access token).
- Per-app global budget (TikTok, FB).
- Per-day quota units (YouTube: 10,000/day, calls cost 1–100 units).
- Per-tier unknown (X).

**Recommendation:** token-bucket pattern in Redis, keys structured as `rate:{platform}:{scope}:{identifier}`. Workers call `acquire()` before every external call; on insufficient tokens the job is re-queued with `delay = bucket.reset_at + jitter`. Buckets refill on schedules matching each platform's model. YouTube uses a separate daily-quota counter.

Distinct from BullMQ's own per-queue rate limiter (which caps overall job consumption, not platform spend). Both are used: BullMQ caps concurrency; token-bucket caps per-platform spend.

---

## 3. Component topology

```
                                 ┌──────────────────┐
                                 │   frontend-app   │
                                 └─────────┬────────┘
                                           │ user clicks "Connect Instagram"
                                           ▼
                                 ┌──────────────────┐     ◄────── additional consumers
                                 │   backend-api    │             can subscribe later
                                 │  (Nest.js)       │             (emitter is fan-out-ready)
                                 └──┬──┬──┬─────────┘
                                    │  │  │ calls internal API
                                    │  │  │ to read data / trigger refresh
                                    │  │  └─► scraper (existing, unchanged)
                                    │  │
                                    │  └───► MySQL (social_media, shared, camaleonic)
                                    │        MongoDB (13 collections + auth)
                                    │
                                    ▼
══════════════════════════════════════════════════════════════════════════════════════
                             CONNECTOR SERVICE (new)
══════════════════════════════════════════════════════════════════════════════════════

         ┌────────────────┐       ┌────────────────────┐       ┌─────────────────────┐
         │ connector-api  │◄──────┤  connector-worker  ├──────►│ connector-scheduler │
         │  (1–2 repl.)   │       │     (N repl.)      │       │   (1 instance)      │
         └───┬─────┬──────┘       └──────────┬─────────┘       └──────────┬──────────┘
             │     │                         │                            │
             │     │   SAME DOCKER IMAGE — different commands              │
             │     ▼                         ▼                            │
             │  OAuth callback      ┌────────────────────────────────┐    │
             │  (public)            │  Platform adapters (modules):  │    │
             │                      │  IG · FB · YT · Twitch · TikTok │    │
             │                      │                   · X           │    │
             │                      └────────────┬───────────────────┘    │
             │                                   ▼                        │
             │                          external platform APIs            │
             │                                                            │
             ├──── MySQL (new `connector` DB on existing RDS)  ◄──────────┤
             │     accounts, oauth_tokens (enc.), sync_jobs,              │
             │     cadences, webhook_deliveries, audit_log,               │
             │     webhook_subscriptions                                  │
             │                                                            │
             ├──── Redis (shared with main stack) ◄───────────────────────┘
             │     BullMQ queues, rate-limit buckets, throttle locks,
             │     OAuth state nonces, leader lock (when HA is added)
             │
             └──── signed HTTP webhooks ─────► backend-api receiver
                                                (retries + DLQ in connector)

         AWS Secrets Manager ─── platform app credentials
         AWS KMS ──────────────── token envelope key
         Prometheus (existing) ── scrapes /metrics on each container
         Promtail (existing) ──── tails structured container logs
```

**What each component does (one line):**

- **connector-api** — internal REST for `backend-api`; public OAuth callback endpoints; outbound event emitter.
- **connector-worker** — consumes BullMQ jobs, runs platform adapters, writes to MySQL, enqueues events. N replicas.
- **connector-scheduler** — reads `sync_jobs.next_run_at`, enqueues due jobs. Single instance at launch; HA-capable later via leader lock (additive).
- **Platform adapters** — pluggable code modules behind a common port. Each implements OAuth start/exchange/refresh/revoke, canonical-ID resolution, fetch-profile/audience/contents/metrics, per-platform rate-limit hints.
- **MySQL — new `connector` database on existing RDS** — normalized data + job state + encrypted tokens + audit + outbound webhook deliveries. Separate user, separate credentials, separate Prisma client.
- **Redis (shared with main stack)** — queues + rate buckets + throttle locks + OAuth nonces + leader lock.
- **Secrets Manager + KMS** — platform app credentials + token-envelope key.
- **Observability agents (existing)** — scrape connector containers identically to current services.

---

## 4. Key flows

### 4.1 Connect flow

```
user ─► frontend-app ─► backend-api
                          │
                          ▼ POST /v1/connect/initiate {platform, user, org}
                     connector-api
                          │
                          │ generate opaque state nonce (Redis, 10-min TTL)
                          │ return authorize_url
                          ▼
frontend-app redirects browser ──► platform (e.g. facebook.com/oauth)
                                     │
                                     │ user consents
                                     ▼
browser redirected to GET /oauth/callback/:platform?code=...&state=...
                                     │
                                     ▼
                               connector-api
                                     │ validate state
                                     │ adapter.exchangeCodeForTokens(code)
                                     │ adapter.resolveCanonicalUserId()   ◄─── may need retries
                                     │ upsert account, encrypt + store tokens (MySQL)
                                     │ set status: pending → ready
                                     │ enqueue initial backfill jobs (identity, audience, engagement)
                                     │ emit event 'account.connected' ─► backend-api
                                     ▼
                            redirect browser to frontend-app /connect/success
```

### 4.2 Periodic sync flow

```
connector-scheduler (every ~30 s)
   │
   │ SELECT id FROM sync_jobs WHERE next_run_at <= NOW() LIMIT 500
   │ for each: bullmq.add('sync', {job_id, product, account_id})
   │ mark rows as 'queued'
   ▼
connector-worker (pulls from 'sync' queue)
   │
   │ rate-bucket.acquire(platform, scope) ◄─── if empty: re-queue with delay
   │ throttle-lock.acquire(account_id, product, TTL=10min) ◄─── if held: skip + log
   │ load encrypted token → decrypt in memory
   │ if expired: adapter.refreshToken() → re-encrypt → persist
   │ adapter.fetch{Profile|Audience|Contents}()
   │ normalize → upsert in MySQL
   │ emit events per change ─► backend-api
   │ release throttle lock
   │ sync_jobs: last_success_at=NOW(), next_run_at=NOW()+cadence, status='idle'
```

### 4.3 On-demand refresh

```
dashboard ─► frontend-app ─► backend-api ─► POST /v1/refresh {account_id, product?}
                                             │
                                             ▼
                                    connector-api
                                          │ enqueue job with priority = HIGH
                                          ▼
                              connector-worker picks it up ahead of periodic jobs
                                          │
                                          ▼
                             emits event ─► backend-api ─► frontend-app renders update
```

### 4.4 Event delivery (connector → backend-api) — dedup on both sides

```
use case in the connector
   │ generates stable event_id (UUIDv7 / ULID)
   │ INSERT INTO webhook_deliveries (event_id, subscription_id, payload,
   │                                  next_retry=NOW(), attempts=0)
   │ for each active subscription (today: backend-api only)
   │ enqueue delivery job
   ▼
delivery worker
   │ HMAC-sign payload with active secret
   │ POST to subscription.url, timeout 5 s
   │ 2xx → mark delivered (never re-sent for this event_id + subscription)
   │ non-2xx / timeout → attempts++, next_retry = NOW() + backoff(attempts)
   │ after N attempts → DLQ + alert

backend-api inbound handler
   │ receives POST, verifies HMAC
   │ looks up event_id in idempotency table
   │ if already processed → 200 ACK, do nothing
   │ else process, insert event_id, 200 ACK
```

### 4.5 Disconnect flow

**A. User-initiated**

```
backend-api ─► DELETE /v1/accounts/:id (connector-api)
                │
                │ adapter.revokeToken() (best-effort)
                │ mark account disconnected_at, cancel pending jobs
                │ emit 'account.disconnected' with emitting organization_id
                ▼
          backend-api applies its own handover / scraper / visibility rules
```

**B. Platform-initiated (token invalidated upstream)**

```
worker tries to fetch ─► gets 401/403
                          │ adapter classifies as token-revoked vs transient
                          │ if revoked: mark account needs_reauth, stop scheduling
                          │ emit 'account.needs_reauth'
                          ▼
backend-api prompts user to reconnect; at 14/7/3/1 days to expiry, cron sends notifications
```

---

## 5. Deployment shape

```
AWS account (existing VPC)
│
├── EC2: connector-dev          ── separate from backend-api-dev EC2   ──► /opt/connector/
├── EC2: connector-prod         ── separate from backend-api-prod EC2  ──► /opt/connector/
├── RDS MySQL (EXISTING)        ── adds a new database: `connector`
│                                   alongside `social_media`, `shared`, `camaleonic`
├── ECR repo: social-connector     ── one image, one tag per deploy
├── Secrets Manager path:          /connector/{env}/platform-apps/{platform}
├── KMS key alias:                 alias/connector-{env}-token
└── Route 53 (internal DNS):       connector-api.{env}.internal
```

Nginx (on the existing main-stack EC2):
- `/oauth/callback/:platform` → forwarded to `connector-api` (public, unauthenticated — OAuth redirects land here).
- Internal API: not exposed publicly. `backend-api` reaches `connector-api` on the private network, authenticated per NF-54.

CI/CD: identical to current. GitHub Actions builds one image → pushes to ECR → SSM runs `docker-compose pull && up -d && image prune` on the target EC2.

Observability: Prometheus scrapes `/metrics` on every container. Promtail tails container logs. Alert rules in Grafana map to the SLOs in requirements §3.4.

---

## 6. Scaling path

No structural rewrite at any point on the curve.

| Stage | Accounts | Structural change | Capacity change |
|---|---|---|---|
| Launch | ~50 | None | `t3.small` EC2, 1 API, 1 worker, 1 scheduler, shared Redis, new DB on existing RDS |
| Year 1 | 5,000 | None | `t3.medium` EC2, 3–5 workers; RDS IOPS bumped if needed |
| Year 2 | 20,000 | Optional: add scheduler HA (wrap the tick in a leader lock) | `t3.large` or 2 EC2s behind a small LB for the API; 10+ workers |
| Year 3 | 50,000+ | Optional: migrate `connector` DB to its own RDS instance if RDS contention observed; optional move workers to ECS/Fargate. Same image, same code. | 20+ workers; dedicated or multi-AZ RDS |

The promise: decisions in §2 still hold at 50k accounts. Only capacity changes.

---

## 7. Migration strategy (Phyllo → connector)

Three phases:

1. **Build** — connector stood up in dev; platforms onboarded one at a time; events flow to a *test* endpoint in `backend-api` for diff.
2. **Parallel run, per platform** — feature flag in `backend-api`'s adapter layer lets both the Phyllo adapter and the connector adapter run for a given platform. Compare outputs, fix gaps.
3. **Cutover, per platform** — flip the flag per platform. Phyllo subscription cancelled once all 6 are flipped.

`backend-api` changes required:
- New adapter implementations for the 5 OAuth ports (C-06 of requirements).
- Idempotency table to dedup inbound events by `event_id` (D-05 above).
- Use cases and domain layer unchanged.

Feature flag in the DI container picks per-platform.

---

## 8. What this document does *not* decide

Next doc (detailed design):

- Exact MySQL schema and Prisma models.
- Exact internal API contract (endpoints, OpenAPI).
- Exact event schema (field names, versions).
- Adapter interface signatures.
- Queue names, retry policies, priority tiers.
- Observability metric names, cardinality plan, alert thresholds.
- Per-platform scope lists and App Review checklists.
- DLQ and replay tooling.
- Developer-experience helper endpoint (F-96) shape.

---

## 9. Structural risks and how the shape absorbs them

| Risk | Absorbed because… |
|---|---|
| Meta changes the IG Graph API behaviour | Only the IG adapter changes; event schema, internal API, sync engine untouched. |
| 10× the accounts planned | More worker replicas, bigger DB. Same structure. |
| BullMQ on Redis outgrown | Queue is behind an abstraction; swap driver to SQS or Kafka. Worker logic unchanged. |
| A platform introduces a new rate-limit scope | Bucket keys parametrized by scope; new scope is an adapter-local change. |
| `backend-api` has to be replaced or refactored | Event contract + internal API are versioned; new consumers plug in via `webhook_subscriptions`. |
| Scheduler process dies | Missed ticks catch up on restart (query is `next_run_at <= NOW()`). When HA is added later, leader lock auto-handoff. |
| Shared RDS with `backend-api` becomes noisy-neighbour | Migrate `connector` DB to a dedicated RDS instance; Prisma migrations + config change only. |
| `process_log` in MongoDB must still be populated | Preferred path: emit rich enough events that `backend-api` writes its own `process_log`. Connector stays out of MongoDB. Deferred decision (NF-84 of requirements). |
| A platform disappears (deprecation, TOS fight) | Disable the adapter. Already-fetched data remains. |

---

## 10. Closed structural questions

(v1 had open questions here — all now resolved.)

| # | Question | Resolution |
|---|---|---|
| 1 | RDS from day 1 vs container at launch? | **Existing RDS MySQL, new database (logical isolation; migrate to dedicated RDS later only if interference observed).** |
| 2 | Scheduler HA from launch? | **No — single-instance at launch. HA is an additive change later (wrap tick in leader lock).** |
| 3 | Design for multiple event consumers? | **Emitter is fan-out-ready (`webhook_subscriptions` table). Only `backend-api` subscribed today.** |
| 4 | Same repo/image for all 3 processes? | **Yes — one repo, one image, three commands.** |
| 5 | Event dedup on which side? | **Both.** Connector dedups outbound via `webhook_deliveries` keyed by `(event_id, subscription_id)`. `backend-api` dedups inbound via an idempotency table keyed by `event_id`. `backend-api` will be changed to support this. |

---

## 11. Ready for detailed design

With these 5 answered and the structure locked, next deliverables:

1. MySQL schema (Prisma models) for the new `connector` database.
2. Internal REST API contract (OpenAPI), shaped to slot behind `backend-api`'s existing OAuth ports.
3. Event schema and versioning convention.
4. `PlatformAdapter` interface signature + one fully-written example (Instagram) to validate the abstraction.
5. Queue names, priorities, retry policy spec.
6. Observability plan (metric names, dashboards, alerts).
7. Phase-by-phase roadmap with milestones and platform order.
