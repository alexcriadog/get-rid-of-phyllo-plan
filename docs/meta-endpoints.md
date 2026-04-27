# Meta Endpoints & Cadence

**Status:** Reference
**Last updated:** 2026-04-26
**Scope:** Every Meta Graph API endpoint consumed by the connector (Instagram + Facebook), the OAuth permissions backing each call, and the polling cadence applied per data product.

> Sources:
> - `poc/src/modules/platforms/instagram/instagram.adapter.ts`
> - `poc/src/modules/platforms/facebook/facebook.adapter.ts`
> - `poc/prisma/seed.ts` (cadence defaults + scope sets)
> - `poc/src/modules/sync/scheduler.service.ts` (poll loop)
>
> Companion docs: [`07-platforms/instagram.md`](07-platforms/instagram.md), [`07-platforms/facebook.md`](07-platforms/facebook.md), [`rate-limiting.md`](rate-limiting.md), [`refresh-cadence.md`](refresh-cadence.md).

All calls hit `https://graph.facebook.com/v22.0` with `access_token` injected per request. Every response body is persisted to MongoDB `raw_platform_responses` (hashed + sized) before being parsed.

---

## 1. Graph API version & transport

| Item | Value |
|---|---|
| Graph API version | `v22.0` |
| Base URL | `https://graph.facebook.com/v22.0` |
| HTTP method | `GET` (every adapter call) |
| Timeout | 30 000 ms |
| Validation | `validateStatus: () => true` — status handled in adapter |
| Token transport | `access_token` query param |
| Raw archival | MongoDB collection `raw_platform_responses` (sha256 + body) |

Errors map to:
- `401 / 403` → `TokenRevokedError` (account flips to `needs_reauth`).
- `429` → `RateLimitedError` (uses `Retry-After` header).
- `2xx` outside expected shape → `AdapterFetchError` with parsed Graph error body.

Usage headers parsed on every response: `X-App-Usage`, `X-Page-Usage`, `X-Business-Use-Case-Usage`.

---

## 2. OAuth scopes requested

Defined in `poc/prisma/seed.ts`.

### Instagram (`IG_SCOPES`)
- `instagram_basic`
- `instagram_manage_insights`
- `pages_show_list`
- `pages_read_engagement`
- `business_management`

### Facebook (`FB_SCOPES`)
- `pages_show_list`
- `pages_read_engagement`
- `pages_read_user_content`
- `business_management`

> Optional today, planned later: `instagram_manage_comments`, `pages_manage_engagement`, `read_insights`.
> All scopes require **Meta App Review (Advanced Access)** for production use.

---

## 3. Cadence (poll frequency)

Stored in `cadences` table; seeded with the values below and applied by `SchedulerService.tick()` every `SCHEDULER_TICK_MS` (default `30 000` ms). Per-account overrides are supported but the defaults are:

| Platform | Product | Default interval | Notes |
|---|---|---|---|
| `instagram` | `identity` | 6 h (`21 600 s`) | Profile snapshot |
| `instagram` | `audience` | 24 h (`86 400 s`) | Demographics + account insights |
| `instagram` | `engagement_new` | 2 h (`7 200 s`) | Media list + per-media insights |
| `instagram` | `stories` | 1 h (`3 600 s`) | Hard SLO — Stories TTL is 24 h |
| `facebook` | `identity` | 6 h (`21 600 s`) | Page profile |
| `facebook` | `audience` | 24 h (`86 400 s`) | Page Insights (counters only in v22) |
| `facebook` | `engagement_new` | 2 h (`7 200 s`) | Posts + per-post insights |
| `facebook` | `stories` | 1 h (`3 600 s`) | Page Stories API — metadata only (no per-story insights endpoint today). 24 h TTL. |

Scheduler loop:
1. `findMany sync_jobs` where `status = idle` and `nextRunAt <= now`, capped at `MAX_ROWS_PER_TICK = 500`.
2. Skip accounts in `paused` / `needs_reauth`.
3. Enqueue a BullMQ `sync` job with priority `HIGH | NORMAL | BACKFILL`.

---

## 4. Rate-limit buckets per call

Token-bucket capacity / refill applied via `RateBucketService` before every Graph call.

