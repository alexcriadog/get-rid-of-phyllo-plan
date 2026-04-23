# PoC — Implementation Playbook

**Scope:** this document is **only** the Proof-of-Concept. Deep architecture and future-state design live in [`docs/`](docs/). Here: exact steps to build a working PoC in 7 days.

**PoC goal:** exercise the core loop — adapter port, rate buckets, scheduler, manual refresh, webhooks — with Instagram and Facebook, using **access tokens provided directly by the operator** (no OAuth flow in PoC). The payoff is a rich **admin dashboard** that makes rate limits, cadences, next executions, and internal state visible and tunable in real time.

---

## 0. Before you start

### 0.1 Tools to install locally

| Tool | Version | How |
|---|---|---|
| Node.js | 20 LTS | nvm + `nvm install 20` |
| Docker Desktop | latest | https://www.docker.com/ |
| git | any | usually already installed |
| ngrok | free tier | https://ngrok.com/download |

Verify:
```bash
node --version
docker --version
docker compose version
ngrok --version
```

### 0.2 What the operator (you) provides

**No OAuth flow in PoC.** You hand the access token straight to the PoC via a seed script or an admin endpoint.

For Instagram (Day 1-2 testing):
- `META_APP_ID`, `META_APP_SECRET` (for webhook signature verification; not used to OAuth)
- `IG_ACCESS_TOKEN` — a long-lived Page access token for the IG Business you own
- `IG_BUSINESS_ACCOUNT_ID` — your IG Business canonical ID
- `FB_PAGE_ID` — the FB Page linked to that IG account
- Scope set confirmed in the token: `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`, `business_management`

For Facebook (Day 6 testing):
- `FB_ACCESS_TOKEN` — Page access token for any Page you admin
- `FB_PAGE_ID` — that Page's ID

How to grab a Page access token fast, without implementing OAuth: use Meta's Graph API Explorer (https://developers.facebook.com/tools/explorer/), select your app, select "Page Access Token", pick the Page, and copy the token. Exchange to long-lived via `GET /oauth/access_token?grant_type=fb_exchange_token&fb_exchange_token=<short>` so it doesn't expire during the PoC week.

### 0.3 Meta app configuration — webhooks only

Webhooks still need the Meta app to be configured (one-time, by you):

1. **App settings → Webhooks:**
   - Callback URL: `https://<your-ngrok-domain>/webhooks/ingest/meta` (set on Day 3 after ngrok is up)
   - Verify Token: any random 32+ char string you generate; same value goes in `.env` as `META_WEBHOOK_VERIFY_TOKEN`
2. **Subscribe Instagram object to:** `media`, `comments`, `mentions`, `story_insights`
3. **Subscribe Page object to:** `feed`, `videos`, `live_videos`
4. **Activate per-page subscription** (normally done by OAuth; for PoC do it manually): in Graph API Explorer, `POST /<page-id>/subscribed_apps?subscribed_fields=feed&access_token=<page_token>`

That's it — no App Review, no dev-mode users, no OAuth flow.

---

## 1. Project structure

```
get-rid-of-phyllo/
├── context/                   (existing, untouched)
├── docs/                      (existing, untouched)
├── IMPLEMENTATION.md          (this file)
├── .gitignore                 (NEW at root)
└── poc/                       (NEW — all PoC code)
    ├── README.md
    ├── package.json
    ├── tsconfig.json
    ├── .env.example
    ├── .env                   (gitignored)
    ├── docker-compose.yml
    ├── prisma/
    │   ├── schema.prisma
    │   └── seed.ts
    ├── src/
    │   ├── main.ts            # argv-based dispatch: api | worker | scheduler
    │   ├── app.module.ts
    │   ├── modules/
    │   │   ├── platforms/
    │   │   │   ├── shared/
    │   │   │   │   ├── platform-adapter.port.ts
    │   │   │   │   └── platform-types.ts
    │   │   │   ├── instagram/
    │   │   │   │   ├── instagram.adapter.ts
    │   │   │   │   └── instagram.module.ts
    │   │   │   └── facebook/                    (Day 6)
    │   │   ├── accounts/              # seed, list, disconnect
    │   │   ├── sync/                  # scheduler + worker
    │   │   ├── webhooks/              # inbound Meta webhooks
    │   │   ├── api/                   # internal REST for UI
    │   │   ├── admin/                 # admin endpoints + stats
    │   │   └── events/                # outbound (logged to Mongo in PoC)
    │   └── shared/
    │       ├── database/
    │       │   ├── prisma.service.ts
    │       │   └── mongo.service.ts
    │       ├── redis/
    │       │   ├── redis.service.ts
    │       │   ├── bullmq.service.ts
    │       │   └── rate-bucket.service.ts
    │       ├── crypto/
    │       │   └── aes-local.service.ts   # AES-256-GCM with .env key
    │       ├── metrics/                    # in-memory metrics for admin
    │       └── config/
    └── web/                              # Next.js UI
        ├── package.json
        ├── next.config.js
        ├── pages/
        │   ├── index.tsx
        │   ├── account/[id].tsx
        │   ├── account/[id]/posts.tsx
        │   └── admin/
        │       ├── index.tsx              # overview
        │       ├── rate-limits.tsx
        │       ├── cadence.tsx
        │       ├── next-runs.tsx
        │       ├── accounts.tsx
        │       ├── calls.tsx
        │       ├── webhooks.tsx
        │       ├── events.tsx
        │       ├── raw.tsx
        │       └── support-matrix.tsx
        └── lib/
            └── mongo.ts                   # direct Mongo read
```

---

## Day 1 — Infra + seed an account

**Goal:** databases up, schema migrated, a seeded account row in MySQL with an encrypted token and its first `sync_jobs` created.

