# Production Readiness Assessment — `poc` + `connect-tool`

**Date:** 2026-06-01
**Scope:** `poc` (NestJS backend: api / worker / scheduler + Next.js admin) and `connect-tool` (Next.js OAuth helper + embeddable SDK)
**Method:** Static investigation of the codebase. The highest-severity findings (CRITICAL-1/2/3, CORS, Caddy routing, global guard) were verified directly against the source; remaining items are flagged with confidence level.

---

## Verdict

The architecture is solid and well-engineered for something labelled a "PoC": atomic Lua rate-limiting, a sync circuit breaker, outbound webhooks with retry/backoff/SSRF protection, and real multi-tenancy. **It is not production-ready yet.** Blockers:

- 1 internet-reachable unauthenticated endpoint (CRITICAL-1).
- No proactive OAuth token refresh — tokens die silently.
- No database backups; single-host, no HA.
- Non-durable Redis with `allkeys-lru` eviction backing the job queues — silent job loss.
- No GDPR erasure path.

With ~2–3 weeks of focused work this is launchable. The roadmap at the end sequences the work.

---

## 1. Scaling & Capacity

### Bottleneck ranking (worst first)

| # | Limit | Capacity | Nature |
|---|-------|----------|--------|
| 1 | **YouTube quota** — 10,000 units/day per GCP project (`youtube.rate-limit.strategy.ts:18`) | ~8 accounts (hourly cadence) / ~200 (daily) | Hard external wall. Scales only by adding GCP projects + sharding the bucket key (currently project-global `rate:yt:daily_quota:{date}`) |
| 2 | **Single worker** — concurrency default 4 (`sync.worker.ts:41`) | 24–120 jobs/min → ~360–2,160 accounts at hourly cadence | Fixed by running N workers — **safe** (see below) |
| 3 | **Threads** — 200/h per app (`threads.rate-limit.strategy.ts:36`) | ~66 accounts hourly / ~1,600 daily | App-global, not shardable without multiple apps |
| 4 | **MySQL connections** — Prisma pool unconfigured | exhausts `max_connections` (~151) at ~15 processes | `connection_limit` not set on `DATABASE_URL` |
| 5 | **Scheduler** — `MAX_ROWS_PER_TICK=500` hardcoded + singleton with no lock (`scheduler.service.ts:14`) | 1,000 jobs/min ceiling + availability SPOF | Cron digest got a Redis lock; the scheduler did not |

### Horizontal scaling readiness

- **Workers scale linearly and safely.** Throttle locks (`SET NX EX`), rate buckets (atomic Lua), and BullMQ `jobId` dedup coordinate correctly across instances. `WORKER_CONCURRENCY` is env-configurable (`sync.worker.ts:195`).
- **The scheduler MUST run as a singleton.** It has no distributed lock — only in-process `inFlight` (`scheduler.service.ts:122`). Two schedulers double-enqueue because the `status:'queued'` write bumps `updatedAt`, producing two distinct BullMQ jobIds and defeating dedup.
- **`MAX_ROWS_PER_TICK=500` is hardcoded** (not env-overridable, unlike tick interval and backpressure) — a non-obvious 1,000 jobs/min governor regardless of worker count.

### Per-platform rate limits

| Platform | Buckets | Binding constraint |
|----------|---------|--------------------|
| YouTube Data API | `daily_quota` 10,000 units/day (project-global) | **Hardest wall** — ~8 accts hourly / ~200 daily per project. `search.list` costs 100 units and would halve this if used. |
| YouTube Analytics | 720/100s project, 60/100s user | Doesn't draw Data-API units |
| TikTok | 10 QPS app; 1,000/day per user token; 5,000/day business | Per-account 1,000/day (≈50 syncs/day/account) |
| Twitch | 800/min app; 400/min user | Generous (~1.15M/day app) |
| Threads | 200/h app + 200/h user + 200/h user-token | **200/h app-global** — severe |
| Facebook / Instagram | No local bucket; gated by BUC mirror at 75% of Meta-reported usage (`buc-telemetry.service.ts:35`), scheduler preflight defers at 90% | Scales with installed user base. **Fails open if Redis down** |

### Storage growth

