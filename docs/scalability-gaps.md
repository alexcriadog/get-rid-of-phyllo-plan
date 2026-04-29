# Scalability Gaps — Connector PoC

**Status:** Audit
**Last updated:** 2026-04-27
**Audience:** technical lead, CEO
**Scope:** every component of the PoC that **will break or degrade unacceptably** when scaling from today's 4 accounts to thousands across multiple platforms (Meta, YouTube, TikTok, Twitch, X).

This is the honest list of what doesn't scale. The companion document [`scalability-plan.md`](scalability-plan.md) lays out how we fix it, ranked by urgency.

---

## TL;DR for the CEO

Today's PoC works for 4 accounts on a laptop. To reach 100 accounts in production we need to fix **5 critical issues**. To reach 10,000 accounts we need to address all 18 below. The good news: the data model (`accounts`, `sync_jobs`, `cadences`, `oauth_tokens`, BullMQ on Redis) is the right shape — most fixes are infrastructure and operational, not rewrites of business logic.

The single biggest risk is **rate-limit coordination across multiple worker processes** — solving this is mandatory before adding any second worker, and it touches every platform we'll integrate.

---

## Severity scale

- **Critical** — breaks the system or causes data loss at <100 accounts.
- **High** — breaks at 100-1,000 accounts.
- **Medium** — degrades at 1,000-10,000 accounts.

---

## Theme A — Infrastructure & deployment

### A1. Worker runs on a developer laptop *(Critical)*

**Today.** All three processes (`api`, `scheduler`, `worker`) live on a developer's MacBook. macOS suspends them when the lid closes, the network drops when leaving the office, no one is supervising, no automatic restart on crash.

**Evidence.** On 2026-04-27 the laptop was offline 12:00-15:49 UTC. Zero data captured during that window. The system showed "everything green" because `sync_jobs` only stores the latest state — there's no historical record of "the worker was dead for 4 hours". The 124-call recovery spike at 15:49 was the only trail in `api_call_log`.

**Fails at.** Even 1 production account. We cannot promise SLA from a laptop.

### A2. No worker heartbeat / supervision *(Critical)*

**Today.** No process supervisor. No `worker_heartbeat` table or equivalent. The only way to know the worker is alive is to check `ps aux` or notice `sync_jobs.lastSuccessAt` is stale.

**Why it's bad at scale.** With multiple workers we will not notice when one dies; jobs assigned to it will hang in `status='queued'` until the throttle TTL expires. Catch-up volume after a silent outage can swamp downstream APIs (we saw this today on a 4-hour gap with 4 accounts).

### A3. Single scheduler instance *(High)*

**Today.** `SchedulerService` only ticks when `process.argv[2] === 'scheduler'`. One process, one tick every 30s, hardcoded `MAX_ROWS_PER_TICK = 500`.

**Fails at.** ~500 accounts × 4 products × varying cadences eventually saturates the per-tick window. More critically: the single instance is a SPOF. If the scheduler dies, nothing gets enqueued and the worker idles.

---

## Theme B — Concurrency & rate limiting

### B1. Rate buckets are in-memory per process *(Critical)*

**Today.** `RateBucketService` keeps token-bucket state in a JS `Map` inside the worker process. Each declared hint is a `(scope, capacity, refillPerMs)` triple kept in RAM.

**Why it's catastrophic at scale.** The moment we run 2 worker processes, each thinks it has the full Meta budget (200 calls/h per Page). Two workers serving the same Page can each fire 200/h → 400/h → Meta rate-limits. We've already seen on this same project (2026-04-27 morning) what happens when two workers coexist: one stale process + one new process competing on the same BullMQ queue caused the FB stories sync to consume hours of debugging.

**Fails at.** Worker count > 1. Cannot horizontally scale workers without fixing this first.

### B2. Worker concurrency is a single hardcoded number *(High)*

**Today.** `WORKER_CONCURRENCY` env var, default 4. Same number applies to every job kind, every account, every platform.

