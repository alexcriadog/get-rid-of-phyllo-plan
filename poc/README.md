# Connector PoC

Proof-of-concept replacement for Phyllo/InsightIQ. Three-process NestJS service (api / worker / scheduler) with platform adapters for Instagram and Facebook, and a Next.js admin dashboard that visualises rate limits, cadences, sync queue, webhooks and the raw platform responses.

Full playbook: [`../IMPLEMENTATION.md`](../IMPLEMENTATION.md). Design docs: [`../docs/`](../docs/).

---

## What's in here

| Path | What |
|---|---|
| `src/main.ts` | argv dispatch — `api` / `worker` / `scheduler` share the same image |
| `src/modules/platforms/` | `PlatformAdapter` port + Instagram + Facebook |
| `src/modules/sync/` | scheduler (every 30s), worker, cadence resolver, throttle locks |
| `src/modules/webhooks/` | Meta webhook ingest with HMAC-SHA256 verification |
| `src/modules/api/` | `POST /v1/accounts/:id/refresh` (HIGH priority + 60s anti-spam) |
| `src/modules/admin/` | ~30 read/write endpoints for the dashboard |
| `src/shared/redis/rate-bucket.service.ts` | token-bucket in Redis via atomic Lua |
| `src/shared/metrics/` | counters + 60min bucket history + recent-calls ring |
| `prisma/schema.prisma` | 7 tables (accounts, oauth_tokens, sync_jobs, cadences, account_cadences, inbound_webhook_log, api_call_log) |
| `web/` | Next.js 14 UI — public `/account/*` + 10 admin pages |
| `docker-compose.yml` | MySQL 8 + MongoDB 7 + Redis 7-alpine |

---

## Prerequisites

- **Node 20+**, **Docker Desktop** (or OrbStack), **ngrok** (for webhooks), **git**.
- **Meta app in Live mode** with these permissions approved:
  `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`, `read_insights`, `business_management`, `pages_read_user_content`.
- **IG Business account** linked to a FB Page you admin.
- **Long-lived Page access token** for that IG Business (generate via Graph API Explorer → "Get Page Access Token" → exchange for long-lived).
- Optionally a second FB Page access token for the Day 6 Facebook drop-in demo.

---

## First-time setup

```bash
cd poc

# 1. Install
npm install

# 2. Start the databases
docker compose up -d
docker compose ps          # all 3 should be healthy

# 3. Configure env
cp .env.example .env
openssl rand -hex 32       # paste as LOCAL_AES_KEY in .env
# Also set META_APP_ID, META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN in .env

# 4. Generate Prisma client + run migrations
npx prisma generate
npx prisma migrate dev --name init

# 5. Seed the cadences table (idempotent)
npm run seed
```

---

## Seed an Instagram account

No OAuth flow in the PoC — you give it the access token directly.

Option A — CLI:
```bash
SEED_IG_TOKEN="<long-lived-page-token>" \
SEED_IG_BUSINESS_ID="<17841...>" \
SEED_IG_HANDLE="@yourhandle" \
SEED_IG_PAGE_ID="<page-id>" \
npm run seed
```

Option B — HTTP (admin endpoint, useful once the API is running):
```bash
curl -X POST http://localhost:3000/admin/seed-account \
  -H 'Content-Type: application/json' \
  -d '{
    "platform": "instagram",
    "access_token": "<token>",
    "canonical_user_id": "<17841...>",
    "handle": "@yourhandle",
    "metadata": {"page_id": "<page-id>"}
  }'
```

For a Facebook Page, same shape but `"platform": "facebook"`. FB accounts get 3 sync jobs (identity, audience, engagement_new) — no stories.

---

## Run the three processes

Each in its own terminal:

```bash
npm run dev:api          # listens on :3000
npm run dev:scheduler    # ticks every 30s, enqueues due jobs
npm run dev:worker       # consumes BullMQ, calls platform APIs
```

When a seeded account has `sync_jobs.next_run_at <= NOW()`:
1. Scheduler picks them up → enqueues BullMQ HIGH/NORMAL
2. Worker acquires throttle lock (10min) + rate bucket → decrypts token → calls Graph API → persists to Mongo + updates `api_call_log`
3. On success, `sync_jobs.next_run_at` is recomputed via cadence (default × sync_tier multiplier, or per-account override)

---

## Webhooks (Day 3)

1. `ngrok http 3000` and copy the https URL
2. In the Meta app dashboard → Webhooks:
   - Callback URL: `https://<ngrok>.ngrok-free.app/webhooks/ingest/meta`
   - Verify Token: same value as `META_WEBHOOK_VERIFY_TOKEN` in `.env`
   - Click "Verify and save" (our `GET /webhooks/ingest/meta` echoes the challenge)
   - Subscribe Instagram to: media, comments, mentions, story_insights
   - Subscribe Page to: feed, videos, live_videos