- **Mongo `raw_platform_responses`** (heaviest writer): ~1–3 MB/account/day → **140–420 GB at 10k accounts, 1.4–4.2 TB at 100k** (14-day retention). The S3 offload path exists but is **stubbed and unused** (`s3uri_stub: null` in `graph-raw-archive.ts`). Wire S3 before 100k.
- **MySQL `api_call_log`**: ~48M rows at 10k accounts, ~480M at 100k (30-day retention). Indexed; retention sweep runs long at the high end.
- **Redis**: ~30–60 MB at 10k accounts, ~200–400 MB at 100k. Two issues:
  - **Leak:** daily-counter keys `rate:*:{YYYY-MM-DD}` are written via `HMSET` with **no EXPIRE** (`rate-bucket.service.ts:115`) → past-date keys accumulate forever.
  - **Hot path:** `metrics.tickSnapshot` runs `listAllBuckets()` (`SCAN` of all `rate:*` keys) every 10s — O(all keys), expensive past ~300k keys.

### Connection pools (unset = risk)

- **Prisma**: no `connection_limit` → default `num_cpus*2+1` per process. 1 api + 1 scheduler + 8 workers ≈ 90 connections; MySQL default `max_connections` is 151. Set it explicitly before scaling workers.
- **Mongo**: only `serverSelectionTimeoutMS` set (`mongo.service.ts:44`); no `maxPoolSize` → driver default 100/process.

---

## 2. Security Findings

Severity scale: CRITICAL (block) / HIGH (fix before launch) / MEDIUM / LOW. ✅ = verified directly against source.

### 🔴 CRITICAL

**C-1 — `POST /v1/accounts/:id/refresh` is unauthenticated and internet-reachable** ✅
`ManualRefreshController` (`manual-refresh.controller.ts:54`) is `@Controller()` with **no `@UseGuards`**. The only global `APP_GUARD` is `InternalAuthGuard`, which no-ops on everything except `/internal/*` (`app.module.ts:58`). The Caddyfile routes `handle_path /api/poc/*` straight through to `api:3000` with **no basic_auth** (`tools/Caddyfile:35`). So `POST https://<host>/api/poc/v1/accounts/123/refresh` triggers sync jobs on any account (IDs are sequential BigInts, enumerable) across all tenants without credentials. The sibling `V1AccountsController` *is* guarded (`v1-accounts.controller.ts:71`) — this controller was simply left without the decorator.
**Fix:** add `@UseGuards(BearerApiKeyGuard)` + a `account.workspaceId === req.workspace.workspaceId` check (→ 404 otherwise). One-line guard + scope check.

**C-2 — `connect-tool` never verifies the OAuth `state` parameter (CSRF / code-injection)** ✅
`state` is generated on the authorize URLs (`lib/platforms.ts`) but the callback (`app/api/oauth/[...slug]/route.ts:231-293`) reads `ws/token/origin/embed/error/code` and **never `state`** — verified by grep. No stored-vs-returned comparison exists. PKCE is implemented for no platform. This is the classic OAuth authorization-code injection vector.
**Fix:** store `state` in the session/cookie at `start`, require an exact match at `callback`.

**C-3 — `POST /admin/connect/discover` returns live `page_access_token` in the response body** ✅
`admin.service.ts:2040,2066,2108` return Meta long-lived Page tokens in the JSON body. This endpoint *is* behind Caddy basic_auth (so not open to the internet), but OAuth tokens must never travel in a response body — they leak into proxy logs, browser history, and observability pipelines.
**Fix:** return only derived data (page name, IG id, already-connected flag); accept the token only as input to `/admin/connect/seed`.

### 🟠 HIGH