**Why it's bad.** A backfill of 5 years of YouTube history (cheap reads) and a real-time IG stories sync (TTL 24h, must hit Meta within 1h) compete for the same 4 slots. The backfill will starve the stories sync.

### B3. No backpressure between scheduler and worker *(High)*

**Today.** Scheduler enqueues up to 500 BullMQ jobs per tick regardless of worker capacity. If workers are slow or down, the queue grows unbounded.

**Fails at.** Any sustained slowdown. The queue will balloon, BullMQ disk usage will explode, and recovery requires queue truncation (data loss).

### B4. Multi-platform rate-limit strategy is not implemented *(High)*

**Today.** Only Meta is implemented. The `RateLimitHint` interface generalises but the bucket configurations are hardcoded as constants in each adapter. Cross-platform reasoning ("how much budget remains across all platforms?") doesn't exist.

**Why it matters.** Each platform has a wildly different rate-limit model:

| Platform | Hard limit (typical free/standard tier) | Cost model |
|---|---|---|
| Meta (FB+IG) | 200 BUC pts/h per Page; app-aggregate | Variable per call (CPU + IO) |
| YouTube Data API v3 | 10,000 quota units/day per project | Per-method cost (1-50 units) |
| TikTok Display API | 1,000 calls/day per app, plus per-user limits | Flat per call |
| Twitch Helix | 800 calls/min per user token; 30/sec per app token | Flat per call |
| X (Twitter) API v2 | Tier-based, monetary; basic = 10K reads/month | Hard cap, $$$ to lift |

A unified strategy must (a) speak each model natively, (b) prevent cross-account starvation within a platform, (c) block cross-platform if one platform exhausts.

### B5. No `Retry-After` aggregation across calls *(Medium)*

**Today.** Each adapter call independently honours `Retry-After` on a 429 by pushing its own `nextRunAt`. Other inflight calls in the same worker tick can still hit the platform.

**Why it matters.** A platform-wide throttle from Meta (e.g. during their incident windows) should immediately pause ALL Meta calls across ALL workers, not just the one that got the 429.

---

## Theme C — Unbounded data growth

### C1. `api_call_log` grows forever *(High)*

**Today.** Every Graph call inserts one row. No partition, no retention policy, no archival.

**Math at 10,000 accounts.** Mean ~50 calls/account/day → **500K rows/day = 180M rows/year**. MySQL on a single instance handles this poorly; queries for the operational report will start timing out.

### C2. `raw_platform_responses` grows forever in Mongo *(High)*

**Today.** Every Graph response body stored in full, with `contentHash` for dedup but no TTL.

**Math at 10K accounts.** Average ~5KB per response × 50 calls/day × 10K accounts = **2.5GB/day → 1TB/year**. Mongo on a single instance will need rolling capped collections, TTL indexes, or move to object storage (S3) with hash deduplication.

### C3. `event_log` and `posts` collections also unbounded *(Medium)*

**Today.** No retention. `posts` grows with every new post per account. `event_log` grows with every sync run.

**Note.** These are content of business value (different from telemetry), so retention policy = product decision (e.g. "1 year of posts", "30 days of events").

### C4. Single MySQL + single MongoDB instances *(High)*

**Today.** Both DBs are single-node Docker containers in the PoC. No replication, no sharding, no read replicas.

**Fails at.** ~500-1,000 accounts depending on hot-account distribution. A single tenant doing a bulk backfill can starve the rest of the platform.

---

## Theme D — Multi-tenancy & business logic

### D1. No tenant fairness / noisy-neighbor protection *(Critical at multi-tenant)*

**Today.** All `sync_jobs` share a single BullMQ priority queue (`HIGH | NORMAL | BACKFILL`). One tenant onboarding 100 accounts at once will dominate the queue.

**Fails at.** Any multi-tenant deployment. The first paying customer to import their full creator roster will starve every other customer.

### D2. No customer pricing tier propagation *(High)*

**Today.** A `syncTier` field on `Account` exists (`standard` | `paused`). Not wired to actually change cadence, priority, or call budget per account.

**Why it matters.** A Pro tier customer paying €X/month should get 5-min refresh on their content; a Free tier should accept hourly. We can't deliver this today.