### 1.1 Repo init (operator, ~5 min)
```bash
cd /Users/alexcriadogonzalez/Camaleonic/get-rid-of-phyllo
git init
```

Create `.gitignore` at root:
```gitignore
.env
.env.local
node_modules/
poc/node_modules/
poc/web/node_modules/
dist/
poc/dist/
poc/web/.next/
.DS_Store
.vscode/
.idea/
*.log
```

```bash
git add .gitignore context/ docs/ IMPLEMENTATION.md
git commit -m "Initial: context, docs, implementation playbook"
```

### 1.2 Scaffold poc/ (agent, ~30 min)
```bash
mkdir -p poc/src/{modules/{platforms/{shared,instagram,facebook},accounts,sync,webhooks,api,admin,events},shared/{database,redis,crypto,metrics,config}}
mkdir -p poc/prisma poc/web/{pages/admin,lib}
cd poc
npm init -y
```

Install:
```bash
npm install @nestjs/core @nestjs/common @nestjs/platform-express \
  @nestjs/config @nestjs/schedule \
  prisma @prisma/client mongodb \
  bullmq ioredis \
  axios zod ulid \
  reflect-metadata rxjs

npm install -D typescript ts-node @types/node @types/express \
  @nestjs/cli @nestjs/testing jest @types/jest ts-jest
```

Package.json scripts:
```json
{
  "scripts": {
    "dev:api": "ts-node src/main.ts api",
    "dev:worker": "ts-node src/main.ts worker",
    "dev:scheduler": "ts-node src/main.ts scheduler",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "seed": "ts-node prisma/seed.ts"
  }
}
```

### 1.3 docker-compose.yml (agent, ~15 min)
```yaml
version: '3.9'
services:
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: rootpw
      MYSQL_DATABASE: connector
      MYSQL_USER: connector_user
      MYSQL_PASSWORD: connector_pw
    ports: ["3306:3306"]
    volumes: ["mysql_data:/var/lib/mysql"]
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 5s
      retries: 10

  mongo:
    image: mongo:7
    ports: ["27017:27017"]
    volumes: ["mongo_data:/data/db"]
    environment:
      MONGO_INITDB_DATABASE: connector_ui

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes: ["redis_data:/data"]

volumes:
  mysql_data:
  mongo_data:
  redis_data:
```

Start:
```bash
cd poc
docker compose up -d
docker compose ps
```

### 1.4 Prisma schema (agent, ~20 min)
`poc/prisma/schema.prisma` — slimmer than the full design doc since we skip OAuth-pending-state, and includes operational tables the admin UI will query:

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "mysql"; url = env("DATABASE_URL") }

model Account {
  id                   BigInt   @id @default(autoincrement())
  platform             String
  canonicalUserId      String   @map("canonical_user_id")
  handle               String?
  displayName          String?  @map("display_name")
  status               String   @default("ready")
  syncTier             String   @default("standard") @map("sync_tier")
  owningOrganizationId String   @default("demo") @map("owning_organization_id")
  connectedAt          DateTime @default(now()) @map("connected_at")
  disconnectedAt       DateTime? @map("disconnected_at")
  createdAt            DateTime @default(now()) @map("created_at")
  updatedAt            DateTime @updatedAt @map("updated_at")

  tokens    OAuthToken[]
  syncJobs  SyncJob[]
  overrides AccountCadenceOverride[]

  @@unique([platform, canonicalUserId])
  @@map("accounts")
}

model OAuthToken {
  id                    BigInt   @id @default(autoincrement())
  accountId             BigInt   @unique @map("account_id")
  accessTokenCiphertext Bytes    @map("access_token_ciphertext")
  scopes                Json
  expiresAt             DateTime? @map("expires_at")
  lastRefreshedAt       DateTime? @map("last_refreshed_at")
  createdAt             DateTime @default(now()) @map("created_at")
  account               Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@map("oauth_tokens")
}

model SyncJob {
  id            BigInt   @id @default(autoincrement())
  accountId     BigInt   @map("account_id")
  product       String
  status        String   @default("idle")
  priority      String   @default("NORMAL")
  nextRunAt     DateTime? @map("next_run_at")
  lastSuccessAt DateTime? @map("last_success_at")
  lastAttemptAt DateTime? @map("last_attempt_at")
  lastError     String?  @db.Text @map("last_error")
  failureCount  Int      @default(0) @map("failure_count")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")
  account       Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([accountId, product])
  @@index([status, nextRunAt])
  @@map("sync_jobs")
}

model Cadence {
  platform               String
  product                String
  defaultIntervalSeconds Int     @map("default_interval_seconds")
  updatedAt              DateTime @updatedAt @map("updated_at")
  @@id([platform, product])
  @@map("cadences")
}

model AccountCadenceOverride {
  accountId               BigInt   @map("account_id")
  product                 String
  overrideIntervalSeconds Int      @map("override_interval_seconds")
  reason                  String?
  createdAt               DateTime @default(now()) @map("created_at")
  expiresAt               DateTime? @map("expires_at")
  account                 Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@id([accountId, product])
  @@map("account_cadences")
}

model InboundWebhookLog {
  id              BigInt   @id @default(autoincrement())
  platform        String
  eventId         String   @map("event_id")
  receivedAt      DateTime @default(now()) @map("received_at")
  signatureValid  Boolean  @map("signature_valid")
  accountResolved Boolean  @default(false) @map("account_resolved")
  payloadSnippet  String?  @db.Text @map("payload_snippet")
  processed       Boolean  @default(false)

  @@unique([platform, eventId])
  @@index([receivedAt])
  @@map("inbound_webhook_log")
}