- **H-1 — CORS accepts any `localhost:*` origin** ✅ (`main.ts:40`, `/localhost:\d+$/`). Fine for dev, wrong for prod; any local service on a developer's machine can make cross-origin requests to the production API. Replace with an explicit allow-list.
- **H-2 — `CONNECT_TOOL_SECRET` permissive-when-unset.** Both `internal-auth.guard.ts:55` and `connect-tool.guard.ts:37` return `true` (allow all) when the secret is empty, with only a warning. The same default exists in connect-tool's `poc-internal.ts:14`. No startup validation. A misconfig silently opens `/internal/*` and `/admin/connect/*`.
- **H-3 — Inbound Meta webhook silently breaks if `META_APP_SECRET` is unset** (`webhooks-ingest.controller.ts:205`): `verifySignature` returns `false` for everything → all legitimate webhooks rejected, no startup check. (The HMAC verification itself is correct.)
- **H-4 — `PlatformErrorFilter` leaks the upstream error body and `endpoint` URL to the client** (`platform-error.filter.ts:77-85`) and logs the endpoint (`:74`). If a platform embeds `access_token=` in the URL (Meta/TikTok historically did), the token leaks to clients and logs.
- **H-5 — SDK JWT has no `jti`/single-use enforcement** (`sdk-tokens.service.ts:261`) — fully replayable for its TTL (up to 30 min). The `origins` claim mitigates only when the workspace has configured an allow-list, which is not the default.
- **H-6 — POC trusts caller-supplied `workspace_slug`/`workspace_id`** in `seedConnection` (`admin.service.ts:2471`) with a single shared secret → any holder of `CONNECT_TOOL_SECRET` can seed accounts into any tenant. The secret is the entire trust boundary and is not per-workspace.
- **H-7 — `/admin/*` has no application-layer auth** — protected only by Caddy basic_auth (a single shared credential). The dev `docker-compose.yml` publishes `3000:3000`; if port 3000 is ever reachable directly in prod, the entire admin surface (issue API keys, read tokens, enumerate tenants) is open. **Confirm the prod compose does not publish 3000 to the host**, and add an app-level guard as defence in depth.

### 🟡 MEDIUM / LOW (condensed)

- `listEvents` builds a Mongo query object from a free-text `account_id` query param without an explicit string cast — verify Express `qs` nested parsing is off (NoSQL-injection surface).
- `sync_job.settings` PATCH accepts arbitrary JSON keys (no allow-list) — mass-assignment, admin-only.
- `discoverConnections` queries accounts across all workspaces with no `workspaceId` filter → cross-tenant existence oracle (`admin.service.ts:2081`).
- No application-layer rate limiting on any `/admin/*` endpoint; `webhookSilence()` does N×M sequential queries (`admin.service.ts:1332`).
- `META_WEBHOOK_VERIFY_TOKEN` has no startup validation (silent failure).
- `parseAesKey` error reveals decoded key length; `constantTimeEquals` duplicated across two guard files; `payloadSnippet` stored unfiltered (stored-XSS risk if the admin UI renders it unescaped).

### Security positives (already good)

AES-256-GCM token encryption with startup key validation (`aes-local.service.ts`), API keys SHA-256-hashed with constant-time compare, inbound HMAC verification correct, outbound webhook SSRF re-validation before each send, Caddy edge gating of `/admin*` and `/internal/*`.

---

## 3. Missing Functionality (launch blockers)

**B-1 — No proactive OAuth token refresh.**
Facebook/Instagram have no refresh logic at all (`facebook.tokens.ts` is a DI `Symbol`); Meta long-lived tokens (60 days) die silently. TikTok/Twitch/YouTube/Threads *do* have refresh services, but they run **only at fetch-time** — there is no cron scanning `OAuthToken.expiresAt`. A paused or quiet account misses its rotating-refresh window and becomes **unrecoverable** without re-auth. On hard token death the worker correctly flips the account to `needs_reauth`, emits an internal event, and fires the client `token.expired` webhook (`sync.worker.ts:399-414`) — the reactive path is good; the proactive path is missing.

**B-2 — Disconnect does not stop sync jobs or purge data.**
`disconnectAccount` (`accounts.service.ts:466`) sets `status='disconnected'` but the scheduler filter (`scheduler.service.ts:171`) excludes `paused`/`needs_reauth` — **not `disconnected`** → jobs keep enqueuing → worker finds no token → tight 30s failure loop until the breaker pauses (~5 ticks). Mongo data (posts/comments/raw) is **never purged**.

**B-3 — No GDPR right-to-erasure or data export.**
`DELETE /v1/accounts/:id` is just a soft disconnect (`v1-accounts.controller.ts:248`). No hard-delete erasing the Prisma account + tokens + all Mongo documents. Prisma cascades cover MySQL only — Mongo documents are orphaned. Blocker for EU customers.