3. In Graph API Explorer: `POST /<page-id>/subscribed_apps?subscribed_fields=feed`
4. Post a new story / publish a reel — watch `/admin/webhooks` page + worker logs.

---

## Run the UI

```bash
cd web
cp .env.local.example .env.local   # MONGO_URL + CONNECTOR_API_URL already correct
npm install
npm run dev
```

Open http://localhost:3001 — public views. Admin dashboard at http://localhost:3001/admin. Both poll every 2 seconds.

Admin pages:

| URL | What it shows |
|---|---|
| `/admin` | KPIs + per-platform gauges + last 10 API calls |
| `/admin/rate-limits` | Live token gauge + 60min sparkline + hits/denies + inject-20 button + reset |
| `/admin/cadence` | Editable defaults, account tiers, per-product overrides, hourly projection |
| `/admin/next-runs` | 24h timeline of scheduled jobs per account |
| `/admin/accounts` | Product × account matrix with freshness colours |
| `/admin/calls` | Filtered api_call_log with headers drift detection |
| `/admin/throttle-locks` | Active locks + force-release |
| `/admin/webhooks` | Inbound log + signature validity + silence detector + replay |
| `/admin/events` | Internal `event_log` (events emitted by the worker) |
| `/admin/raw` | Raw platform response blobs (Mongo is S3-sim in PoC) |
| `/admin/support-matrix` | Adapter capability heatmap per platform × product × field |

---

## Inspecting the data

```bash
# MySQL (Prisma Studio)
npm run prisma:studio    # opens http://localhost:5555

# MySQL (CLI)
docker compose exec mysql mysql -uconnector_user -pconnector_pw connector

# MongoDB
docker compose exec mongo mongosh connector_ui
> db.posts.countDocuments()
> db.raw_platform_responses.findOne()

# Redis
docker compose exec redis redis-cli
> KEYS connector-poc:*
> HGETALL connector-poc:rate:ig:app
```

---

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| `docker compose up` fails with permission errors | Docker daemon not running | Start Docker Desktop / OrbStack |
| `prisma migrate dev` fails with "Shadow database permission denied" | `connector_user` lacks CREATE/DROP globally | `GRANT ALL PRIVILEGES ON *.* TO 'connector_user'@'%' WITH GRANT OPTION;` in MySQL |
| Webhook returns 403 to Meta challenge | `META_WEBHOOK_VERIFY_TOKEN` mismatch | Copy the exact same string in `.env` and Meta dashboard |
| Sync jobs fail with 400 from Graph API | Placeholder or expired token | Re-seed with a fresh long-lived token |
| Rate bucket always full | Worker bypassing `acquire()` or hit counter not wired | Check adapter's `callGraph` helper wraps every external call |
| Admin UI stuck on "Connector API unreachable" | API process not running | `npm run dev:api` |
| ngrok URL changes after restart | Free-tier default | Update Meta webhook callback URL in the dashboard (or pay for a static domain) |

---

## Teardown

```bash
# Stop the node processes (Ctrl-C in each terminal)
docker compose down -v    # drops all database volumes
rm -rf node_modules web/node_modules web/.next dist
```

---

## Scripts

```
npm run dev:api          # run API (port 3000)
npm run dev:worker       # run BullMQ worker
npm run dev:scheduler    # run sync scheduler (30s tick)
npm run seed             # idempotent: cadences + optional account
npm run prisma:studio    # browse MySQL visually
npm run prisma:migrate   # apply new migrations
npm run prisma:generate  # regenerate client after schema change
npm run lint             # tsc --noEmit
npm run build            # compile to dist/
npm run docker:up        # start MySQL + Mongo + Redis
npm run docker:down      # stop
npm run docker:reset     # wipe volumes and restart
```

---

## Project status

- [x] **Day 1** — infra, Prisma, seed, minimal NestJS boot
- [x] **Day 2** — PlatformAdapter port, Instagram adapter, rate bucket, BullMQ worker, cadence resolver
- [x] **Day 3** — manual refresh endpoint, Meta webhook ingest with HMAC verification
- [x] **Day 4** — public Next.js UI reading Mongo directly
- [x] **Day 5** — admin dashboard (10 pages, ~30 API endpoints, 2s polling)
- [x] **Day 6** — Facebook adapter drop-in (3 files, +822 lines, zero changes to sync/worker/webhooks/admin/UI)
- [x] **Day 7** — polish (this README)

See `git log --oneline` for the per-day commits.