model ApiCallLog {
  id            BigInt   @id @default(autoincrement())
  platform      String
  endpoint      String
  method        String
  statusCode    Int      @map("status_code")
  durationMs    Int      @map("duration_ms")
  rateBucketKey String?  @map("rate_bucket_key")
  tokensBefore  Int?     @map("tokens_before")
  tokensAfter   Int?     @map("tokens_after")
  usageHeader   Json?    @map("usage_header")
  accountId     BigInt?  @map("account_id")
  calledAt      DateTime @default(now()) @map("called_at")

  @@index([calledAt])
  @@index([platform, calledAt])
  @@map("api_call_log")
}
```

### 1.5 Env + crypto key (agent + operator, ~5 min)
`poc/.env.example`:
```env
NODE_ENV=development
DATABASE_URL="mysql://connector_user:connector_pw@localhost:3306/connector"
MONGO_URL="mongodb://localhost:27017/connector_ui"
REDIS_URL="redis://localhost:6379"
API_PORT=3000

# Meta app (for webhook signature verification only in PoC)
META_APP_ID=<your_app_id>
META_APP_SECRET=<your_app_secret>
META_WEBHOOK_VERIFY_TOKEN=<random_32_char_string>

# Local crypto for tokens at rest (PoC only — replace with KMS in prod)
LOCAL_AES_KEY=<openssl_rand_hex_32>

# Ops
SCHEDULER_TICK_MS=30000
WORKER_CONCURRENCY=4
REDIS_NS=connector-poc
```

Copy + fill + generate key:
```bash
cp .env.example .env
openssl rand -hex 32   # paste output as LOCAL_AES_KEY
# Edit .env with META_* creds from your Meta app
```

### 1.6 Prisma migrate (agent, ~5 min)
```bash
npx prisma generate
npx prisma migrate dev --name init
```

### 1.7 Seed script (agent, ~45 min)
`poc/prisma/seed.ts`:
- Reads operator-provided token + canonical IDs from env vars: `SEED_IG_TOKEN`, `SEED_IG_BUSINESS_ID`, `SEED_IG_HANDLE`, `SEED_IG_PAGE_ID`
- Uses `aes-local.service.ts` to encrypt the token
- Inserts: `accounts` row, `oauth_tokens` row, and 4 `sync_jobs` rows (one per product: `identity`, `audience`, `engagement_new`, `stories`) with `next_run_at = NOW()`
- Seeds default `cadences` table (see §2.5 for values)

Operator runs:
```bash
SEED_IG_TOKEN="<your_long_lived_page_token>" \
SEED_IG_BUSINESS_ID="<17841...>" \
SEED_IG_HANDLE="@yourhandle" \
SEED_IG_PAGE_ID="<page_id>" \
npm run seed
```

Verify: `npx prisma studio` → `accounts` table has one row; `sync_jobs` has 4 rows.

### 1.8 Admin "seed account" HTTP endpoint (agent, ~30 min)
As an alternative to the CLI script:
```
POST /admin/seed-account
Body: {
  platform: 'instagram',
  access_token: '<token>',
  canonical_user_id: '17841...',
  handle: '@yourhandle',
  metadata: { page_id: '...', ... }
}
```
The admin UI Day 5 will expose a form for this — so you can seed a second account without editing env vars.

Commit:
```bash
git add poc/
git commit -m "Day 1: infra, schema, seed mechanism"
```

---

## Day 2 — PlatformAdapter + first sync

**Goal:** the seeded account auto-syncs every minute; Mongo fills with profile / audience / posts; rate bucket visibly drains and refills.

### 2.1 Define the port (agent, ~1h)
`src/modules/platforms/shared/platform-adapter.port.ts`:
```typescript
export interface PlatformAdapter {
  platform: string;
  rateLimitHints(): RateLimitHint[];
  supportMatrix(): SupportMatrix;

  fetchProfile(accessToken: string, canonicalId: string): Promise<ProfileData>;
  fetchAudience(accessToken: string, canonicalId: string): Promise<AudienceData>;
  fetchContents(accessToken: string, canonicalId: string, opts: FetchOpts): Promise<ContentData[]>;
  fetchStories?(accessToken: string, canonicalId: string): Promise<ContentData[]>;
}

