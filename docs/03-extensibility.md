# 03 · Extensibility — Visual Schema

**Status:** Stable reference
**Last updated:** 2026-04-23

The connector's design isolates **everything that varies** — platforms, scopes, data products — behind a single abstraction: the `PlatformAdapter` port. The core engine (scheduler, workers, rate limiter, event emitter, database, API) never changes when you add something new. Three axes of growth; three near-constant costs.

This doc is the **fastest way to understand the system**. Start here before reading the architecture or data-model docs.

---

## 1. System topology — what lives where

```
╔════════════════════════════════════════════════════════════════════════════╗
║                            AWS VPC (existing)                              ║
║                                                                            ║
║  ┌─────────────────────────┐         ┌────────────────────────────────┐    ║
║  │  EC2: backend-api       │  HTTPS  │  EC2: connector (NEW)          │    ║
║  │                         │ ◄─────► │                                │    ║
║  │  • 5 OAuth ports        │         │   ┌────┐ ┌──────┐ ┌─────────┐  │    ║
║  │  • feature-flag adapter │         │   │API │ │WORKER│ │SCHEDULER│  │    ║
║  │    swap (Phyllo↔conn)   │         │   └────┘ └──────┘ └─────────┘  │    ║
║  │  • event receiver +     │◄───────────── signed HMAC webhooks       │    ║
║  │    idempotency dedup    │         │    (same image, 3 commands)    │    ║
║  └──┬────────┬─────────────┘         └──┬────────┬──────────┬─────────┘    ║
║     │        │                          │        │          │              ║
║     ▼        ▼                          ▼        ▼          ▼              ║
║  ┌─────┐ ┌──────────┐             ┌─────────┐ ┌────────┐ ┌─────────┐       ║
║  │ RDS │ │ MongoDB  │             │  Redis  │ │Secrets │ │   KMS   │       ║
║  │MySQL│ │ (default │             │(shared) │ │Manager │ │(envelope│       ║
║  │     │ │  + auth) │             │BullMQ · │ │platform│ │  key)   │       ║
║  │ 3 DB│ │          │             │buckets ·│ │app     │ └─────────┘       ║
║  │+conn│ │backend-  │             │locks ·  │ │creds   │                   ║
║  │(NEW)│ │api only  │             │nonces   │ └────────┘                   ║
║  └─────┘ └──────────┘             └─────────┘                              ║
║                                                                            ║
╚══════════════════════════════════════╤═════════════════════════════════════╝
                                       │
                                       ▼
            ┌─────────────────────────────────────────────────┐
            │  External platform APIs                         │
            │  Meta Graph · YouTube Data v3 + Analytics ·     │
            │  Twitch Helix · TikTok Business                 │
            └─────────────────────────────────────────────────┘
```

The connector lives on its own EC2. It shares the RDS MySQL instance with `backend-api` (separate database, separate user) and shares Redis. It has its own KMS key and its own Secrets Manager namespace. It never talks to MongoDB.

## 2. Layered architecture — the scalability surface

