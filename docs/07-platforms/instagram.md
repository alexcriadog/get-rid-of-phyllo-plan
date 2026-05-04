# Instagram

**Status:** Stable reference
**Last updated:** 2026-05-04
**Platform API:** Instagram Graph API (Meta Business Platform)

Instagram is the highest-volume platform for the connector. Two distinct OAuth flows are supported: **Business via Facebook Page** (primary) and **IG Direct** (legacy, preserved for parity with existing accounts).

> **2026-05-04 invariants:** the only access-token type persisted for IG is the **Page access token** (or, equivalently, an IG_User token sourced from the linked Page). `AccountsService.seedAccount()` normalises every incoming token via `/me/accounts` before encryption — see [ADR 0015](../adr/0015-token-type-normalization.md). Rate limiting follows Meta's `X-Business-Use-Case-Usage` per `(App, IG Business Account)` rather than a synthetic local cap — see [ADR 0014](../adr/0014-meta-rate-limit-mirror.md). The `engagement_new` job re-fetches insights for the last 90 days of posts on every run (`refresh-cadence.md` §0).

---

## Account eligibility

- **Business via FB Page:** account must be Instagram Business or Creator AND linked to a Facebook Page the user administers.
- **IG Direct:** Instagram account linked directly (no FB Page required). Used for accounts the user manages without owning the FB Page. Code path already exists today (`is_ig_direct`, `getInstagramDirectAccountId`).
- **Personal accounts are not supported.** The UI must surface this before OAuth starts (F-08).

---

## OAuth flow + scopes

### Business via FB Page

Scopes requested:

| Product | Scopes |
|---|---|
| Identity | `instagram_basic`, `pages_show_list` |
| Audience | `instagram_manage_insights` |
| Engagement | `instagram_manage_insights`, `business_management` |
| Comments (phase 2) | `instagram_manage_comments` |

Scopes are declared in code as `REQUIRED_SCOPES` per product (see [`../03-extensibility.md`](../03-extensibility.md) §4). Adding a product = new map entry + App Review.

All scopes require **Meta App Review** — lead time 2-4 weeks per cycle. Advanced access required for production.

### IG Direct

Scopes requested (Instagram Basic Display API or Graph API direct IG flow):
- `instagram_basic`
- `instagram_manage_insights` (if audience/engagement needed)

Fewer scopes; simpler consent screen. Data availability is narrower — some business insights not exposed via this flow.

---

## Canonical ID resolution

After OAuth, we must resolve the **canonical platform user ID** because the ID returned in the token is often the FB user ID, not the IG business account ID.

### Business via FB Page
1. Call `GET /me/accounts` with access token → get list of Pages user administers.
2. For each Page, call `GET /{page-id}?fields=instagram_business_account` → get linked IG Business Account ID.
3. Match the IG account the user indicated during flow → store `canonical_user_id = instagram_business_account.id`.
4. Retries: 2s, 5s, 10s (Graph API consistency sometimes lags).

### IG Direct
1. Call `GET /me?fields=id,username` with IG token.
2. `canonical_user_id = id`.
3. Retries same as above.

Failure → `pending_resolution_failed` status, surfaced as error in callback redirect.

---

## Data products supported

| Product | Supported | Notes |
|---|---|---|
| Identity | ✓ | `GET /{ig-account-id}?fields=username,name,biography,profile_picture_url,followers_count,follows_count,media_count` |
| Audience | ✓ | `GET /{ig-account-id}/insights?metric=audience_gender_age,audience_country,audience_city&period=lifetime` — Business-only |
| Engagement (content) | ✓ | `GET /{ig-account-id}/media?fields=id,caption,media_type,media_url,permalink,timestamp,insights.metric(...)` |
| Stories | ✓ (1h cadence) | `GET /{ig-account-id}/stories` — TTL 24h on platform side |
| Comments | planned P2 | `GET /{media-id}/comments` |

Content types normalized into our `content_type` enum: `post`, `reel`, `story`, `carousel`. Carousels get one row in `posts` with multiple entries in `media_urls` JSON.