export type RateLimitHint = {
  scope: string;
  keyTemplate: string;
  capacity: number;
  refillPerMs: number;
  costPerCall: number;
  strategy: 'token-bucket' | 'daily-counter';
};
```

No `exchangeCode`, `refreshToken`, etc. — PoC skips OAuth.

### 2.2 InstagramAdapter (agent, ~2h)
`src/modules/platforms/instagram/instagram.adapter.ts`:
- `fetchProfile`: `GET /{ig_business_id}?fields=username,name,biography,profile_picture_url,followers_count,follows_count,media_count`
- `fetchAudience`: `GET /{ig_business_id}/insights?metric=audience_gender_age,audience_country,audience_city&period=lifetime`
- `fetchContents`: `GET /{ig_business_id}/media?fields=id,caption,media_type,media_url,permalink,timestamp,insights.metric(impressions,reach,likes,comments,saves,shares)`
- `fetchStories`: `GET /{ig_business_id}/stories?fields=id,media_type,media_url,permalink,timestamp`

Every call:
1. Acquire rate bucket via `RateBucketService`
2. Make HTTP call with operator-provided access token
3. **Log to `api_call_log`** with duration, status, `X-App-Usage`, `X-Business-Use-Case-Usage`, `X-Page-Usage` headers, bucket tokens before/after
4. Store raw response blob to Mongo `raw_platform_responses` with hash + fetched_at
5. Return normalized data

Declared `rateLimitHints()`:
```typescript
[
  { scope: 'user_token', keyTemplate: 'rate:ig:user_token:{hash}', capacity: 200, refillPerMs: 0.0555, costPerCall: 1, strategy: 'token-bucket' },
  { scope: 'app', keyTemplate: 'rate:ig:app', capacity: 200, refillPerMs: 0.0555, costPerCall: 1, strategy: 'token-bucket' },
  { scope: 'page', keyTemplate: 'rate:ig:page:{page_id}', capacity: 200, refillPerMs: 0.0555, costPerCall: 1, strategy: 'token-bucket' }
]
```

### 2.3 RateBucketService (agent, ~2h)
`src/shared/redis/rate-bucket.service.ts`:
- Token-bucket algorithm in Redis using atomic Lua script
- `acquire(hints)` → `{ allowed: true, tokensRemaining } | { allowed: false, resetInMs }`
- Exposes `getState(platform)` → current tokens + refill rate + last N acquisitions (for admin UI)
- Metric counters: `acquire_total{scope, result}`, `acquire_wait_ms{scope}`
- Time-series snapshot: every 10s, snapshot all bucket states into an in-memory ring buffer (60 min) for the admin chart

### 2.4 Scheduler + BullMQ worker (agent, ~2h)
`src/modules/sync/scheduler.service.ts` — every 30s:
```
rows = prisma.syncJob.findMany({
  where: { nextRunAt: { lte: now }, status: 'idle' },
  orderBy: [{ priority: 'desc' }, { nextRunAt: 'asc' }],
  take: 500
});
for r in rows { bullmq.add('sync', r); prisma.syncJob.update({..., status: 'queued'}) }
```

`src/modules/sync/sync.worker.ts`:
```
on job 'sync':
  acquireThrottleLock(account, product, 600s)   -> skip if held
  acquireRateBuckets(adapter.rateLimitHints())  -> re-queue with delay if denied
  decryptToken(account)
  adapter.fetch{Profile|Audience|Contents}(token, canonicalId)
    -> log api_call_log row
    -> store raw to mongo
  persistToMySQL + persistToMongo   (posts, audience_snapshots, identity_snapshots)
  emitEvent (to mongo event_log — PoC)
  updateSyncJob(last_success_at, next_run_at = now + effective_cadence)
  releaseThrottleLock
```

### 2.5 Cadence resolution + defaults seeding (agent, ~1h)
`src/modules/sync/cadence.service.ts`:
```typescript
resolve(account, product):
  override = prisma.accountCadenceOverride.findUnique({...})
  if override && (!override.expiresAt || override.expiresAt > now):
    return now + override.overrideIntervalSeconds

  if account.syncTier === 'paused': return null  // don't schedule

  default = prisma.cadence.findUnique({platform, product}).defaultIntervalSeconds
  multiplier = TIER_MULTIPLIERS[account.syncTier]  // vip 0.5, standard 1, lite 2, demo 5
  return now + clamp(default * multiplier, 60, 7*86400)
```

Seed `cadences` table in `prisma/seed.ts`:

| platform | product | seconds | notes |
|---|---|---|---|
| instagram | identity | 21600 | 6h |
| instagram | audience | 86400 | 24h |
| instagram | engagement_new | 7200 | 2h |
| instagram | stories | 3600 | 1h |
| facebook | identity | 21600 | |
| facebook | audience | 86400 | |
| facebook | engagement_new | 7200 | |

### 2.6 Verify
Terminals:
```bash
npm run dev:api
npm run dev:scheduler
npm run dev:worker
```

Within ~2 min of starting + seeded account:
- `sync_jobs.last_success_at` populated
- Mongo `identity_snapshots`, `audience_snapshots`, `posts` populated
- Mongo `raw_platform_responses` has blobs
- `api_call_log` has rows with bucket deltas visible

```bash
docker compose exec mongo mongosh connector_ui
> db.posts.countDocuments()
> db.raw_platform_responses.findOne()
```

Commit:
```bash
git add poc/
git commit -m "Day 2: adapter port, Instagram adapter, rate buckets, sync worker, cadence resolver"
```

---

## Day 3 — Manual refresh + webhooks

**Goal:** webhooks from Meta trigger HIGH-priority fetches; manual refresh bypasses polling; everything is visible.

### 3.1 Manual refresh endpoint (agent, ~1h)
```
POST /v1/accounts/:id/refresh
Body: { products?: [...], reason?: string }
```
- Redis lock `manual_refresh:{account}:{product}` NX EX 60
- On acquired: enqueue BullMQ job with `priority: HIGH`
- Return 202 with `{ account_id, jobs: [...], throttled: [...], rate_limited: [...] }`
- Emit `refresh.completed` event (logged to Mongo) when worker finishes

### 3.2 ngrok (operator, ~5 min)
```bash
ngrok http 3000
# copy the https URL
```

Add to `.env`:
```
PUBLIC_WEBHOOK_URL=https://xxxx.ngrok-free.app/webhooks/ingest/meta
```

Restart API.

### 3.3 Configure Meta webhook (operator, ~10 min, one-time)
In https://developers.facebook.com/apps/<your-app>/webhooks:
1. Callback URL: paste `PUBLIC_WEBHOOK_URL` value
2. Verify token: value of `META_WEBHOOK_VERIFY_TOKEN`
3. Click "Verify and save" — our handler responds to the challenge
4. Subscribe Instagram to: `media`, `comments`, `mentions`, `story_insights`
5. Subscribe Page to: `feed`, `videos`, `live_videos`
6. In Graph API Explorer, for the Page holding your IG business: `POST /<page-id>/subscribed_apps?subscribed_fields=feed`

### 3.4 Webhook handler (agent, ~3h)
`src/modules/webhooks/webhooks-ingest.controller.ts`:

**GET** `/webhooks/ingest/meta?hub.mode=subscribe&hub.challenge=X&hub.verify_token=Y`:
- If `Y === META_WEBHOOK_VERIFY_TOKEN` → 200 text/plain echoing `X`
- Else → 403

**POST** `/webhooks/ingest/meta`:
1. Read raw body (Express middleware preserves it — see note below)
2. Verify `X-Hub-Signature-256` = `sha256=<hmac_sha256(META_APP_SECRET, raw_body)>` with constant-time compare
3. Parse body, extract first `entry`. Compute `event_id = sha256(entry.id + entry.time + JSON.stringify(changes[0]))`
4. `INSERT INTO inbound_webhook_log (platform, event_id, signature_valid, ...) ON DUPLICATE KEY IGNORE`
5. If row actually inserted: lookup account by `canonical_user_id = entry.id`, enqueue BullMQ `sync` with `priority: HIGH` for relevant product
6. Return 200 empty body within ~100ms

Raw body middleware (important — must preserve bytes before JSON parser):
```typescript
app.use('/webhooks/ingest/:platform', express.raw({ type: 'application/json' }));
```

### 3.5 Verify
- Post a new Instagram story or publish a Reel
- Meta → App → Webhooks → Recent Deliveries: should show success 200
- Your connector logs: "inbound webhook received, signature valid, enqueued"
- `inbound_webhook_log` table has a new row
- `sync_jobs` for that account shows a HIGH-priority job that processes quickly
- Within seconds Mongo `posts` reflects the new content

Commit:
```bash
git add poc/
git commit -m "Day 3: manual refresh, Meta webhooks inbound with signature verification"
```

---

## Day 4 — Public UI (simple, Mongo-direct)

**Goal:** minimal human-readable UI over the data. The real star is Day 5-6 admin.

### 4.1 Next.js scaffold (agent, ~30 min)
```bash
cd poc/web
npx create-next-app@14 . --typescript --no-tailwind --no-eslint --app=false --src-dir=false --import-alias="@/*"
npm install mongodb
```

### 4.2 Mongo reader (agent, ~15 min)
`web/lib/mongo.ts`:
```typescript
import { MongoClient } from 'mongodb';
const client = new MongoClient(process.env.MONGO_URL!);
export const db = client.connect().then(c => c.db('connector_ui'));
```

### 4.3 Pages (agent, ~3h)
- `pages/index.tsx` — list of accounts (reads Mongo `identity_snapshots`). Link each to `/account/[id]`.
- `pages/account/[id].tsx` — profile card (avatar, handle, bio, followers) + audience cards (gender / age / top countries — just bars made of divs, no chart lib needed for PoC).
- `pages/account/[id]/posts.tsx` — grid of 30 most recent posts with thumbnail + caption + like/comment count.
- "Refresh now" button — POST to connector `/v1/accounts/:id/refresh`, show spinner, poll Mongo every 2s until `updated_at` on the account changes.

Run:
```bash
cd poc/web
npm run dev   # port 3001
```

Open `http://localhost:3001`.