**B-4 — Redis is non-durable with `allkeys-lru` eviction.**
Prod compose (`tools/docker-compose.prod.yml`): `--appendonly no`, `--maxmemory 96mb`, `--maxmemory-policy allkeys-lru`. Redis backs the BullMQ sync + delivery queues, rate buckets, and cron locks. A restart or memory pressure can **silently evict live queue keys** → dropped jobs/deliveries. Sync jobs partially recover via `nextRunAt` in MySQL; queued-but-not-yet-retried webhook deliveries do not. **Fix:** `appendonly yes` (or RDB) and `noeviction` on the queue Redis.

**B-5 — No backups, single-host, no HA.**
MySQL + Mongo + Redis co-located on one EC2 (t4g.medium) with local Docker volumes. No `mysqldump`/`mongodump`/snapshots anywhere in `tools/`. A disk/host failure loses all tenant data, tokens, and history. Additionally, `redeploy.sh:50` runs `db push --accept-data-loss` as a fallback on **every** deploy — a foot-gun that can drop columns on schema drift.

---

## 4. Data-Pipeline Edge Cases (important, not blocking)

- **Pagination capped at 500 posts/sync** with no continuation (`sync.worker.ts:80`) → older content never ingested.
- **Deleted platform content is never removed** from Mongo (upsert-only, no tombstoning) → stale data served to clients.
- **Handle/username changes** never update Prisma `account.handle`/`displayName` (identity writes only to Mongo) — stale until reconnect.
- **No-token failure path leaves `nextRunAt` in the past** (`markJobFailed`, `sync.worker.ts:837`) → 30s tight loop until the breaker trips.
- **Daily digest** fires once at 09:05 UTC on the `api` process only; if api is down at that minute, daily digests slip ~24h.
- **Cross-store cascade gap:** deleting a Workspace/Account leaves Mongo documents orphaned.

What's already correct: idempotent Mongo upserts (keyed on `(account_id, platform_content_id)`), circuit breaker with exponential backoff + auto-pause (`MAX_CONSECUTIVE_FAILURES=5`), orphan sweep for crashed workers, rate-limit handling with proportional jitter, graceful shutdown (`tini` + `worker.close()`).

---

## 5. Observability, Ops & Tests

- **Metrics are in-memory, per-process, not exported.** `MetricsService` resets on restart and does not aggregate across api/worker/scheduler. No Prometheus/OTel endpoint. Durable signal lives only in MySQL `api_call_log`.
- **No alerting** (no Sentry/PagerDuty/Slack/SNS). An operator only learns of an outage or mass token expiry by opening the dashboard.
- **Worker and scheduler expose no HTTP** — no direct health probe; orchestrators rely on a DB-heartbeat proxy in the admin endpoint. `/admin/healthz` is static and behind admin auth (not a clean liveness probe).
- **No CI/CD** (`redeploy.sh` does `git reset --hard origin/main` + rebuild — no test/lint/build gate).
- **Secrets in plaintext `.env`**; MySQL passwords hardcoded weak literals in `docker-compose.yml:42` (`rootpw`, `connector_pw`); no rotation story.
- **Test coverage ~11%** (23 test files / 206 sources). The two most critical files — `sync.worker.ts` and `scheduler.service.ts` — have **no tests**. No backend e2e/integration of the connect→schedule→fetch→persist→webhook pipeline. (connect-tool has Playwright e2e + unit tests, but its OAuth dispatcher `route.ts` is untested.)

Already production-grade: `/admin/system/health` with real MySQL/Mongo/Redis pings + worker heartbeat, `/admin/system/config` runtime introspection, graceful shutdown, log rotation + per-service memory limits + compiled-JS prod runtime, idempotent migration baselining.

### Platform completeness

All 6 adapters are real, not stubs. Facebook is the most complete (profile, content, audience, comments, mentions, stories, ratings, ad insights). Instagram, YouTube, TikTok, Threads each implement most products. **Twitch is profile+content only — by Helix API design**, honestly documented in `twitch.support-matrix.ts`; its `fetchAudience()` returns empty arrays purely to satisfy the port contract. Unsupported products return `null` and the cadence still advances. No concerning TODO/FIXME/"not implemented" markers across `poc/src` or `connect-tool` — only the documented Twitch stub and the unwired S3 archive offload.

