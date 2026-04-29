# Scalability Plan — Connector PoC → Production

**Status:** Plan
**Last updated:** 2026-04-27
**Audience:** technical lead, CEO
**Companion:** [`scalability-gaps.md`](scalability-gaps.md)

This is the staged plan to take the PoC to production at thousands of accounts across multiple platforms. It is structured as four phases. Each phase has a clear capacity target, the gaps it closes (referencing IDs from `scalability-gaps.md`), the deliverables, and a rough engineering effort estimate.

The plan is **incremental** — every phase ships value and the system stays operational at the previous phase's capacity throughout.

---

## TL;DR for the CEO

| Phase | Capacity target | Effort | Closes |
|---|---|---|---|
| **0 — Stop bleeding** | 1-10 accounts, dev-team-only | ~3 days | A2, B1 (single-instance), graceful drain |
| **1 — Staging-grade** | ~100 accounts, internal pilots | ~2 weeks | A1, A2, A3, B1, B3, C1, C2, E1 |
| **2 — First customers** | ~1,000 accounts, paying tier | ~6-8 weeks | All "High" + first multi-platform |
| **3 — Scale** | ~10,000 accounts, multiple platforms, multi-tenant | ~3-4 months | All "Medium" + multi-region |

**Key principle:** *Solve B1 (shared rate buckets) before any other concurrency change.* Until rate buckets are shared across processes, we cannot run more than one worker safely.

---

## Phase 0 — Stop bleeding *(Week 1)*

**Goal.** End the laptop-on-laptop dependency. Make the current single-instance setup observable and recoverable. No capacity increase.

### Deliverables

1. **Move workers off the laptop.** A small VM (Hetzner/EC2 t3.micro/Render Background Worker — $5-15/mo) running the `worker`, `scheduler`, and `api` processes under `pm2` or `systemd`. Auto-restart on crash, persistent through host reboot.
2. **Worker heartbeat table.** New Postgres table `worker_heartbeats(host_id PK, last_tick_at, pid, version)`. Worker writes every 30s. Admin UI flag turns red if any heartbeat is stale > 5 min. *Closes A2.*
3. **Graceful queue draining.** On `SIGTERM`, worker stops accepting new jobs, finishes in-flight ones with a 30s timeout, then exits clean. *Closes the cross-cutting "no graceful drain" risk.*
4. **`/admin/health` endpoint.** Aggregates: workers alive, queue depth, last successful sync per platform, error rate last 1h. Returned as JSON for monitoring tools.
5. **Cron job for `api_call_log` retention.** Nightly delete rows older than 30 days. Brutally simple, gets us through phase 1. *Partial fix for C1.*

### Effort

~3 engineer-days. No new dependencies beyond a deploy target.

### Out of scope for Phase 0

- Multiple workers (B1 must be solved first).
- Mongo retention (more data, less write pressure — wait).
- New platforms.

---

## Phase 1 — Staging-grade *(Weeks 2-3)*

**Goal.** Run reliably at ~100 accounts. Survive a vendor outage without manual intervention. Open to internal pilot users.

### Deliverables

1. **Shared rate buckets in Redis.** Replace the in-memory `RateBucketService.Map` with a Redis-backed token bucket using Lua atomic scripts. Same interface (`acquire(hints, ctx)`), but state is shared across all worker processes. Workers can now scale horizontally. *Closes B1.* **This is the keystone change of the entire plan.**

2. **Run 2 workers + 1 scheduler.** Validate B1 by running concurrent workers. Confirm they share the bucket correctly via a load test against a sandbox Meta app.

3. **Per-platform circuit breaker.** New service `PlatformCircuitBreaker(platform)` with three states `closed | half-open | open`. When error rate > threshold for a platform, trip to `open` for N minutes. The worker checks state before each call; opens skip the call and reschedule with backoff. *Closes E1.*

4. **Backpressure: bounded queue.** Configure BullMQ with a hard cap on `waiting` count per queue. Scheduler tick pre-checks depth and skips enqueuing if above 80% capacity, logs a warning. *Closes B3.*

5. **Real observability.** Export `MetricsService` counters as a `/metrics` Prometheus endpoint. Stand up a small Grafana dashboard with the 5 panels that matter: rate-limit usage by platform, queue depth, worker liveness, error rate, sync_job freshness percentiles. *Closes E5.*

6. **Mongo TTL indexes.** Add TTL on `event_log` (90 days), `raw_platform_responses` (30 days). `posts` and `audience_snapshots` keep forever for now — they're product data. *Partial fix for C2, C3.*