Commit:
```bash
git add poc/web/
git commit -m "Day 4: public UI reading Mongo"
```

---

## Day 5 — Admin dashboard ★ (the main deliverable)

**Goal:** full visibility and live control of rate limits, cadences, next executions, queue state, webhooks, raw blobs, adapter capabilities. This is where the PoC earns its keep.

Reads come directly from MySQL + Redis + in-memory metrics service via connector admin endpoints; writes go through admin endpoints. UI polls every 2s.

### 5.1 Admin API endpoints (agent, ~2h)

All under `/admin/` in the connector API:

| Endpoint | Returns |
|---|---|
| `GET /admin/overview` | counts of accounts/platforms/jobs + latest activity summary + platform status badges |
| `GET /admin/rate-buckets` | all buckets: key, platform, scope, tokens, capacity, refill_per_ms, last_acquire, hits, denies, effective_usage |
| `GET /admin/rate-buckets/history?key=&mins=60` | time-series of tokens over last hour for chart |
| `POST /admin/rate-buckets/:key/reset` | force-refill (ops testing) |
| `GET /admin/queues` | per queue + per priority: waiting, active, completed, failed, delayed |
| `GET /admin/sync-jobs?account_id=&status=&platform=` | paginated sync_jobs joined with accounts |
| `GET /admin/next-runs?horizon_hours=24` | ordered list of upcoming sync_jobs within N hours, for timeline viz |
| `GET /admin/accounts` | account health table (see §5.3) |
| `GET /admin/accounts/:id` | single account detail + all products + token expiry + recent calls |
| `PATCH /admin/accounts/:id/sync-tier` | `{ tier }` |
| `POST /admin/accounts/:id/cadence-overrides` | `{ product, interval_seconds, reason, expires_at? }` |
| `DELETE /admin/accounts/:id/cadence-overrides/:product` | revert override |
| `GET /admin/cadences` | all platform defaults |
| `PATCH /admin/cadences/:platform/:product` | `{ interval_seconds }` |
| `GET /admin/cadences/projection` | estimated calls/hour per platform given current cadences + accounts |
| `GET /admin/throttle-locks` | current active throttle + manual-refresh locks with TTL remaining |
| `POST /admin/throttle-locks/release` | force-release a lock |
| `GET /admin/api-calls?platform=&status=&account_id=&limit=100` | recent api_call_log rows |
| `GET /admin/webhooks/inbound?limit=100` | inbound_webhook_log |
| `GET /admin/webhooks/silence` | per (account, product) — last webhook received age |
| `POST /admin/webhooks/replay/:id` | re-enqueue the sync job the webhook would have triggered |
| `GET /admin/events?limit=100` | recent event_log from Mongo |
| `GET /admin/raw-responses?account_id=&limit=50` | list of raw blob metadata |
| `GET /admin/raw-responses/:id` | full JSON body of a raw blob |
| `GET /admin/support-matrix` | each adapter's declared `supportMatrix()` as a table |
| `POST /admin/accounts/:id/refresh-now` | shortcut for the public `/v1/accounts/:id/refresh` |
| `POST /admin/sync-jobs/:id/reenqueue` | force a failed/idle job to run now |
| `POST /admin/seed-account` | see §1.8 |

