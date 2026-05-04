# Facebook (Pages)

**Status:** Stable reference
**Last updated:** 2026-05-04
**Platform API:** Facebook Graph API (Meta Business Platform)

Shares most infrastructure with Instagram — same Meta app, same App Review process, same BUC rate-limit model. Connector operates on **Pages only**, never personal profiles.

> **2026-05-04 invariants:** the only access-token type persisted for FB Pages is the **Page access token** sourced from `/me/accounts`. `AccountsService.seedAccount()` normalises any incoming User token before encryption — see [ADR 0015](../adr/0015-token-type-normalization.md). Rate limiting follows Meta's `X-Business-Use-Case-Usage` per `(App, Page)` plus the global `X-App-Usage` (`200 × DAU/h`); the synthetic 200/h local cap has been retired — see [ADR 0014](../adr/0014-meta-rate-limit-mirror.md). Note: empirically `/{page_id}/insights` and `/{page_id}/stories` calls *do* return `X-App-Usage` even with a Page token — the BUC mirror handles this correctly because it follows the headers, not the public docs ([open question in TODO.md](../TODO.md#f-open-questions)). The `engagement_new` job re-fetches insights for the last 90 days of posts on every run (`refresh-cadence.md` §0).

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
| Audience | ✓ (partial) | Country + city distributions via the **modern** `page_follows_country` and `page_follows_city` metrics (Meta renamed them from `page_fans_country` / `page_fans_city` in March 2024 — drop the "s" in "follow"). Gender/age have **no replacement** — Meta sunsetted `page_fans_gender_age` with no successor. Adapter also pulls follower count series + activity counters: `page_follows`, `page_media_view`, `page_total_media_view_unique`, `page_views_total`, `page_total_actions` (all `period=day` over 28 days). |
| Engagement (posts) | ✓ | `GET /{page-id}/posts?fields=id,message,created_time,permalink_url,full_picture,attachments,insights.metric(post_impressions,post_reactions_by_type_total)` |
| Engagement (videos) | ✓ | `GET /{page-id}/videos?fields=id,title,description,source,length,created_time,video_insights.metric(total_video_views)` |
| Stories | ✓ (1h cadence) | `GET /{page-id}/stories?fields=post_id,status,creation_time,media_type,media_id,url` — Page Stories API, GA in v22. No per-story insights endpoint exposed today; we collect metadata only. TTL 24h on the platform side, same as IG. |
| Comments (P2) | planned | `GET /{post-id}/comments` |

Content types: `post`, `video`, `story`.

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

## Historical backfill

- **Content list:** full history of Page posts and videos. Paginate `/{page-id}/posts` and `/videos`.
- **Metrics at backfill:** current state for each post.
- **Page Insights historical windows:** `lifetime` / `days_28` periods available back up to 2 years for many metrics. Adapter uses these for richer first-connect context where the platform exposes them.
- **Live broadcasts:** past broadcasts are listable as videos; live-state events are only in real-time via EventSub-equivalent (Meta doesn't push historical live transitions).
- **Cost:** paginates within the normal BUC budget.

See [`../historical-backfill.md`](../historical-backfill.md) for the cross-platform policy.

## Known quirks / landmines

- **Today's `backend-api` has an FB video URL workaround** (RapidAPI resolve via `withFacebookVideoRateLimit`) because InsightIQ returned image URLs for video posts. With direct Graph API access via our adapter, this workaround becomes **unnecessary** for the connector. Backend-api's S3 copy logic can drop the RapidAPI dependency when it switches to connector events. This is a meaningful operational win.
- **Page Insights delay:** metrics for a post can be empty for the first 24h; stabilize after 48h. Same as IG.
- **Audience demographics: country/city YES, gender/age NO.** Meta renamed the demographic metrics in March 2024:
  - `page_fans_country` → **`page_follows_country`** (no "s" in "follow"). Works.
  - `page_fans_city` → **`page_follows_city`**. Works.
  - `page_fans_gender_age` → **no replacement**. Genuinely removed.
  - `page_fans_locale` → **no replacement**.

  The adapter now pulls `page_follows_country` and `page_follows_city` with `period=day` and takes the LAST snapshot value (the response shape is `values[].value = {COUNTRY_CODE: count}`). For Padelwithjud (795 followers): AR=380, ES=131, MX=65, CL=31, IT=19, ... — totals match `followers_count`.

  The error message Meta returns for the deprecated names is misleading: `(#100) The value must be a valid insights metric` is the **same** error it returns for genuinely invalid metric names. There is no signal that the metric was simply renamed. We only found the new names by digging into a third-party docs portal (Whatagraph) that documented the migration, then verifying empirically.

  Discovery trail (kept for posterity): probed `page_followers_country` (with "s") — rejected. Probed every variant we could think of (`page_audience_*`, `pages_followers_*`, page-level breakdowns) across v18-v25 — all rejected. Compared scopes against Phyllo's OAuth URL → identical scope set. Investigated `AudienceDistribution` Graph type → Marketing-API-only. Investigated Marketing API path → blocked by lack of Ad Account on creator Pages. Finally found the rename note in [Whatagraph's deprecation guide](https://help.whatagraph.com/en/articles/12587013) and verified `page_follows_country` works in one shot.
- **Story metrics aggregation lag (24-48h, sometimes longer):** `/{post_id}/insights` for a Page story exposes 9 documented metrics (`page_story_impressions_by_story_id`, `page_story_impressions_by_story_id_unique` titled "Story reach", `story_total_media_view_unique`, etc.) but Meta's Graph API returns `value: 0` with `end_time: "1970-01-02T00:00:00+0000"` until backend aggregation completes — that epoch+1day timestamp is Meta's sentinel for "no data yet". The Pages Manager UI shows the real number (e.g. 90 viewers) much sooner because it pulls from a real-time backend the Graph API does not expose. Reactions / `story_interaction` populate immediately; impressions / reach / views can lag a full day or more. Our 1h cadence will pick the values up once Meta backfills — no code workaround possible. Verified with `scripts/fb-debug-story-viewers.ts`.
- **Private Pages:** if Page admin restricts access or changes privacy, insights return 403 — adapter classifies as `account.needs_reauth` reason `'platform_visibility_changed'`.
- **Graph API version deprecation:** Meta deprecates API versions on a ~2-year cycle. Adapter pins a specific version (`v18.0`, `v19.0`, etc.); upgrade is a targeted change, not urgent.
- **Multi-page users (agencies):** a single user may admin 10+ pages. OAuth returns all; UI should let user select which to connect. Each page is a separate `accounts` row.

---

## Related docs

- [`instagram.md`](instagram.md) — sister platform sharing Meta infra
- [`../rate-limiting.md`](../rate-limiting.md) §10 — Meta bucket config
- [`../ingestion-modes.md`](../ingestion-modes.md) §3.1 — Meta webhook setup
- [`../connection-portal.md`](../connection-portal.md) — consent flow
