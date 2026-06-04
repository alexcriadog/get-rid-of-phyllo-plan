# 05 · API Contract (public `/v1`)

**Status:** Living — describes the API as implemented in `poc/src`
**Last updated:** 2026-06-04

Reference for the **public REST API** the connector exposes to client workspaces
(API-key holders). This replaces the 2026-04 design-era contract: the
`Service-Token` + `POST /v1/connect/initiate` + `@camaleonic/connector-contract`
plan was superseded by **per-workspace API keys + SDK tokens + the hosted
connect-tool** (see [`connection-portal.md`](connection-portal.md) §0.5 and
[ADR-0013](adr/0013-connection-portal-placement.md)). Where this doc and the
code disagree, the code wins — controllers live under `poc/src/modules/api`,
`poc/src/modules/sdk-tokens` and `poc/src/modules/outbound-webhooks`.

---

## Conventions

- **Base URL:** `https://smconnector.camaleonicanalytics.com` (Caddy routes
  `/v1/*` to the API service).
- **Content type:** `application/json` for request bodies and responses.
- **Dates:** ISO-8601 UTC (`2026-06-04T15:32:10.123Z`).
- **IDs:** numeric strings (BigInt serialised as string, e.g. `"13"`).
- **Field casing:** snake_case in all JSON payloads.
- **Pagination:** cursor-based envelope on list endpoints:
  ```json
  { "data": [ … ], "meta": { "count": 12, "has_more": true, "next_cursor": "…" } }
  ```
  Repeat the call with `?cursor=<next_cursor>`.
- **Caching:** read endpoints are cached server-side per workspace+route+query
  (`V1CacheInterceptor`); add `?live=true` where supported to force a fresh
  platform fetch.

---

## Authentication

- **`Authorization: Bearer cmlk_(live|test)_<random>`** — per-workspace API
  key, issued from the admin workspace page. Stored as SHA-256 hash; shown once
  at issuance.
- The key resolves to a workspace: every `/v1` call is **scoped to that
  workspace's accounts** and metered against its plan tier.
- `cmlk_test_*` keys mint **test** SDK tokens — accounts seeded through them
  are flagged `is_test` and receive no webhooks.
- Missing/invalid/revoked key → `401`.

There is no `Service-Token` and no `@camaleonic/connector-contract` package —
both were design-era concepts that never shipped.

---

## Connect flow

Account connection is **not** a server-to-server API call. The client's backend
mints a short-lived SDK token; the browser hands it to the Connect SDK
(`connect-sdk.js`), which drives the hosted connect-tool (OAuth popup + product
confirmation). Full journey in [`connection-portal.md`](connection-portal.md);
integrator docs in `connect-tool/sdk/README.md`.

### `POST /v1/sdk-tokens`

Mint an HS256 JWT bound to one end user, consumed by the Connect SDK.

```
Request:
  {
    user_id: "your-end-user-id",            // required, ≤256 chars; lands on accounts as end_user_id
    ttl: 1800,                              // optional seconds, 60–1800 (default 300)
    allowed_platforms: ["facebook", "instagram"],   // optional allow-list, ≤6;
                                            // "instagram" implicitly allows "facebook" (IG uses FB OAuth)
    products: {                             // optional per-connection product scope (since 2026-06-03)
      "facebook": ["identity", "audience"]  // Record<platform, productId[]>
    }
  }

Response 200:
  { "sdk_token": "<jwt>", "expires_at": "2026-06-04T16:10:00.000Z" }

Errors:
  400 — unknown platform; platform not offered by the workspace;
        product not enabled for that platform in the workspace
        (e.g. "Product \"ads\" is not enabled for platform \"facebook\" in this workspace")
```

`products` semantics (the per-connection product scope):

- Must be a **subset of the workspace allow-list** (`workspace.products`) —
  validated at mint, signed into the JWT, so the end user cannot widen it.
- `identity` is always injected; `{ "facebook": [] }` = profile-only.
- Platforms not listed inherit the full workspace allow-list.
- Effect: the OAuth consent screen requests only the scoped products' scopes,
  and only those products are enrolled as `sync_jobs`. Enforcement is
  three-layered (mint ⊆ ceiling → connect-tool clamp → seed re-check); see
  [`connection-portal.md`](connection-portal.md) §0.5.

---

## Account endpoints

All guarded by the API key and scoped to its workspace.

### `GET /v1/accounts`

```
Query:
  ?platform=instagram        // optional
  ?end_user_id=<id>          // optional — the user_id the SDK token was minted with
  ?limit=100                 // optional, 1–500 (default 100)
  ?cursor=<token>            // pagination

Response 200: { data: AccountSummary[], meta: { count, has_more, next_cursor } }

AccountSummary:
  {
    id: "13",
    platform: "twitch",
    canonical_user_id: "501116841",
    handle: "alex_cg_11" | null,
    display_name: "Alex_CG_11" | null,
    status: "ready",
    end_user_id: "user@email.com" | null,
    is_test: false,
    connected_at: "<ISO>",
    disconnected_at: "<ISO>" | null
  }
```

