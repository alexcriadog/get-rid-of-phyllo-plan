# 05 · Internal API Contract

**Status:** Living — source of truth is `openapi.yaml` in the connector repo
**Last updated:** 2026-04-23

Reference for the **internal REST API** the connector exposes to `backend-api`. Shape aims to slot behind `backend-api`'s existing OAuth ports (`OAuthIdentityAPI`, `OAuthAccountAPI`, `OAuthProfileAPI`, `OAuthProfileAudienceAPI`, `OAuthContentAPI`) with minimal adapter glue — the connector is a base-URL + auth change, not a data-model rewrite.

Types and Zod schemas for every request/response are published in `@camaleonic/connector-contract` — import these in backend-api rather than hand-coding DTOs.

---

## Conventions

- **Base URL:** `https://connector.<env>.internal/v1` — private, not public-reachable except the OAuth-callback path.
- **Content type:** `application/json`. Request bodies and responses are JSON.
- **Dates:** ISO-8601 with UTC (`2026-04-23T15:32:10.123Z`).
- **IDs:** connector IDs as prefixed ULIDs/opaque strings (`acc_<ulid>`, `evt_<ulid>`, `j_<ulid>`). Do not depend on monotonic ordering.
- **Enums:** lowercase snake_case (`instagram`, `engagement_new`, `needs_reauth`).
- **Pagination:** cursor-based. `next_cursor` in response; repeat with `?cursor=<token>`. Page size default 50, max 200.
- **Idempotency (writes):** `Idempotency-Key` header (UUIDv7/ULID) optional but recommended; connector dedupes for 24h.

---

## Authentication

- **`Authorization: Service-Token <token>`** — long-lived service token from Secrets Manager (`/connector/<env>/service-tokens/<caller>`). Only `backend-api` has a token today.
- Rotation: multiple tokens valid simultaneously during rotation window (same pattern as HMAC multi-secret).
- Missing/invalid → `401 Unauthorized`.

OAuth callback (`/oauth/callback/:platform`) is public and has its own verification (state nonce match).

---

## Connect endpoints

### `POST /v1/connect/initiate`
Start an OAuth flow.

```
Request:
  {
    platform: 'instagram' | 'facebook' | 'youtube' | 'twitch' | 'tiktok',
    user_id: '<backend-api user id>',       // opaque; connector stores as string
    organization_id: '<backend-api org id>',
    return_url: 'https://app.camaleonic.com/integrations/result'  // whitelist-validated
  }

Response 200:
  {
    authorize_url: 'https://graph.facebook.com/oauth/authorize?...',
    state: '<nonce>',
    expires_at: '2026-04-23T16:10:00Z'
  }

Errors:
  400 invalid_platform
  400 return_url_not_allowed
  503 platform_app_disabled
```

### `GET /oauth/callback/:platform` (PUBLIC — browser redirect)
Platform OAuth redirect target. Not called directly by backend-api.

```
Query: ?code=<platform_code>&state=<nonce>

Redirects:
  302 <return_url>?result=success&account_id=<id>
  302 <return_url>?result=declined
  302 <return_url>?result=state_invalid
  302 <return_url>?result=canonical_id_failed
  302 <return_url>?result=token_exchange_failed
```

Detail in [`connection-portal.md`](connection-portal.md) §6-7.

---

## Account endpoints

### `GET /v1/accounts`
List connected accounts.

```
Query:
  ?platform=instagram        // optional filter
  ?organization_id=<id>       // optional filter
  ?status=ready|pending|...   // optional
  ?cursor=<token>             // pagination

Response 200:
  {
    items: [
      {
        id: 'acc_<ulid>',
        platform: 'instagram',
        canonical_user_id: '17841...',
        handle: '@creator',
        status: 'ready',
        sync_tier: 'standard',
        owning_organization_id: 'org_<id>',
        connected_at: '2026-04-10T12:00:00Z'
      }, …
    ],
    next_cursor: '<token>' | null
  }
```

### `GET /v1/accounts/:id`
Detail for one account.

```
Response 200:
  {
    id, platform, canonical_user_id, handle, display_name,
    status, sync_tier,
    owning_organization_id, visible_organization_ids: [...],
    connected_at, disconnected_at,
    token: { expires_at, scopes: [...], last_refreshed_at },
    sync_health: {
      identity:   { last_success_at, next_run_at, consecutive_failures },
      audience:   { ... },
      engagement_new: { ... },
      engagement_metrics_recent: { ... },
      engagement_metrics_old: { ... },
      stories:    { ... }   // if supported by platform
    }
  }
```

Errors: `404 account_not_found`.

### `DELETE /v1/accounts/:id`
Disconnect an account for the calling organization.

```
Query:
  ?organization_id=<id>       // which org is disconnecting (required — org may still have others)
  ?purge=true                 // optional: hard-delete all data (GDPR). Default: soft-disconnect.
  ?gdpr=true                  // optional: purge + cascade S3 raw responses + audit entry

Response 200:
  {
    account_id,
    disconnected_at,
    remaining_organizations: N,
    purge_status: 'soft' | 'hard' | 'gdpr_complete'
  }
```

Emits `account.disconnected` with `organization_id` identifying which org dropped off.

### `GET /v1/accounts/:id/profile`
Normalized identity snapshot. Pulls from `identity_snapshots` table.

```
Response 200:
  {
    account_id,
    handle, display_name, biography, avatar_url, profile_url,
    followers_count, following_count, posts_count,
    verified, account_type,
    fetched_at
  }
```

### `GET /v1/accounts/:id/audience`
Audience snapshot. Pulls from `audience_snapshots` table.