### 5.2 Admin UI pages (agent, ~5h — bulk of Day 5)

All under `/admin/*` in Next.js. Shared layout with sidebar navigation.

#### `pages/admin/index.tsx` — Overview
- Top row: 4 KPI cards (accounts connected · syncs last hour · webhooks last hour · DLQ depth)
- Middle: mini live-tokens gauge for each active platform
- Bottom: last 10 api_call_log entries (ticker style)

#### `pages/admin/rate-limits.tsx` — Rate buckets (the "star of the show")
For each bucket:
- **Live gauge** showing `tokens / capacity` — refreshes every 1s
- **Line chart** of tokens over last 60 min (pulls `/admin/rate-buckets/history`)
- Labels: refill rate (per minute), last acquire timestamp, hits counter, denies counter
- **Headers-observed row** side-by-side with declared capacity — highlight in red if drift > 15%
- Per-platform total 429 count in last hour

Interactive:
- Dropdown per bucket: "Inject 20 requests now" → triggers a manual refresh burst to watch the bucket drain
- Reset bucket button (ops testing): `POST /admin/rate-buckets/:key/reset` → clears the Redis key, bucket refills to full

#### `pages/admin/cadence.tsx` — Cadence control
**Top section — platform defaults:**
Editable table: each `(platform, product)` row with inline editor for `default_interval_seconds`. Save button issues `PATCH /admin/cadences/:platform/:product`. Confirmation toast: "All N affected sync_jobs rescheduled."

**Middle section — account tiers:**
Grid of all accounts with `sync_tier` dropdown per row. Changing triggers `PATCH /admin/accounts/:id/sync-tier`. Shows how many sync_jobs got rescheduled.

**Bottom section — per-account overrides:**
Table of all active overrides. "Add override" form: pick account + product + custom interval + optional expiry date. "Remove" button.

**Simulator / projection:**
Card showing "**Given current cadences × connected accounts, we'll burn ~N calls/hour per platform.**" Updates live when you edit tiers or overrides. Comes from `/admin/cadences/projection` which does the math server-side.

#### `pages/admin/next-runs.tsx` — Scheduled executions timeline
Visual timeline of the next 24h:
- X-axis: time (now → now + 24h, hourly gridlines)
- Y-axis: one row per account (grouped by platform)
- Each cell marked with a dot per product that will fire in that hour
- Hover a dot → popup with `account`, `product`, exact `next_run_at`, priority
- Sort by "next due first" option

Below the chart: plain table of the next 50 due jobs with exact timestamps, status, priority.

**"What if I pause account X?"** toggle — simulation mode (client-side) that removes an account's dots from the chart and shows recomputed totals.

#### `pages/admin/queues.tsx` — Queue state
For each BullMQ queue (`sync`, `events`):
- Stats: waiting / active / completed (last hour) / failed / delayed
- Per-priority split (HIGH / NORMAL / BACKFILL)
- Active jobs list with age
- Failed jobs list with error + "Re-enqueue" button

#### `pages/admin/accounts.tsx` — Account health (per-account × per-product matrix)
Big table — one row per account, columns per product:

| account | tier | identity | audience | engagement_new | stories |
|---|---|---|---|---|---|
| acc_1 | standard | last: 2m ago / next: 5h | last: 12h / next: 12h | ... | ... |

- Cells colored: green (fresh), yellow (approaching cadence), red (failed or overdue)
- Hover cell → last_error, failure_count, override active
- Click cell → detail view with recent api_call_log for that (account, product)
- "Refresh now" button per cell
- "Pause" / "Unpause" buttons per row
- Token expiry countdown column (warns at <7 days)

#### `pages/admin/calls.tsx` — Recent API call log
Scrolling table of last N `api_call_log` rows:
- Columns: timestamp, platform, endpoint, method, status, duration, bucket-before → bucket-after, `X-App-Usage %`, `X-BUC-Usage %`, account
- Filters: platform, status class (2xx/4xx/5xx), account, min duration
- Click row → full detail with headers parsed
- "Live tail" toggle (auto-scroll as new rows arrive)

Additional embedded panel: **active throttle locks** (pulled from `/admin/throttle-locks`)
- List of `throttle:{account}:{product}` and `manual_refresh:{account}:{product}` locks with TTL remaining
- Force-release button per lock (ops only) — useful when a test goes wrong

#### `pages/admin/webhooks.tsx` — Inbound webhook observability
- Last 100 `inbound_webhook_log` rows with signature valid/invalid badge
- Signature-invalid rate (should be 0) — highlight red if not
- **Silence detector:** per `(account, product)`, time since last webhook. Sorted by longest silence. Warns when > 7 days.
- "Replay" button per row: re-enqueue the sync job the webhook would have triggered

#### `pages/admin/events.tsx` — Outbound events emitted
(PoC logs them to Mongo `event_log`; prod would sign+deliver via HMAC webhook)
- Last 100 events from Mongo `event_log` collection
- Filter by event_type, account
- Click → full payload JSON
- Counter: events per event_type in last hour

#### `pages/admin/raw.tsx` — Raw response browser
- Grid of last N `raw_platform_responses` with platform, endpoint, size, fetched_at
- Click → full JSON view with collapsible tree
- Filter by account + date range
- This is the "Mongo is S3-sim" viewer — makes D-14 two-tier storage tangible

#### `pages/admin/support-matrix.tsx` — Adapter capabilities
Each registered adapter's `supportMatrix()` rendered as a platform × product × field heatmap:
- ✓ supported
- ⚠ empty_possible (platform returns null sometimes)
- — not_supported
- Useful as a reminder of what the connector can/cannot deliver