| Platform | Bucket scope | Key template | Capacity | Refill |
|---|---|---|---|---|
| Instagram | `user_token` | `rate:ig:user_token:{hash}` | 200 | 200/h |
| Instagram | `app` | `rate:ig:app` | 200 | 200/h |
| Instagram | `page` (when known) | `rate:ig:page:{page_id}` | 200 | 200/h |
| Facebook | `app` | `rate:fb:app` | 200 | 200/h |
| Facebook | `page` (when known) | `rate:fb:page:{page_id}` | 200 | 200/h |

Cost per call = 1 token. A request is denied locally before being sent if any bucket is empty.

---

## 5. Instagram endpoints

Adapter: `InstagramAdapter` (`poc/src/modules/platforms/instagram/instagram.adapter.ts`).
Canonical id = IG Business Account id.

### 5.1 Identity — product `identity` — every 6 h

| Endpoint | Method | Params | Required scopes |
|---|---|---|---|
| `/{ig_user_id}` | GET | `fields=id,username,name,biography,profile_picture_url,followers_count,follows_count,media_count,website` | `instagram_basic`, `pages_show_list` |

Calls per run: **1**.

### 5.2 Audience — product `audience` — every 24 h

`fetchAudience()` issues, in order:

1. **Follower demographics** — `follower_demographics` × 4 breakdowns (`age`, `gender`, `country`, `city`).
2. **Reached audience** — `reached_audience_demographics` × 4 breakdowns (with `timeframe=this_month`).
3. **Engaged audience** — `engaged_audience_demographics` × 4 breakdowns (with `timeframe=this_month`).
4. **Account totals** — single `/insights` call batching: `reach`, `accounts_engaged`, `total_interactions`, `likes`, `comments`, `saves`, `shares`, `replies`, `views`, `profile_views`, `website_clicks` (period `day`, `metric_type=total_value`, last 28 days).
5. **Follower-count series** — `metric=follower_count`, `period=day`, last 28 days.

| Endpoint | Method | Key params | Required scopes |
|---|---|---|---|
| `/{ig_user_id}/insights` | GET | `metric=follower_demographics`, `period=lifetime`, `metric_type=total_value`, `breakdown=age|gender|country|city` | `instagram_manage_insights` |
| `/{ig_user_id}/insights` | GET | `metric=reached_audience_demographics`, same plus `timeframe=this_month` | `instagram_manage_insights` |
| `/{ig_user_id}/insights` | GET | `metric=engaged_audience_demographics`, same plus `timeframe=this_month` | `instagram_manage_insights` |
| `/{ig_user_id}/insights` | GET | `metric=reach,accounts_engaged,total_interactions,likes,comments,saves,shares,replies,views,profile_views,website_clicks`, `period=day`, `metric_type=total_value`, `since/until` | `instagram_manage_insights` |
| `/{ig_user_id}/insights` | GET | `metric=follower_count`, `period=day`, `since/until` | `instagram_manage_insights` |

Calls per run: **14** (12 demographic + 2 account-level).

### 5.3 Engagement — product `engagement_new` — every 2 h

`fetchContents()` walks `/media` paginated, then enriches every item.

| Endpoint | Method | Key params | Required scopes |
|---|---|---|---|
| `/{ig_user_id}/media` | GET | `fields=id,caption,media_type,media_url,permalink,timestamp,thumbnail_url,like_count,comments_count,is_shared_to_feed,is_comment_enabled,alt_text,media_product_type,shortcode,owner{id,username},collaborators{id,username},children{id,media_type,media_url,thumbnail_url,permalink}`, `limit≤25` | `instagram_basic` |
| `/{media_id}/insights` (FEED image/carousel) | GET | `metric=reach,saved,likes,comments,shares,total_interactions,follows,profile_visits` | `instagram_manage_insights` |
| `/{media_id}/insights` (FEED video) | GET | `metric=reach,saved,likes,comments,shares,total_interactions,views,follows,profile_visits` | `instagram_manage_insights` |
| `/{media_id}/insights` (REELS) | GET | `metric=reach,saved,likes,comments,shares,total_interactions,views` | `instagram_manage_insights` |
| `/{media_id}/insights` (FEED + STORY) | GET | `metric=profile_activity`, `breakdown=action_type`, `metric_type=total_value` | `instagram_manage_insights` |

Calls per run (default `limit=25`): **1 list + N media insights + ≤N profile_activity breakdowns**, i.e. ~26–51 calls per account per cycle. Failures fall back to a `metric=reach` retry.

### 5.4 Stories — product `stories` — every 1 h