### D3. OAuth token refresh is not automated *(High)*

**Today.** `OAuthToken.lastRefreshedAt` is updated on the seed, but no scheduled refresh job exists. We rely on Meta's "long-lived tokens don't expire" behaviour, which is approximate.

**Fails at.** First mass token expiry event (e.g. Meta forces user re-consent for compliance), which will mark hundreds of accounts as `needs_reauth` simultaneously.

### D4. Token encryption uses one global key *(High)*

**Today.** `LOCAL_AES_KEY` env var. Single key, no rotation, no per-tenant scoping.

**Fails at.** First security audit / GDPR review. Production needs KMS-backed keys with rotation, ideally per-tenant for blast-radius reduction.

---

## Theme E — Operational resilience

### E1. No per-platform circuit breaker *(High)*

**Today.** If Meta has a 30-min outage, every sync_job fails, `failureCount` climbs, accounts get auto-paused (`MAX_CONSECUTIVE_FAILURES=5`) and need manual unpausing.

**Why it matters.** A vendor outage should NOT cascade into thousands of paused accounts requiring manual recovery. We need: detect outage → pause platform globally → resume when error rate drops → reset failure counters.

### E2. No backfill lane *(High)*

**Today.** A new account onboarding triggers full-history fetches at the same priority and rate budget as steady-state syncs.

**Why it matters.** Onboarding 50 new accounts in a morning could exhaust the Meta budget for the day, freezing existing customers.

### E3. Stories 24h TTL has no redundant capture *(Medium)*

**Today.** Stories cadence is 1h. If the worker is down for >1h (today's case), we miss IG/FB stories permanently.

**Why it matters.** Already documented as a hard SLO in `docs/07-platforms/instagram.md`. At scale, webhook subscription as a backup capture path becomes mandatory — we already declare the subscription, but the ingestion controller is single-instance (next item).

### E4. Webhook ingestion is single-instance *(Medium)*

**Today.** `WebhooksIngestController` runs in the API process. One instance.

**Fails at.** Meta's documented retry policy is up to 3 attempts within 1 hour for failed webhook deliveries. At ~1000 accounts × multiple webhook events/account/day, a single instance will start dropping deliveries during traffic spikes.

### E5. No platform observability export *(Medium)*

**Today.** `MetricsService` keeps in-memory counters and writes to `api_call_log`. No Prometheus/Datadog/StatsD export.

**Why it matters.** At scale you cannot grep MySQL to know "are we healthy". Operations needs RED/USE metrics, dashboards, alerts. Without these, every incident becomes a forensic exercise.

---

## Cross-cutting risks

Beyond the items above, three classes of risk apply across the whole stack:

1. **Cost observability.** No tracking of cost-per-account (CPU, DB, vendor API costs where applicable like X premium). Required to price tiers correctly.
2. **No graceful queue draining on worker shutdown.** Worker SIGTERM today drops in-flight jobs (BullMQ marks them `failed`), causing duplicate work on next pickup.
3. **No multi-region story.** Single-region deployment means EU users have higher latency; future GDPR data-residency requirements are not addressable without rearchitecture.

---

## What is NOT a scalability gap (for clarity)

- The hexagonal-port `PlatformAdapter` interface is sound — adding new platforms is an adapter-only change.
- BullMQ on Redis is a good fit for the job model and scales horizontally.
- The `(account, product)` cadence model maps cleanly to per-tenant scheduling.
- `sync_jobs.nextRunAt` + scheduler tick is a well-understood pattern; the scaling fixes (B1, A3) preserve it.
- The MongoDB raw-response archive pattern with content hashing is the right shape, just needs TTL/S3 offload.

---

## Where this came from

Compiled from direct inspection of the codebase, the operational report dated 2026-04-27, real-world failure modes hit during the PoC (the 4-hour offline window, the duplicate-worker job collision on 2026-04-27 morning), and standard scalability patterns for multi-tenant API connectors.

Open the companion plan: [`scalability-plan.md`](scalability-plan.md).