### 5.3 Verify the dashboard in action (operator, ~1h)
Load the admin. Then:
1. Hit "Refresh now" on an account product in `admin/accounts.tsx`. Watch the rate-limits page — the bucket drains by 1 token per call. Watch `admin/calls.tsx` — the calls appear in real time.
2. Change the IG identity cadence from 6h to 10min in `admin/cadence.tsx`. Watch `admin/next-runs.tsx` — all IG identity cells shift closer. Projection card updates.
3. Change an account's tier to `vip`. Same effect, scoped. Check projection — "projected calls/hour" doubles for that account.
4. Publish a story on IG → `admin/webhooks.tsx` shows the inbound, and the relevant sync_job goes HIGH, visible in `admin/queues.tsx`.
5. Set an account to `paused` → `admin/next-runs.tsx` removes its dots.
6. Intentionally send a malformed signature via curl → webhook shows `signature_valid: false`.
7. Add a per-account override for `engagement_new = 120 seconds`. Watch the account's engagement_new bucket spike in the cadence simulator.
8. Click a post in `admin/raw.tsx` → see the raw IG JSON that came back from the Graph API.

This is where the abstractions in the docs become visceral.

Commit:
```bash
git add poc/
git commit -m "Day 5: full admin dashboard — rate limits, cadence, next runs, accounts health, calls, webhooks, events, raw viewer, support matrix"
```

---

## Day 6 — Facebook adapter (the drop-in demo)

**Goal:** add Facebook Pages in one day with zero changes to the core. Proves the extensibility claim.

### 6.1 FacebookAdapter (agent, ~3h)
`src/modules/platforms/facebook/facebook.adapter.ts` implementing `PlatformAdapter`:
- `fetchProfile`: `GET /{page_id}?fields=name,about,category,picture,fan_count,followers_count,link`
- `fetchAudience`: `GET /{page_id}/insights?metric=page_fans_country,page_fans_gender_age&period=lifetime`
- `fetchContents`: `GET /{page_id}/posts?fields=id,message,created_time,permalink_url,full_picture,attachments,insights.metric(post_impressions,post_reactions_by_type_total)` + merge with `/videos`

Declared `rateLimitHints()`:
```typescript
[
  { scope: 'page', keyTemplate: 'rate:fb:page:{page_id}', capacity: 200, refillPerMs: 0.0555, costPerCall: 1, strategy: 'token-bucket' },
  { scope: 'app', keyTemplate: 'rate:fb:app', capacity: 200, refillPerMs: 0.0555, costPerCall: 1, strategy: 'token-bucket' }
]
```

### 6.2 DI wiring (agent, ~15 min)
`src/modules/platforms/platforms.module.ts`:
```typescript
providers: [
  InstagramAdapter,
  FacebookAdapter,
  {
    provide: 'ADAPTER_REGISTRY',
    useFactory: (ig, fb) => ({ instagram: ig, facebook: fb }),
    inject: [InstagramAdapter, FacebookAdapter]
  }
]
```
Worker already resolves `adapterRegistry[account.platform]`. **That's the only DI change.**

### 6.3 Seed a Facebook account (operator, ~10 min)
Via the `/admin/seed-account` endpoint (from the admin UI) or CLI:
```bash
SEED_FB_TOKEN="<your_page_token>" \
SEED_FB_PAGE_ID="<page_id>" \
SEED_FB_HANDLE="MyPage" \
SEED_PLATFORM=facebook \
npm run seed
```