| Endpoint | Method | Key params | Required scopes |
|---|---|---|---|
| `/{ig_user_id}/stories` | GET | `fields=id,media_type,media_url,thumbnail_url,permalink,timestamp` | `instagram_basic` |
| `/{story_media_id}/insights` | GET | `metric=reach,replies,shares,total_interactions,follows,profile_visits` | `instagram_manage_insights` |
| `/{story_media_id}/insights` | GET | `metric=profile_activity`, `breakdown=action_type` | `instagram_manage_insights` |
| `/{story_media_id}/insights` | GET | `metric=navigation`, `breakdown=story_navigation_action_type` | `instagram_manage_insights` |

Calls per run: **1 list + 3 calls per active story**. Stories TTL 24 h on platform; missing the cadence loses metrics permanently.

---

## 6. Facebook endpoints

Adapter: `FacebookAdapter` (`poc/src/modules/platforms/facebook/facebook.adapter.ts`).
Canonical id = Page id. Token used = Page-level access token.

### 6.1 Identity — product `identity` — every 6 h

| Endpoint | Method | Params | Required scopes |
|---|---|---|---|
| `/{page_id}` | GET | `fields=name,about,category,picture,fan_count,followers_count,link` | `pages_show_list`, `pages_read_engagement` |

Calls per run: **1**.

### 6.2 Audience — product `audience` — every 24 h

> Meta removed demographic breakdowns (country / gender_age / city) for Pages in v22. We pull activity counters with `period=day` over a 28-day window.

| Endpoint | Method | Params | Required scopes |
|---|---|---|---|
| `/{page_id}/insights` | GET | `metric=page_follows`, `period=day`, `since/until` | `read_insights` |
| `/{page_id}/insights` | GET | `metric=page_media_view`, `period=day`, `since/until` | `read_insights` |
| `/{page_id}/insights` | GET | `metric=page_total_media_view_unique`, `period=day`, `since/until` | `read_insights` |
| `/{page_id}/insights` | GET | `metric=page_views_total`, `period=day`, `since/until` | `read_insights` |
| `/{page_id}/insights` | GET | `metric=page_total_actions`, `period=day`, `since/until` | `read_insights` |

Calls per run: **5** (parallel). The five also need **ANALYZE task** on the Page for the OAuth user.

### 6.3 Engagement — product `engagement_new` — every 2 h

`fetchContents()` paginates `/posts` (lite fields), then enriches per-post.

| Endpoint | Method | Key params | Required scopes |
|---|---|---|---|
| `/{page_id}/posts` | GET | `fields=id,message,created_time,permalink_url,full_picture,attachments`, `limit≤25` | `pages_read_engagement`, `pages_read_user_content` |
| `/{page_id}_{post_id}/insights` (composite id) | GET | `metric=post_media_view,post_reactions_by_type_total,post_clicks_by_type,post_activity_by_action_type,post_video_views` | `pages_read_engagement`, `read_insights` |
| `/{video_id}/video_insights` (numeric id) | GET | `metric=total_video_views,total_video_views_unique,total_video_impressions,total_video_reactions_by_type_total` | `pages_read_engagement`, `read_insights` |

Calls per run (default `limit=25`): **1 list + up to 25 enrichment calls** in batches of 5 in parallel.

### 6.4 Stories — product `stories` — every 1 h

Implemented via the Page Stories API (GA in v22).

| Endpoint | Method | Key params | Required scopes |
|---|---|---|---|
| `/{page_id}/stories` | GET | `fields=post_id,status,creation_time,media_type,media_id,url` (optional `since`/`until`) | `pages_read_engagement`, `pages_show_list` (+ user must hold the `CREATE_CONTENT` capability on the Page) |

Calls per run: **1**. Mapped to `ContentData` with `contentType='story'`, `mediaProductType='STORY'`, `permalink=url`, `publishedAt = creation_time × 1000`. `media_id` is preserved in `metrics.extra.fb_media_id`.

> No per-story insights endpoint is exposed by Meta on this resource today — metadata only. The adapter declares story metric fields as `not_supported` / `empty_possible` in its `SupportMatrix`. If Meta exposes a metrics endpoint later, enrichment can be added with the same per-batch pattern as Instagram.

### 6.5 Pagination follow-ups (both engagement endpoints)

Whenever `paging.next` is returned, the adapter rewrites the URL to keep the same axios instance and reuses the cursor. Each page-of-results counts as one additional Graph call against the same buckets.