```
╔════════════════════════════════════════════════════════════════════════╗
║                     CONNECTOR SERVICE (hexagonal)                      ║
║                                                                        ║
║   ┌──────────────────── Interfaces layer ────────────────────────┐     ║
║   │                                                              │     ║
║   │  Internal REST v1  │  OAuth public callback  │  Admin API    │     ║
║   │                                                              │     ║
║   └───────────────────────────┬──────────────────────────────────┘     ║
║                               │                                        ║
║   ┌──────────────────── Application layer ───────────────────────┐     ║
║   │                                                              │     ║
║   │  Account lifecycle · Sync orchestration · Event emission     │     ║
║   │                                                              │     ║
║   │  (these USE platform adapters via the port — never know      │     ║
║   │   which platform they're calling)                            │     ║
║   │                                                              │     ║
║   └───────────────────────────┬──────────────────────────────────┘     ║
║                               │                                        ║
║   ┌──────────────────── Domain layer ────────────────────────────┐     ║
║   │                                                              │     ║
║   │     ★  PlatformAdapter port (the abstraction) ★              │     ║
║   │                                                              │     ║
║   │     Methods (stable across all platforms):                   │     ║
║   │       exchangeCode · refreshToken · revokeToken              │     ║
║   │       resolveCanonicalId                                     │     ║
║   │       fetchProfile · fetchAudience                           │     ║
║   │       fetchContents · fetchContentMetrics                    │     ║
║   │       requiredScopes · rateLimitHints · ingestionModes       │     ║
║   │                                                              │     ║
║   │     + Events · Entities · Value objects                      │     ║
║   │                                                              │     ║
║   └───────────────────────────┬──────────────────────────────────┘     ║
║                               │                                        ║
║   ┌──────────────── Infrastructure layer ────────────────────────┐     ║
║   │                                                              │     ║
║   │   Platform adapters (each implements PlatformAdapter):       │     ║
║   │   ┌────┐  ┌────┐  ┌────┐  ┌──────┐  ┌──────┐   ┌───────────┐ │     ║
║   │   │ IG │  │ FB │  │ YT │  │Twitch│  │TikTok│...│ [NEW ADAP.]│ │     ║
║   │   └────┘  └────┘  └────┘  └──────┘  └──────┘   └───────────┘ │     ║
║   │                                                              │     ║
║   │   + Prisma clients · Redis clients · KMS · Secrets Manager · │     ║
║   │     HTTP clients with retry/backoff · Prometheus exporter    │     ║
║   │                                                              │     ║
║   └──────────────────────────────────────────────────────────────┘     ║
║                                                                        ║
╚════════════════════════════════════════════════════════════════════════╝
```

**Golden rule:** everything that varies between platforms lives only in the adapter layer. The rest is platform-agnostic.

## 3. Extensibility matrix — platforms × data products

```
                             DATA PRODUCTS →
       ┌──────────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
       │              │ Identity │ Audience │Engagement│ Comments │  Income  │
       │              │  (P1)    │  (P1)    │  (P1)    │   (P2)   │   (P2)   │
       ├──────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
PLATF. │ Instagram    │    ✓     │    ✓     │    ✓     │    ○     │    —     │
  ↓    │ Facebook     │    ✓     │    ✓     │    ✓     │    ○     │    —     │
       │ YouTube      │    ✓     │   ✓*     │    ✓     │    ○     │    ○     │
       │ Twitch       │    ✓     │  ⚠ lim   │    ✓     │    —     │    —     │
       │ TikTok       │    ✓     │  ⚠ lim   │    ✓     │    ○     │    —     │
       ├──────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
       │[+ Platform N]│    ✓     │    ?     │    ?     │    ?     │    ?     │
       └──────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘

   Legend:
     ✓      full support, phase 1
     ✓*     YouTube Audience requires extra scope (`yt-analytics.readonly`)
     ⚠ lim  supported but the platform exposes little data (not our bug)
     ○      planned in phase 2
     —      the platform does not offer this data product
```

Each cell is materialized as **one adapter method**. The matrix is declarative — the adapter reports what it supports via `supportMatrix()`, and the `platform_field_support` DB table persists it. `backend-api` reads that to distinguish *unsupported* from *empty* (F-44, FP-01 from the requirements doc).

## 4. Scopes / permissions — the third axis

Each adapter **declares its required scopes in code**. App Review is per-platform — the connector does not know about it; it only gives the adapter the scope list to request.

```
   ┌─────────────────────────────────────────────────────────────────┐
   │   class InstagramAdapter implements PlatformAdapter {           │
   │                                                                 │
   │     REQUIRED_SCOPES = {                                         │
   │       identity:   ['instagram_basic', 'pages_show_list'],       │
   │       audience:   ['instagram_manage_insights'],                │
   │       engagement: ['instagram_manage_insights',                 │
   │                    'business_management'],                      │
   │       comments:   ['instagram_manage_comments'],  // phase 2    │
   │     }                                                           │
   │                                                                 │
   │     // Add product P2 = new map entry + App Review              │
   │   }                                                             │
   └─────────────────────────────────────────────────────────────────┘
```

Existing accounts whose stored scope set no longer matches `REQUIRED_SCOPES[activeProducts]` are auto-flagged `needs_reauth` and enter the existing re-consent flow (same mechanism as token expiry). **Adding a scope = adapter-local change + App Review + re-consent orchestrated by the state machine.**

## 5. Cost ledger — how much to add something