```
Response 200:
  {
    account_id,
    gender_distribution: { male: 0.52, female: 0.46, other: 0.01, unknown: 0.01 },
    age_distribution:    { "13-17": 0.05, "18-24": 0.32, … },
    country_distribution: { "US": 0.42, "MX": 0.18, … },
    city_distribution:   { "New York, US": 0.12, … } | null,
    interests: [ { name: "Fitness", affinity_score: 0.78 }, … ] | null,
    supported_fields: ['gender','age','country','city','interests'],
    fetched_at
  }
```

`supported_fields` is the matrix cut from `platform_field_support` — backend-api uses it to distinguish "unsupported" from "empty".

### `GET /v1/accounts/:id/contents`
Paginated content list. Pulls from `posts` table.

```
Query:
  ?from=2026-01-01T00:00:00Z  // optional, default 90d ago
  ?to=<ISO>                    // optional, default now
  ?content_type=post|reel|…    // optional
  ?cursor=<token>

Response 200:
  {
    items: [
      {
        id: 'post_<ulid>',
        account_id,
        platform_content_id: '17920…',
        content_type: 'reel',
        caption: 'Hello world',
        permalink: 'https://instagram.com/...',
        media_urls: [{ url, type, width, height, duration_s }],
        metrics: { likes: 1234, comments: 56, views: 7890, ... },
        published_at,
        fetched_at,
        last_updated_at
      }, …
    ],
    next_cursor
  }
```

### `GET /v1/accounts/:id/contents/:contentId`
Single content record with full details + raw-response pointer (for debug).

---

## Refresh

### `POST /v1/accounts/:id/refresh`
On-demand refresh. See [`manual-refresh.md`](manual-refresh.md) §2 for full spec.

```
Request body: { products?: [...], reason?: string }
Response 202: { account_id, jobs: [...], throttled: [...], rate_limited: [...] }
```

---

## Admin

All admin endpoints require Service-Token with `admin:true` claim (JWT-like, validated against a separate secret set). Full spec in [`refresh-cadence.md`](refresh-cadence.md) §6.

- `PATCH /v1/admin/accounts/:id/sync-tier`
- `POST /v1/admin/accounts/:id/cadence-overrides`
- `DELETE /v1/admin/accounts/:id/cadence-overrides/:product`
- `PATCH /v1/admin/cadences/:platform/:product`
- `GET /v1/admin/accounts/:id/cadence` — read effective cadence
- `POST /v1/admin/sync-jobs/:id/reenqueue` — force a sync
- `POST /v1/admin/accounts/:id/pause` / `unpause` (convenience wrappers around sync_tier)
- `GET /v1/admin/counts` — counts of accounts per platform, status, tier, freshness bucket (F-95)
- `POST /v1/admin/webhook-subscriptions` — create a new event subscription
- `GET /v1/admin/webhook-subscriptions/:id/deliveries` — recent deliveries for debugging
- `POST /v1/admin/webhook-subscriptions/:id/rotate-secret`
- `POST /v1/admin/dev/webhook-test` — dev-only, replays a synthetic webhook into a handler (equivalent to today's `/oauth/webhook-test`)

---

## Webhook inbound (PUBLIC)

### `POST /webhooks/ingest/:platform`
Platforms push to this. Not called by backend-api.

```
Path: :platform in { meta, youtube, twitch, tiktok }
Headers: per-platform signature (see ingestion-modes.md §5)
Body: platform-specific payload

Response:
  200 OK          — signature valid, event enqueued (or deduped)
  401 Unauthorized — signature invalid
  410 Gone         — subscription for this resource no longer valid
```

All heavy work offloaded to workers. Handler returns within sub-second.

---

## Health & metrics

- `GET /healthz` — liveness. 200 with `{ status: 'ok', version: 'sha-abcdef' }`. No auth.
- `GET /readyz` — readiness (DB, Redis, Secrets Manager reachable). No auth. Used by ALB.
- `GET /metrics` — Prometheus scrape endpoint. Restricted to Prometheus scraper IP.

---

## Errors — common shape

```
{
  error: {
    code: 'invalid_platform' | 'account_not_found' | 'rate_limited' | ...,
    message: 'Human-readable message (do not expose to end-users verbatim).',
    request_id: '<correlation id>'
  }
}
```

Common HTTP mappings:
- `400` validation / bad input
- `401` auth missing / invalid
- `403` auth valid but action not allowed
- `404` resource not found
- `409` conflict (throttled, paused, state violation)
- `410` gone (OAuth state reused, subscription revoked)
- `429` rate-limited by **connector** itself (anti-abuse; distinct from platform rate limits)
- `502` platform upstream failed
- `503` connector degraded (DB/Redis down)

---

## Versioning

- Path-prefixed: `/v1`, `/v2`, …
- Additive changes (new fields, new endpoints) without version bump.
- **Breaking changes** require new version; old version supported for **6 months** minimum.
- Version skew between `@camaleonic/connector-contract` and running connector: connector accepts requests from any package version that matches the current or immediately-previous major; returns response shape aligned to the requested `/vN` path.

---

## Shared contract package

Everything in this doc is mirrored in `@camaleonic/connector-contract`:
- `src/api/*.ts` — request/response TypeScript types
- `src/schemas/*.ts` — Zod schemas for runtime validation
- `src/enums.ts` — shared enum values

Backend-api should `import { RefreshRequest, AccountDetail } from '@camaleonic/connector-contract'` rather than defining local copies. See [`connection-portal.md`](connection-portal.md) §4.

---

## Related docs

- [`connection-portal.md`](connection-portal.md) — Connect flow
- [`manual-refresh.md`](manual-refresh.md) — refresh endpoint detail
- [`refresh-cadence.md`](refresh-cadence.md) — admin endpoints detail
- [`06-event-catalog.md`](06-event-catalog.md) — what we emit
- [`08-operations/security.md`](08-operations/security.md) — service-token rotation