7. **OAuth token expiry tracking + refresh job.** Daily job that finds tokens with `lastRefreshedAt > 50 days` and refreshes them via Meta's exchange endpoint. Failures emit `account.needs_reauth` and notify ops. *Closes D3.*

### Capacity check

- **Target:** 100 accounts × 4 products × ~30 calls/account/day = 12,000 calls/day.
- **Meta budget:** 200 BUC pts/h app-aggregate × 24h = 4,800 pts/day app-wide. With current ~1pt-per-call cost, plenty of headroom even at 100 accounts.
- **Worker capacity:** 2 workers × concurrency 4 × ~5s/job = ~96 jobs/min = ~138K jobs/day. 50× headroom over need.

### Effort

~10-12 engineer-days. New dependencies: Redis Lua (already on Redis), Prometheus + Grafana (managed: Grafana Cloud free tier).

---

## Phase 2 — First paying customers *(Weeks 4-9)*

**Goal.** Run at ~1,000 accounts across **2-3 platforms** (Meta + YouTube minimum). Multi-tenant safe. SLA-able.

### Deliverables

1. **Rate-limit abstraction generalised across platforms.** Refactor `RateLimitHint` into a polymorphic `RateLimitStrategy` per platform:
   - `MetaBUCStrategy` — token bucket, BUC headers refresh from `X-*-Usage` responses.
   - `YouTubeQuotaStrategy` — daily quota counter, per-method cost lookup table, resets at Pacific midnight.
   - `TikTokFlatStrategy` — per-app daily counter + per-user.
   - `TwitchHelixStrategy` — sliding 60s window per token.
   - `XTierStrategy` — monetary tier-based, hard reject on exceed.
   Each owns its own Redis key prefix and refresh logic. *Closes B4.*

2. **Per-tenant fairness.** Convert the single BullMQ priority queue into one queue per tenant (or a shared queue with weighted-round-robin via job tags). Backfill goes into a separate queue with stricter rate budget. *Closes D1, E2.*

3. **Tier-aware cadence.** Wire `Account.syncTier` (`free | standard | pro | enterprise`) to actually change the cadence and priority. Cadence overrides per-tier in the `cadences` table. *Closes D2.*

4. **YouTube adapter implementation.** First non-Meta adapter, validates the rate-limit abstraction. Full lifecycle: OAuth, identity, audience (where available), engagement_new, plus YouTube-specific products (live_streams, channel_analytics).

5. **Webhook ingestion: scale out.** Lift `WebhooksIngestController` from the API process into its own dedicated service horizontally scalable behind the load balancer. Persist ingested webhooks to Redis stream for the worker to consume. *Closes E4.*

6. **`api_call_log` partitioned + cold storage.** Move from `DELETE WHERE called_at < 30d` to monthly partitions; archive partitions older than 90 days to S3 Parquet. Keep recent partitions hot in MySQL. *Closes C1.*

7. **MySQL read replica + connection pooling layer.** Move read-heavy admin queries (operational report, dashboards) to a read replica. Introduce PgBouncer-equivalent for MySQL (e.g. ProxySQL) to keep total connection count predictable. *Closes C4 partially.*

8. **Stories backup via webhooks.** Subscribe to Meta `media` / `story_insights` webhooks for IG, `feed`/`videos` for FB, dedupe on `(platform_content_id, fetched_at)`. Even if the polling worker is down for 2h, the webhook will catch the story. *Closes E3.*

### Capacity check

- **Target:** 1,000 accounts × 4 platforms × ~50 calls/account/day = 200K calls/day.
- **Meta budget:** Per-Page BUC at 200pts/h means 4.8K pts/day per Page → 4.8M pts/day app-wide for 1000 Pages. Still well below Meta's app-aggregate ceiling for typical apps.
- **YouTube budget:** Default 10K quota units/day per project. 1000 accounts → need to either (a) request quota increase from Google (standard process, weeks lead time), or (b) shard across multiple Google Cloud projects.

### Effort

~30-40 engineer-days for one strong backend engineer, or ~3 weeks for a pair.

---

## Phase 3 — Scale *(Weeks 10-22)*

**Goal.** Run at ~10,000 accounts × 5 platforms × multi-region. Hardened security. Cost-aware.

### Deliverables

1. **Sharded scheduler with leader election.** Replace the single scheduler with N instances coordinated via Redis lease (one leader does the database query, leaders rotate via short-TTL lease). Or shard by `account_id MOD N` so each scheduler owns a slice. *Closes A3.*