```
╔══════════════════════════════════════════════════════════════════════╗
║   COST TO ADD — measured in "files you touch"                        ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  ▶ NEW PLATFORM (e.g., LinkedIn)                                     ║
║    1. Create `src/modules/platforms/linkedin/linkedin.adapter.ts`    ║
║       implementing `PlatformAdapter`                                 ║
║    2. Register DI binding in `platforms.module.ts` (1 line)          ║
║    3. Add row to `platforms` enum in Prisma + migration              ║
║    4. Rate-limit bucket config (1 line in YAML)                      ║
║    5. Platform app credentials in Secrets Manager                    ║
║    6. App Review (platform-side, no code)                            ║
║                                                                      ║
║    NOT TOUCHED: core engine · sync · scheduler · events · API · DB   ║
║    Estimated time: ≤ 2 dev-weeks (target S-08 from requirements)     ║
║                                                                      ║
║  ─────────────────────────────────────────────────────────────────   ║
║                                                                      ║
║  ▶ NEW DATA PRODUCT (e.g., Comments)                                 ║
║    1. Add method to `PlatformAdapter` port:                          ║
║       `fetchComments(accountId, contentId): Comment[]`               ║
║    2. Per-adapter implementation (5 adapters × 1 method)             ║
║    3. New event types: `comments.added`, `comments.updated`,         ║
║       `comments.deleted`                                             ║
║    4. Freshness SLO + default cadence in `cadences` table            ║
║    5. Add row to `REQUIRED_SCOPES` map of each adapter               ║
║                                                                      ║
║    NOT TOUCHED: sync engine · rate limiter · event delivery ·        ║
║    event format (versioned) · internal API shell                     ║
║                                                                      ║
║  ─────────────────────────────────────────────────────────────────   ║
║                                                                      ║
║  ▶ NEW SCOPE on an existing platform                                 ║
║    1. Update `REQUIRED_SCOPES[product]` in the adapter               ║
║    2. App Review (platform-side)                                     ║
║    3. Accounts with stale scopes auto-flag `needs_reauth`            ║
║       via the existing state machine                                 ║
║    4. Re-consent flow triggered by `backend-api` UI                  ║
║                                                                      ║
║    Adapter-local change. Nothing else touched.                       ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
```

## 6. Data flow — unified view

```
  [Creator OAuth]                                    [backend-api]
       │                                                   ▲
       ▼                                                   │
  POST /v1/connect/initiate                      signed HMAC webhook
       │                                                   │
       ▼                                              ┌────┴─────┐
  ┌─────────────┐                                    │  Events  │
  │connector-api│                                    │ outbound │
  │OAuth state  │                                    └────▲─────┘
  │+ callback   │───enqueue backfill──►┌─────────┐        │
  └─────────────┘                      │ BullMQ  │        │
                                       │ `sync`  │        │
                                       │ queue   │        │
                                       └────┬────┘        │
                                            │             │
  ┌────────────────┐                        ▼             │
  │connector-      │                  ┌─────────────┐     │
  │scheduler       │──enqueue         │connector-   │     │
  │next_run_at loop│  due jobs   ────►│worker (N)   │─────┘
  └────────────────┘                  │             │
                                      │ 1. rate-buk │
                                      │    acquire  │
                                      │ 2. throttle │
                                      │    lock     │
                                      │ 3. adapter. │
                                      │    fetch…   │
                                      │ 4. normalize│
                                      │ 5. persist  │
                                      │ 6. emit evt │
                                      └─────┬───────┘
                                            │
                                            ▼
                                     external platform API
                                     (via adapter)
```

The worker **never knows** which platform it is processing. It gets the right adapter by `platform_id` from the `sync_jobs` row and calls port methods. This is what makes "add a platform" a drop-in change.

---

## Related docs

- [`rate-limiting.md`](rate-limiting.md) — how each adapter's rate limits are enforced
- [`ingestion-modes.md`](ingestion-modes.md) — webhook vs polling per platform × product
- [`refresh-cadence.md`](refresh-cadence.md) — tiers and overrides
- [`04-data-model.md`](04-data-model.md) — Prisma schema supporting this architecture
- [`adr/0008-token-bucket-rate-limits.md`](adr/0008-token-bucket-rate-limits.md)