### `GET /v1/accounts/:id`

Single `AccountSummary`. `404` if not found / other workspace.

### `DELETE /v1/accounts/:id`

Disconnect: revokes the stored token and stops syncing.

```
Response 200: { id, status, disconnected_at }
```

### Data products (per account)

| Route | Notes |
|---|---|
| `GET /v1/accounts/:id/identity` | Normalized profile (see below). `?live=true` forces platform fetch. |
| `GET /v1/accounts/:id/audience` | `{ platform, data, synced_at }` — platform-specific demographics. |
| `GET /v1/accounts/:id/content` | Posts. `?limit=` 1–200 (default 50), `?since=<ISO>`, `?live=`. Paginated envelope + `platform`, `synced_at`. |
| `GET /v1/accounts/:id/engagement` | Aggregated metrics (see below). `?limit=` 1–100 (default 25), `?since=`, `?live=`. |
| `GET /v1/accounts/:id/engagement-deep` | Platform-specific deep analytics. `?live=`. |
| `GET /v1/accounts/:id/stories` | Stories. `?limit=` 1–200, `?live=`. |
| `GET /v1/accounts/:id/mentions` | Tagged/UGC posts. `?limit=` 1–200. **Always live.** |
| `GET /v1/accounts/:id/comments` | Comments. `?limit=` 1–200, `?live=`. |
| `GET /v1/accounts/:id/ratings` | Page reviews — Facebook only. `?limit=` 1–100. |
| `GET /v1/accounts/:id/ads` | Ad insights — Facebook only. `?live=`. |

A product endpoint only returns data if the account is **enrolled** in that
product (workspace allow-list ∩ per-connection scope at connect time) — else
`404 { "error": "product_not_enrolled", "product": "<id>" }`, for both snapshot
and `?live=true` reads. A snapshot that hasn't synced yet returns
`404 { "error": "not_synced_yet", "product": "<id>" }`. Re-connecting with a
narrower scope prunes the out-of-scope enrolments (re-seed is authoritative).

`identity` response (`NormalizedIdentity`):

```json
{
  "platform": "instagram",
  "platform_user_id": "17841…",
  "username": "creator",
  "full_name": "…", "biography": "…",
  "profile_image_url": "…", "profile_url": "…",
  "followers_count": 1234, "following_count": 56, "posts_count": 78,
  "is_verified": false, "account_type": "BUSINESS",
  "extra": { }, "fetched_at": "<ISO>", "synced_at": "<ISO>"
}
```

`engagement` response (`NormalizedEngagement`):

```json
{
  "platform": "instagram",
  "window": { "since": "<ISO or null>", "until": "<ISO>", "sample_size": 25 },
  "totals": { "likes": 0, "comments": 0, "shares": 0, "saves": 0, "views": 0, "reach": 0 },
  "averages_per_post": { "likes": 0, "comments": 0, "shares": 0, "views": 0 },
  "engagement_rate": 0.034
}
```

---

## Refresh

### `POST /v1/accounts/:id/refresh`

On-demand sync. Detail in [`manual-refresh.md`](manual-refresh.md).

```
Request:  { products?: ["identity", …], reason?: "<≤256 chars>" }
Response 202:
  { account_id, reason, jobs: [{ product, job_id }], throttled: [...], rate_limited: [] }
```

`throttled` lists products skipped because a recent refresh holds the
per-product throttle lock.

---

## Outbound webhooks

Clients register HTTPS endpoints and receive signed event deliveries.

### Endpoint management

| Method | Path | Notes |
|---|---|---|
| `POST` | `/v1/webhook-endpoints` | Body `{ url, events[1–20], description? }`. **201**; response includes `secret` (`whsec_…`) — shown only here. |
| `GET` | `/v1/webhook-endpoints` | `{ data: RegisteredEndpoint[] }` (no secrets). |
| `PATCH` | `/v1/webhook-endpoints/:id` | Any of `url`, `events`, `description`, `active` (≥1 field). |
| `POST` | `/v1/webhook-endpoints/:id/rotate-secret` | `{ id, secret, rotated_at }`. |
| `POST` | `/v1/webhook-endpoints/:id/test` | **202** `{ delivery_id, status: "queued" }` — sends `webhook.test`. |
| `GET` | `/v1/webhook-endpoints/:id/deliveries` | Paginated delivery history (`?limit=` 1–200, `?cursor=`). |
| `GET` | `/v1/webhook-endpoints/:id/deliveries/:deliveryId` | Single delivery. |
| `DELETE` | `/v1/webhook-endpoints/:id` | **204**. |