### 6.4 Verify the "1 day platform drop-in" claim (operator, ~30 min)
Watch admin UI:
- New rate buckets `rate:fb:page:...`, `rate:fb:app` appear on `admin/rate-limits.tsx` (discovered automatically from the new adapter's `rateLimitHints()`)
- Next-runs timeline now shows FB account dots
- Accounts table has the new FB row
- `admin/cadence.tsx` shows new `facebook` rows (seeded)
- `admin/support-matrix.tsx` shows FB adapter's support matrix alongside IG

**Count the changes** to prove the claim:
- 1 new adapter file (~200 lines)
- 1 line in the registry DI factory
- Seeded 1 row in `cadences` per FB product (data, not code)
- UI: zero changes (everything is platform-agnostic and reads from the API)

What did NOT change: scheduler, worker, rate-bucket service, BullMQ, webhooks handler, any admin UI page, Prisma schema.

Commit:
```bash
git add poc/
git commit -m "Day 6: FacebookAdapter drop-in — core untouched"
```

---

## Day 7 — Polish

**Goal:** reproducible by someone else.

### 7.1 poc/README.md (agent, ~45 min)
- Brief architecture summary (link to `docs/`)
- Prerequisites + operator checklist
- Setup steps copy-paste
- Running all processes
- Seeding accounts
- Common issues
- Teardown

### 7.2 Docker compose polish (agent, ~30 min)
- Add healthchecks for mongo + redis
- Document env vars in the yaml
- Add a `--profile test` for ephemeral databases

### 7.3 Error handling sweep (agent, ~2h)
- Token call returning 401 → mark account `needs_reauth`, pause its sync_jobs
- Platform 5xx → retry with backoff; after 3 failures → status `failed` + visible in admin
- Friendly "Something went wrong" empty states in UI

### 7.4 Seed data completeness (agent, ~30 min)
Make `prisma/seed.ts` idempotent and cover:
- All `cadences` rows
- Optionally a demo account (if operator provides `SEED_*` env vars)

### 7.5 Teardown script (agent, ~15 min)
`poc/scripts/teardown.sh`:
```bash
docker compose down -v
rm -rf node_modules web/node_modules web/.next dist
```

Commit + tag:
```bash
git add poc/
git commit -m "Day 7: polish, README, teardown"
git tag poc-v1
```

---

## Testing checklist

Manually walk through all of these with the admin UI open:

- [ ] Seed IG account → `accounts` row + 4 `sync_jobs` rows
- [ ] Within 2 min: `identity_snapshots`, `audience_snapshots`, `posts` populated in Mongo
- [ ] `raw_platform_responses` has blobs matching the number of API calls
- [ ] Admin rate-limits shows IG buckets with tokens draining during sync
- [ ] `X-App-Usage` header parsed and displayed alongside declared capacity
- [ ] Click "Refresh now" on `engagement_new` 3× rapidly → third returns 409 throttled
- [ ] Change IG `identity` default cadence to 10min → next-runs timeline reshuffles within 1 tick
- [ ] Change an account's tier to `vip` → its cadences halve visibly
- [ ] Add per-account override → override takes precedence over tier multiplier
- [ ] Set tier to `paused` → no more sync_jobs enqueued for that account
- [ ] Post an IG story → webhook arrives, logged with `signature_valid: true`, HIGH job enqueued and processed
- [ ] Send a POST with bad signature via curl → 401 returned, `signature_valid: false` row
- [ ] Silence detector on `admin/webhooks.tsx` shows accounts with no recent webhooks
- [ ] Seed FB account → rate buckets appear without any code change, next-runs has FB dots
- [ ] Support matrix shows IG + FB side by side
- [ ] Raw response viewer: click any post, see its raw IG JSON
- [ ] Throttle locks page shows active locks during a burst of refreshes
- [ ] Force-release a throttle lock → subsequent refresh proceeds
- [ ] Failed sync job → visible in admin with error; re-enqueue works

---

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| Webhook challenge returns 403 | `META_WEBHOOK_VERIFY_TOKEN` mismatch | Copy the exact string both in `.env` and Meta dashboard |
| Webhook signature always invalid | Express JSON parsed body before raw buffer available | Make sure `express.raw()` middleware is mounted **before** `express.json()` and ONLY for `/webhooks/ingest/*` |
| Rate bucket always shows full | Worker isn't calling `acquire()` before the HTTP call | Grep the adapter for `rateBucket.acquire` — every external call must go through it |
| `X-App-Usage` vs bucket drift | Capacity mis-declared | Adjust `rateLimitHints().capacity` down to match observed platform limit |
| Scheduler not enqueuing jobs | `next_run_at` is NULL (account paused) or in future | Check `sync_jobs` with Prisma Studio |
| Worker idle while jobs present | BullMQ using wrong Redis DB index | Standardize `redis://host:port/0` across connector + workers |
| ngrok URL changes on restart | Free tier behaviour | Update Meta webhook callback URL in dashboard each time; or upgrade to static domain |
| Token operations fail | Operator-provided token expired | Regenerate in Graph API Explorer; re-seed |
| IG audience insights empty | Account lacks minimum activity or is too new | Normal — IG Business Insights need ~100 followers + recent activity |
| `api_call_log` empty | Adapter not calling the logging helper | Wrap every HTTP call in a `measuredHttpCall(platform, endpoint, fn)` helper |

---

## Split of effort

**Operator (~3-4h total, spread across the week):**
- 30 min: generate long-lived IG + FB Page tokens via Graph API Explorer
- 15 min: configure Meta webhook callback + verify token
- 10 min: `POST /<page-id>/subscribed_apps` for IG + FB Page
- 1h: feedback on UI layout (Day 4 + Day 5)
- 1h: break things intentionally while watching admin (Day 5-6)

**Coding agent (~6 days):**
- Day 1 (0.5 day): infra + scaffolding + seed
- Day 2 (1 day): adapter port + IG adapter + rate buckets + worker + cadence
- Day 3 (1 day): manual refresh + webhooks
- Day 4 (0.5 day): public UI
- Day 5 (1.5 days): full admin dashboard
- Day 6 (1 day): FB adapter
- Day 7 (0.5 day): polish

---

## What this PoC intentionally does not do

- **No OAuth flow.** Operator provides tokens. Prod connector implements OAuth per `docs/connection-portal.md`.
- **No KMS.** Tokens encrypted with local AES-256-GCM via `.env` key. Prod uses KMS envelope.
- **No Secrets Manager.** `.env` holds everything.
- **No outbound signed events.** Events logged to Mongo `event_log` collection; admin UI visualizes them. Prod sends HMAC-signed webhooks to backend-api.
- **No backend-api integration.** UI reads Mongo directly. Prod has backend-api as the only consumer.
- **No real S3.** Raw blobs live in Mongo `raw_platform_responses`. Prod uses S3 with lifecycle policy.
- **No scheduler HA.** Single instance. Prod adds leader-lock at 20k+ accounts.
- **No Prometheus / Grafana.** In-memory metrics exposed via admin endpoints. Prod has full observability stack.
- **No YouTube / Twitch / TikTok.** Scope intentionally limited to IG + FB to prove the adapter port.
- **No multi-org visibility.** Single "demo" organization hardcoded.
- **No GDPR purge flow.** Prod has it per `docs/08-operations/security.md`.

When the PoC ends and you're convinced of the design, start Sprint 0 of the real plan (see plan file). The PoC's docker-compose, Prisma schema, and adapter code can be salvaged or rewritten as fits.

---

## Design docs referenced (for deeper context on anything above)

- [`docs/02-architecture.md`](docs/02-architecture.md)
- [`docs/03-extensibility.md`](docs/03-extensibility.md) — the 6 diagrams
- [`docs/04-data-model.md`](docs/04-data-model.md)
- [`docs/rate-limiting.md`](docs/rate-limiting.md)
- [`docs/ingestion-modes.md`](docs/ingestion-modes.md)
- [`docs/refresh-cadence.md`](docs/refresh-cadence.md)
- [`docs/manual-refresh.md`](docs/manual-refresh.md)
- [`docs/07-platforms/instagram.md`](docs/07-platforms/instagram.md)
- [`docs/07-platforms/facebook.md`](docs/07-platforms/facebook.md)
