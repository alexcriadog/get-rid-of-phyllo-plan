# TikTok

**Status:** Stable reference
**Last updated:** 2026-04-23
**Platform API:** TikTok for Business / TikTok Creator API

Polling-first integration. TikTok's webhook coverage is incomplete; the connector does not rely on it for phase 1. **Audience data is thin** — matches what the existing Phyllo integration exposes today.

---

## Account eligibility

- Business or Creator tier TikTok accounts (TikTok Business App).
- Personal accounts are not supported via the official API.

---

## OAuth flow + scopes

TikTok has **per-product app reviews** — each scope requires separate approval (3-7 day cycles).

| Product | Scopes |
|---|---|
| Identity | `user.info.basic` |
| Identity (full) | `user.info.profile`, `user.info.stats` |
| Engagement (videos) | `video.list`, `video.insights` |
| Comments (P2) | `comment.list` |

**OAuth endpoint:** `https://www.tiktok.com/v2/auth/authorize/?client_key=...&scope=...&response_type=code&redirect_uri=...&state=...`

---

## Canonical ID resolution

1. Call `POST https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username` with access token.
2. `canonical_user_id = data.user.open_id`.
3. Retries: 2s, 5s, 10s — TikTok occasionally returns 500 immediately after OAuth.

(Today's codebase uses `getTikTokAccountInfo` with retry for exactly this reason.)

---

## Data products supported

### Identity
```
POST /v2/user/info/?fields=...
Body: { access_token: <token> }
```
Returns username, display_name, avatar, bio, follower_count, following_count, likes_count, video_count.

### Engagement (video list)
```
POST /v2/video/list/?fields=id,title,cover_image_url,create_time,duration,view_count,like_count,comment_count,share_count
Body: { access_token: <token>, max_count: 20, cursor: <cursor> }
```

Cursor pagination. `video.insights` scope required for per-video metrics beyond the basic counts.

### Audience (weak)
Official TikTok API exposes very limited audience data — some follower demographics for Business accounts with sufficient activity. Adapter marks most audience fields as `supported_with_limitations`. `gender`/`age`/`country` are sometimes populated, often empty even for active accounts.

### Video download URLs
**Official TikTok API does NOT return downloadable video URLs.** Today backend-api uses **TikAPI** (third-party) to fetch download URLs. That usage stays in backend-api — the connector's `posts.media_urls` returns only what TikTok's official API returns (cover image, preview). Backend-api's S3 copy logic continues using TikAPI for the actual video file.

---

## Webhooks — partial, not used in phase 1

TikTok exposes some webhook events (video publish, account disconnection) but coverage is incomplete. The connector **does not rely on TikTok webhooks** for phase 1. All ingestion is polling.

Inbound URL `/webhooks/ingest/tiktok` is reserved for later activation if TikTok's webhook coverage improves.

---

## Rate limits

Per-endpoint counters. Published limits (subject to change):
- `video.list`: 100 calls/hour/user
- `user.info`: 600 calls/hour/user
- `video.insights`: similar to video.list

No live usage header — we rely on 429 responses with `Retry-After`.

Bucket config in [`../rate-limiting.md`](../rate-limiting.md) §10. One bucket per `(user, endpoint)`.

---

## Token lifecycle

- Access tokens: **24 hours**.
- Refresh tokens: **365 days** (once-per-year refresh at minimum).
- Refresh via `POST /v2/oauth/token/` with `grant_type=refresh_token`.
- Refresh tokens **can rotate** — adapter always stores the new refresh token from each response.
- User revocation on TikTok → refresh returns error → `account.needs_reauth`.

---

## Historical backfill

- **Content list:** paginate `/v2/video/list/` backward via cursor. TikTok's effective limit is not strictly documented; adapter paginates until the cursor runs out or the platform returns empty. Observed behaviour historically returns at least 1-2 years of content for active Business accounts; less reliable for very long-lived accounts.
- **Metrics at backfill:** current state only.
- **Video details (views/likes/shares):** `video.insights` scope exposes richer per-video metrics but no historical time-series.
- **Audience:** limited to current (and only if the account has sufficient activity).
- **Cost:** paginates via the standard user-endpoint buckets.

See [`../historical-backfill.md`](../historical-backfill.md) for the cross-platform policy.

## Known quirks / landmines

- **App Review per scope:** adding a new scope = new review cycle. Plan ahead for audience/comments phase-2 scopes.
- **`open_id` vs `union_id`:** `open_id` is per-app; `union_id` is per-developer-account across all its apps. We use `open_id` as canonical since it's stable for our single app.
- **Cursor format differs between endpoints** — don't reuse cursors across calls.
- **Empty fields vs unsupported:** TikTok sometimes returns `null` for demographic fields even for high-activity accounts. Adapter treats null as `empty_possible` status in the field-support matrix rather than `not_supported`.
- **Rate limits reset unpredictably** — documented as per-hour but observed intermittent behavior. The bucket model handles it as sliding window; 429s escalate to adapter-level reactive backoff.
- **Creator Tool API vs Business API** — different OAuth flows and scopes. Connector supports both (auto-detect by scope set).
- **No "story" or "live" concept** on TikTok. Only videos.

---

## Current backend-api dependency

Today backend-api uses **TikAPI** for:
1. TikTok account info after OAuth (canonical ID resolution backup) — can be dropped in favor of official `/v2/user/info`.
2. Video download URLs — **stays in backend-api**, not the connector's concern.

Migration from Phyllo → connector for TikTok is a clean swap of the adapter. TikAPI continues to serve backend-api for video downloads only.

---

## Related docs

- [`../rate-limiting.md`](../rate-limiting.md) §10 — bucket config
- [`../ingestion-modes.md`](../ingestion-modes.md) §3.4 — polling-only mode
- [`../refresh-cadence.md`](../refresh-cadence.md) — cadence table