`GET /v1/webhook-deliveries` — unified delivery list across endpoints
(`?status=pending|delivered|failed|abandoned`, `?endpoint_id=`, `?event=`,
`?limit=`).

### Event types

```
account.connected · account.disconnected · account.refreshed
token.refresh_failed · token.expired · webhook.test
data.identity.updated · data.audience.updated · data.engagement_new.updated
data.engagement_deep.updated · data.stories.updated · data.mentions.updated
data.comments.updated · data.ratings.updated · data.ads.updated
```

### Delivery signing

Every delivery carries:

```
Content-Type: application/json
X-Camaleonic-Event: <event type>
X-Camaleonic-Delivery: <delivery id>
X-Camaleonic-Signature: t=<unix seconds>,v1=<hex>
```

Verification: `v1 = HMAC-SHA256(secret, "<t>.<raw body>")`. Reject if the
signature mismatches or `t` is older than your tolerance window.

Retry schedule on non-2xx: **1m, 5m, 30m, 2h, 12h, 24h** (6 attempts), then
`abandoned`.

---

## Inbound webhooks (platform → connector, PUBLIC)

Only the Meta family is implemented today:

- `GET /webhooks/ingest/meta` — Meta subscription challenge
  (`hub.mode=subscribe`, `hub.verify_token` vs `META_WEBHOOK_VERIFY_TOKEN`,
  echoes `hub.challenge`).
- `POST /webhooks/ingest/meta` — change notifications. Verified via
  `X-Hub-Signature-256: sha256=<HMAC-SHA256(META_APP_SECRET, raw body)>`.
  Always answers `200`; valid events enqueue HIGH-priority sync jobs and land
  in `inbound_webhook_log`.

Pages are auto-subscribed at connect time (Meta webhook auto-subscribe,
2026-06-03). See [`webhooks.md`](webhooks.md).

---

## Rate limiting

Per-workspace, per-minute, enforced on all `/v1/*` routes:

| Plan tier | Requests/min |
|---|---|
| `standard` | 120 |
| `pro` | 600 |
| `enterprise` | 6000 |

Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
`X-RateLimit-Reset` (unix seconds). On excess:

```
429 { "message": "Rate limit exceeded", "limit": 120, "retry_after_seconds": N, "statusCode": 429 }
```

plus a `Retry-After` header. Daily usage counters are kept 90 days for the
admin usage view.

---

## Errors — common shapes

Platform-originated failures (global `PlatformErrorFilter`):

```
401 { "error": "token_revoked",         "message": "…", "platform": "…", "canonical_user_id": "…", "statusCode": 401 }
503 { "error": "upstream_rate_limited", "message": "…", "platform": "…", "retry_after_seconds": N, "statusCode": 503 }   // + Retry-After
502 { "error": "upstream_error",        "message": "…", "platform": "…", "endpoint": "…", "upstream_body": {…}|null, "statusCode": 502 }
```

Validation / framework errors use the NestJS shape:

```
400 { "message": "Invalid sdk-token payload", "issues": [ …zod issues… ], "statusCode": 400 }
404 { "message": "…", "error": "Not Found", "statusCode": 404 }
```

`token_revoked` means the end user must reconnect (the account flips to
`needs_reauth`).

---

## Health & metrics

`/healthz` (+ `/health`) and Prometheus `/metrics` are served on a **private
ops port** (`OPS_PORT`, default 9464) reachable only inside the compose
network — they are not part of the public contract. There is no public
`/readyz`.

---

## Not part of the public contract

- **`/internal/*`** — connect-tool ↔ POC plumbing (`/internal/sdk-tokens/verify`,
  `/internal/workspaces/:slug/branding`, `/internal/products-catalog`).
  Blocked at the edge (Caddy 403) + shared-secret auth.
- **`/admin/*`** — operator console API (accounts, sync-jobs, queues,
  workspaces, API keys, seeding). Protected by Caddy basic-auth; shapes change
  freely with the admin UI.

---

## Versioning

- Path-prefixed (`/v1`). Additive changes (new fields/endpoints) land without a
  version bump — clients must tolerate unknown fields.
- Breaking changes require `/v2` with a deprecation window for `/v1`.

---

## Related docs

- [`connection-portal.md`](connection-portal.md) — connect flow + per-connection product scope invariant (§0.5)
- `connect-tool/sdk/README.md` — Connect SDK integration (mint, `products`, callbacks)
- [`manual-refresh.md`](manual-refresh.md) — refresh endpoint detail
- [`webhooks.md`](webhooks.md) — inbound Meta webhooks
- [`06-event-catalog.md`](06-event-catalog.md) — event payloads
- [`08-operations/security.md`](08-operations/security.md) — key handling, token encryption