---

## 6. Prioritized Roadmap to Production

### Week 1 — Security (cheap, high-impact blockers)
- [ ] **C-1**: add `@UseGuards(BearerApiKeyGuard)` + workspace scope check to `ManualRefreshController`
- [ ] **C-2**: store + verify OAuth `state` in connect-tool callback
- [ ] **C-3**: remove `page_access_token` from `/admin/connect/discover` response
- [ ] **H-1**: explicit CORS allow-list (drop the `localhost:*` regex for prod)
- [ ] **H-2/H-3**: fail-fast at startup if `CONNECT_TOOL_SECRET` / `META_APP_SECRET` / `META_WEBHOOK_VERIFY_TOKEN` / `LOCAL_AES_KEY` are missing in non-dev `NODE_ENV`
- [ ] **H-7**: add an app-level guard for `/admin/*`; confirm port 3000 is not published to the host in prod

### Week 2 — Data resilience (blockers)
- [ ] **B-1**: token-refresh cron scanning `OAuthToken.expiresAt` (incl. Meta 60-day re-exchange)
- [ ] **B-2**: exclude `disconnected` from the scheduler filter; stop/cancel sync jobs on disconnect
- [ ] **B-3**: GDPR hard-delete (Prisma + tokens + all Mongo collections) + per-end-user export
- [ ] **B-4**: queue Redis → `appendonly yes` + `noeviction`
- [ ] **B-5**: automated backups (mysqldump + mongodump → S3) with a tested restore; remove the `db push --accept-data-loss` fallback from `redeploy.sh`

### Week 3 — Ops & scale hardening
- [ ] Set Prisma `connection_limit` and Mongo `maxPoolSize`
- [ ] Distributed lock on the scheduler (reuse `cron-lock.ts`); make `MAX_ROWS_PER_TICK` env-configurable
- [ ] `/metrics` (Prometheus) endpoint + basic alerting (tokens expiring en masse, 5xx spike, queue depth)
- [ ] Health/readiness probes on worker and scheduler processes
- [ ] Tests for `sync.worker` + `scheduler` + one backend e2e of the full pipeline; CI/CD with build+test gate
- [ ] Add EXPIRE to daily-counter Redis keys (fix the leak); review the 10s `listAllBuckets` SCAN cost

### Backlog (nice-to-have)
- [ ] Wire the S3 raw-archive offload before scaling Mongo past ~100k accounts
- [ ] Dead-letter queue / poison-job triage workflow
- [ ] Admin-action audit log
- [ ] Content tombstoning / reconciliation for deleted platform content; pagination continuation past 500 posts
- [ ] Client webhook idempotency-key contract + ordering documentation

---

## Appendix — Key file references

| Concern | File |
|---------|------|
| Scheduler (singleton, backpressure, preflight) | `poc/src/modules/sync/scheduler.service.ts` |
| Sync worker (circuit breaker, persistence) | `poc/src/modules/sync/sync.worker.ts` |
| Rate buckets (Lua) | `poc/src/shared/redis/rate-bucket.service.ts` |
| Token crypto | `poc/src/shared/crypto/aes-local.service.ts` |
| Auth guards | `poc/src/common/guards/*.guard.ts`, `poc/src/shared/auth/internal-auth.guard.ts`, `poc/src/modules/admin/connect-tool.guard.ts` |
| Unauthenticated refresh (C-1) | `poc/src/modules/api/manual-refresh.controller.ts` |
| CORS (H-1) | `poc/src/main.ts:40` |
| Token-in-body (C-3) | `poc/src/modules/admin/admin.service.ts:2040` |
| Inbound webhook HMAC | `poc/src/modules/webhooks/webhooks-ingest.controller.ts` |
| Outbound webhooks (retry/SSRF) | `poc/src/modules/outbound-webhooks/*` |
| OAuth dispatcher (C-2) | `connect-tool/app/api/oauth/[...slug]/route.ts` |
| Embeddable SDK | `connect-tool/sdk/src/index.ts` |
| Edge routing / admin gating | `tools/Caddyfile` |
| Prod deploy script | `tools/redeploy.sh` |
| Schema + cascades | `poc/prisma/schema.prisma` |