---

## 7. Webhooks (push, not polled)

Inbound subscriptions complement the polling above. Documented in [`07-platforms/instagram.md`](07-platforms/instagram.md) §Webhooks and [`07-platforms/facebook.md`](07-platforms/facebook.md) §Webhooks.

| Platform | Object | Subscribed fields | Activation |
|---|---|---|---|
| Instagram | `instagram` | `media`, `comments`, `mentions`, `story_insights` | `POST /{page_id}/subscribed_apps?subscribed_fields=feed` |
| Facebook | `page` | `feed`, `videos`, `live_videos` | `POST /{page_id}/subscribed_apps` |

Verification: `X-Hub-Signature-256` HMAC-SHA256 with the Meta App Secret. Webhooks carry IDs only; the worker still falls back to the polling endpoints in §5 / §6 to fetch the actual payload.

---

## 8. Worst-case call budget per account per day

Assumes default cadence and `limit=25` content fetches.

### Instagram (per IG Business Account)

| Product | Runs/day | Calls/run | Daily calls |
|---|---|---|---|
| Identity | 4 | 1 | 4 |
| Audience | 1 | 14 | 14 |
| Engagement | 12 | ~26–51 | ~312–612 |
| Stories | 24 | 1 + 3·N | 24 + 72·N (N = active stories) |
| **Total (no stories)** | | | **~330–630** |

### Facebook (per Page)

| Product | Runs/day | Calls/run | Daily calls |
|---|---|---|---|
| Identity | 4 | 1 | 4 |
| Audience | 1 | 5 | 5 |
| Engagement | 12 | up to 26 | up to 312 |
| Stories | 24 | 1 | 24 |
| **Total** | | | **~345** |

Both fit comfortably under the 200 pts/h × 24 h = 4 800 daily token budget per bucket — assuming Meta keeps `costPerCall=1`. The `X-*-Usage` headers are the source of truth in production and feed the `platform_api_usage_percent_from_headers` gauge.

---

## 9. Quick reference — endpoint × scope matrix

| Endpoint | Platform | Product | Cadence | Scopes |
|---|---|---|---|---|
| `/{ig_user_id}` | IG | identity | 6 h | `instagram_basic`, `pages_show_list` |
| `/{ig_user_id}/insights` (demographics) | IG | audience | 24 h | `instagram_manage_insights` |
| `/{ig_user_id}/insights` (account totals) | IG | audience | 24 h | `instagram_manage_insights` |
| `/{ig_user_id}/media` | IG | engagement_new | 2 h | `instagram_basic` |
| `/{media_id}/insights` | IG | engagement_new | 2 h | `instagram_manage_insights` |
| `/{ig_user_id}/stories` | IG | stories | 1 h | `instagram_basic` |
| `/{story_media_id}/insights` | IG | stories | 1 h | `instagram_manage_insights` |
| `/{page_id}` | FB | identity | 6 h | `pages_show_list`, `pages_read_engagement` |
| `/{page_id}/insights` | FB | audience | 24 h | `read_insights`, `pages_read_engagement` |
| `/{page_id}/posts` | FB | engagement_new | 2 h | `pages_read_engagement`, `pages_read_user_content` |
| `/{page_id}_{post_id}/insights` | FB | engagement_new | 2 h | `pages_read_engagement`, `read_insights` |
| `/{video_id}/video_insights` | FB | engagement_new | 2 h | `pages_read_engagement`, `read_insights` |
| `/{page_id}/stories` | FB | stories | 1 h | `pages_read_engagement`, `pages_show_list` |

---

## 10. Notes & caveats

- **`v22.0` removed several IG metrics**: `impressions` (use `reach` / `views`), per-post `post_impressions_unique` (no per-post unique reach), Page demographic breakdowns. The adapters compensate via the alternates above.
- **Per-media insights split**: Meta rejects whole batches when one metric is invalid for the media type; the adapter sends per-type metric sets and fetches `profile_activity` / `navigation` in their own breakdown calls.
- **First 24–48 h after connect**: IG insights commonly return zeros while Meta's pipeline backfills. The adapter tolerates empty bodies.
- **Long-lived token refresh** runs from `OAuthToken.lastRefreshedAt` heuristics outside this document; see [`07-platforms/instagram.md`](07-platforms/instagram.md) §Token lifecycle.
