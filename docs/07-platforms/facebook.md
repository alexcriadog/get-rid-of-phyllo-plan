# Facebook (Pages)

**Status:** Stable reference
**Last updated:** 2026-04-23
**Platform API:** Facebook Graph API (Meta Business Platform)

Shares most infrastructure with Instagram — same Meta app, same App Review process, same BUC rate-limit model. Connector operates on **Pages only**, never personal profiles.

---

## Account eligibility

- Must be a Facebook **Page** (business, brand, creator, public figure).
- User must be an admin or editor of the Page.
- **Personal profiles are not supported** — Meta policy disallows personal data scraping via API.

---

## OAuth flow + scopes

| Product | Scopes |
|---|---|
| Identity | `pages_show_list`, `pages_read_engagement` |
| Audience | `read_insights`, `pages_read_engagement` |
| Engagement | `pages_read_engagement`, `pages_read_user_content`, `business_management` |
| Comments (P2) | `pages_manage_engagement` |

All scopes require Meta App Review. Shared Meta app with Instagram — one review cycle covers both.

**OAuth endpoint:** `GET https://www.facebook.com/{api-version}/dialog/oauth?client_id=...&scope=...&redirect_uri=...&state=...`

---

## Canonical ID resolution

1. Call `GET /me/accounts?fields=id,name,access_token` with the user token → list of Pages.
2. User selects which Page to connect (in frontend-app UI) — or we connect all of them (depending on product flow).
3. `canonical_user_id = <page-id>`.
4. Store the **Page-level access token** (different from user token) — this is what we use for data calls.

No retries typically needed; `/me/accounts` is synchronous.

---

## Data products supported

| Product | Supported | Notes |
|---|---|---|
| Identity | ✓ | `GET /{page-id}?fields=name,about,category,picture,fan_count,followers_count,link` |
| Audience | ✓ | `GET /{page-id}/insights?metric=page_fans_country,page_fans_gender_age,page_fans_city&period=lifetime` |
| Engagement (posts) | ✓ | `GET /{page-id}/posts?fields=id,message,created_time,permalink_url,full_picture,attachments,insights.metric(post_impressions,post_reactions_by_type_total)` |
| Engagement (videos) | ✓ | `GET /{page-id}/videos?fields=id,title,description,source,length,created_time,video_insights.metric(total_video_views)` |
| Comments (P2) | planned | `GET /{post-id}/comments` |

Content types: `post`, `video`. FB doesn't have "stories" at Page level.

---

## Webhooks

Graph API Webhooks, `page` object. Fields subscribed:
- `feed` — new posts, edits, deletes
- `videos` — new uploads, edits
- `live_videos` — broadcast start/end

Subscription activation per-page via `POST /{page-id}/subscribed_apps`. Same pattern as IG.

**Signature:** HMAC-SHA256 with Meta App Secret, `X-Hub-Signature-256` header.

Caveats same as IG — IDs only, must fetch full; silent subscription expiry with token; re-subscribe on refresh.

---

## Rate limits

Shared Meta app-level BUC limits with Instagram. See [`../rate-limiting.md`](../rate-limiting.md) §10 for bucket configs. Two adapter buckets per FB account:
- `page` — 200 pts/hr per page
- `app` — shared pool at the Meta app level (across IG + FB)

---

## Token lifecycle

- **Page access tokens** are long-lived by default when obtained from a long-lived user token (do the user-token → long-lived-user-token → page-token dance).
- Page tokens don't typically expire unless the user changes their password or revokes.
- Refresh via same user-token exchange flow.
- A password change on the user's account invalidates all page tokens → `account.needs_reauth`.

---

## Known quirks / landmines

- **Today's `backend-api` has an FB video URL workaround** (RapidAPI resolve via `withFacebookVideoRateLimit`) because InsightIQ returned image URLs for video posts. With direct Graph API access via our adapter, this workaround becomes **unnecessary** for the connector. Backend-api's S3 copy logic can drop the RapidAPI dependency when it switches to connector events. This is a meaningful operational win.
- **Page Insights delay:** metrics for a post can be empty for the first 24h; stabilize after 48h. Same as IG.
- **Private Pages:** if Page admin restricts access or changes privacy, insights return 403 — adapter classifies as `account.needs_reauth` reason `'platform_visibility_changed'`.
- **Graph API version deprecation:** Meta deprecates API versions on a ~2-year cycle. Adapter pins a specific version (`v18.0`, `v19.0`, etc.); upgrade is a targeted change, not urgent.
- **Multi-page users (agencies):** a single user may admin 10+ pages. OAuth returns all; UI should let user select which to connect. Each page is a separate `accounts` row.

---

## Related docs

- [`instagram.md`](instagram.md) — sister platform sharing Meta infra
- [`../rate-limiting.md`](../rate-limiting.md) §10 — Meta bucket config
- [`../ingestion-modes.md`](../ingestion-modes.md) §3.1 — Meta webhook setup
- [`../connection-portal.md`](../connection-portal.md) — consent flow