2. **Mongo sharding by `account_id`.** Once on Atlas (or self-hosted with config servers), shard `posts`, `audience_snapshots`, `raw_platform_responses` by `account_id` hash. Hot accounts no longer monopolise a single shard. *Closes C4 fully.*

3. **`raw_platform_responses` to S3 with hash dedup.** Move the body field out of Mongo into S3 (`s3://prod-raw-responses/{platform}/{date}/{hash}.json.gz`). Mongo keeps only the metadata + hash. Reduces Mongo storage 100×. *Closes C2 fully.*

4. **KMS-backed token encryption + per-tenant data keys.** Replace `LOCAL_AES_KEY` with AWS KMS / Google KMS. Each tenant has its own data key encrypted under a master KEK. Token rows store the encrypted DEK + ciphertext. Allows key rotation and per-tenant blast-radius isolation. *Closes D4.*

5. **Multi-region deploy.** EU + US worker pools. Tenants pinned to a region for GDPR compliance. Mongo shards regional. Redis cluster regional. Cross-region replication only for billing/auth.

6. **Cost telemetry.** Per-account ledger: Graph calls × cost-per-call estimate, DB IOPS attributed via account_id, S3 GB-months. Roll up to per-tenant invoice candidate. Required for unit economics.

7. **Per-platform observability dashboards.** One Grafana dashboard per platform showing rate-limit utilisation %, error rate, token health, freshness percentiles. The "ops single-pane".

### Effort

~3-4 months with a small SRE team (1 backend + 1 SRE).

---

## Cross-cutting workstreams

Three things that don't belong to a single phase but must run continuously from Phase 1 onwards.

### W1. Continuous load testing

Before each phase ships, a synthetic load test that simulates the next phase's account count + churn rate. Run against a staging environment with sandbox Meta apps. Confirms rate-limit math holds and reveals hidden hot paths. Tooling: `k6` or homegrown.

### W2. Runbook + on-call rotation

Each phase introduces new failure modes; each should ship with a runbook entry in `docs/08-operations/runbook.md`. By Phase 2, paid customers means an on-call rotation (PagerDuty/OpsGenie).

### W3. Platform-specific quota negotiations

Some platforms require formal quota requests with weeks of lead time:
- **YouTube**: form-based application, can take 4-6 weeks for a 10× quota raise.
- **Meta**: BUC limits are app-class-dependent; advanced access cycle of 2-4 weeks.
- **TikTok**: partner program required for >1000 calls/day.
- **X/Twitter**: monetary, instant but $$$.

Start these conversations in Phase 1 so the quota lands when Phase 2 ships.

---

## Decision points

Three architectural choices that need an explicit yes/no early in Phase 2:

1. **Self-hosted Mongo+MySQL vs managed (Atlas + RDS/PlanetScale).** Managed is +cost, -ops burden. For a small team, almost always managed.
2. **Stick with Nest.js or extract worker as standalone Node service.** Nest gives DI niceties; for a high-throughput worker the overhead is acceptable but worth measuring. Default: stick with Nest until evidence to the contrary.
3. **Single Redis vs Redis Cluster.** Single instance fine through Phase 2; cluster needed at Phase 3 for cross-region.

---

## What this plan does NOT solve

- **Vendor pricing changes.** If X/Twitter doubles premium prices, no architecture saves us — it's a product/finance call.
- **Platform deprecation events.** Meta deprecating a metric (we hit this twice already this PoC) is a code-change problem, not an architecture one. Mitigation: subscribe to platform changelogs, automated daily smoke test of all metric names.
- **Bad customer behaviour.** A tenant connecting 1000 accounts in 5 minutes will saturate any system briefly; we limit blast radius via D1 fairness, not by preventing it.

---

## Sequencing summary

```
Phase 0 (week 1):    move-off-laptop + heartbeat + graceful drain
        │
Phase 1 (weeks 2-3): SHARED RATE BUCKETS  ← keystone
                     + horizontal workers
                     + circuit breaker
                     + backpressure
                     + observability
        │
Phase 2 (weeks 4-9): multi-platform rate strategies
                     + per-tenant fairness
                     + tier-aware cadence
                     + first non-Meta adapter (YouTube)
                     + webhook ingestion scale-out
                     + api_call_log archival
                     + Mongo TTL/replica
        │
Phase 3 (weeks 10-22): sharded scheduler
                       + Mongo sharding
                       + S3 raw responses
                       + KMS keys
                       + multi-region
                       + cost telemetry
```

Open the gap catalog: [`scalability-gaps.md`](scalability-gaps.md).