---

## Webhooks (inbound to connector)

Instagram Graph API Webhooks via Meta App Dashboard. Setup in [`../ingestion-modes.md`](../ingestion-modes.md) §3.1.

Subscribed fields:
- `media` — new posts + mentions of user
- `comments`
- `mentions`
- `story_insights` — fires when story expires with final metrics

After OAuth, connector calls `POST /{page-id}/subscribed_apps?subscribed_fields=feed` to activate for the specific page. Idempotent.

**Signature:** HMAC-SHA256 with Meta App Secret, `X-Hub-Signature-256` header.

**Caveats:**
- Webhooks only carry IDs and change-type, not full data. Worker must fetch via Graph API.
- Subscription silently expires when page access token expires → connector re-subscribes after each successful token refresh.
- Duplicates happen. Idempotency key: `hash(entry.id + entry.time + changes)` stored in `inbound_webhook_log`.

---

## Rate limits

Meta's Business Use Case (BUC) model. See [`../rate-limiting.md`](../rate-limiting.md) §1, §10 for full config.

Buckets declared by adapter:
- `user_token` (200 pts/hr per access token)
- `app` (per-app aggregate)
- `page` (per-page)

Monitoring headers: `X-App-Usage`, `X-Business-Use-Case-Usage`, `X-Page-Usage`. Fed into `platform_api_usage_percent_from_headers{platform=ig}` gauge.

---

## Token lifecycle

- Access tokens: **short-lived** (1 hour) from user login.
- Exchange to **long-lived** (60 days) via `GET /oauth/access_token?grant_type=fb_exchange_token&...`. Done immediately after OAuth callback.
- Refresh before expiry: at T-14 days, connector refreshes via same endpoint. Success emits `token.refreshed`.
- Refresh failure → `account.needs_reauth`.

Tokens are envelope-encrypted (D-07, see [`../08-operations/security.md`](../08-operations/security.md)).

---

## Historical backfill

- **Content list:** full history available. Paginate `/me/media` backward; no depth limit other than our choice.
- **Metrics:** current state only. Historical daily series is what we've been polling (now in backend-api's MongoDB).
- **Stories:** not recoverable — 24h TTL on the platform.
- **Insights historical windows:** some Business Insights expose `lifetime` / `days_28` periods that return data going back weeks; adapter uses where applicable for richer first-connect snapshots.
- **Cost:** IG paginates without extra budget impact beyond the normal user-token bucket.

See [`../historical-backfill.md`](../historical-backfill.md) for the cross-platform policy.

## Known quirks / landmines

- **Instagram Graph API returns 0s in insights** during the first 24-48h after a Business account connects — the Insights backend takes time to populate. Adapter tolerates empty responses and marks `supported` in field_support; dashboard shows "populating" state for first day.
- **Stories TTL is 24h.** Adapter pulls every 1h. If we miss the window, metrics are lost forever — only connector of the 5 that imposes this SLO.
- **Carousel posts** return media_url for the first child only in some API calls; use `/{media-id}/children` for full list.
- **Private accounts:** a business account that switches to private stops returning insights. Adapter detects empty insights with public content present → emits `account.needs_reauth` with reason `'platform_visibility_changed'`.
- **Meta often silently degrades** during major platform events (IG outages). Our rate buckets handle 429, but 500s we retry with backoff. Ops alert on 500-rate > 5%/min for 10min.
- **Long-lived token refresh sometimes returns the same token.** Adapter treats that as success; `expires_at` still extended.
- **App Review resets if the app is marked "In Development"** accidentally. Ops procedure: periodic review state check via Meta API.

---

## Related docs

- [`../rate-limiting.md`](../rate-limiting.md) — bucket configs
- [`../ingestion-modes.md`](../ingestion-modes.md) §3.1 — webhook subscription setup
- [`../connection-portal.md`](../connection-portal.md) — consent flow UI
- [`../06-event-catalog.md`](../06-event-catalog.md) — events emitted
- [`facebook.md`](facebook.md) — shares Meta Graph infra
