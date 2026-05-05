# YouTube

**Status:** Stable reference
**Last updated:** 2026-04-23
**Platform APIs:** YouTube Data API v3 + YouTube Analytics API (Google Cloud Platform)

**Full OAuth integration from the start** (clarification, 2026-04-22). YouTube is no longer reduced-role — the connector provides Identity, Audience, and Engagement for official/OAuth-connected YouTube channels. The existing scraper continues to serve **unofficial** (non-OAuth) YouTube accounts only.

---

## Account eligibility

- Any YouTube channel whose owner can OAuth with their Google account.
- YouTube Analytics API access requires the account to have analytics available (brand accounts, channel owners — automatically enabled for most channels).

---

## OAuth flow + scopes

| Product | Scopes |
|---|---|
| Identity | `https://www.googleapis.com/auth/youtube.readonly` |
| Engagement (videos + metrics) | `https://www.googleapis.com/auth/youtube.readonly` |
| Audience | `https://www.googleapis.com/auth/yt-analytics.readonly` ★ |

`yt-analytics.readonly` is **separate**. Asking for it surfaces on the consent screen distinctly. Adapter requests both when audience is enabled.

**Google App Verification** is required for production — separate from Meta's App Review. Lead time 4-6 weeks; start submission in sprint 3 per the plan.

**OAuth endpoint:** `https://accounts.google.com/o/oauth2/v2/auth?client_id=...&redirect_uri=...&response_type=code&scope=...&access_type=offline&prompt=consent&state=...`

`access_type=offline` is required to get a refresh token. `prompt=consent` ensures it's returned every time.

---

## Canonical ID resolution

1. Call `GET https://www.googleapis.com/youtube/v3/channels?part=id,snippet,contentDetails&mine=true` with access token.
2. `canonical_user_id = items[0].id` (the channel ID, e.g. `UC...`).
3. Also extract `contentDetails.relatedPlaylists.uploads` — the "uploads playlist" ID used for cheap video listing (§Quota optimization).

No retries needed; Google is synchronous.

---

## Data products supported

### Identity (1 unit per call)

```
GET /youtube/v3/channels?part=snippet,statistics,brandingSettings,contentDetails&id=<channel_id>
```

Returns handle (`@customUrl` or legacy), title, description, thumbnail, subscriberCount, videoCount, viewCount, uploads playlist ID.

### Engagement — Listing new videos (quota optimization)

**Two strategies, vastly different costs:**

| Strategy | Cost per call | Use when |
|---|---|---|
| `playlistItems.list` on uploads playlist | **1 unit** | Default for backfill + periodic new-video detection |
| `search.list?channelId=...&order=date` | **100 units** | Only when we need server-side filters the other doesn't offer |

Adapter **always prefers `playlistItems.list`**. 10k-unit daily budget at 1 unit/call = 10,000 listings possible — trivially covers 50k accounts / day.

```
GET /youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=<uploads_playlist>&maxResults=50&pageToken=...
```

### Engagement — video metrics (1 unit per batch of 50)

```
GET /youtube/v3/videos?part=snippet,statistics,contentDetails&id=<video_id1>,<video_id2>,...,<video_id50>
```

Batch of 50 IDs = 1 unit. Adapter batches aggressively.

### Audience — YouTube Analytics API

```
GET /v2/reports?ids=channel==MINE&startDate=...&endDate=...&dimensions=ageGroup,gender,country&metrics=viewerPercentage
```

Separate daily quota (~2,000 queries/day). Cheaper per query than Data API but with its own budget.

### Live content, stories

- No "stories" concept on YouTube.
- Live streams: listed via `search.list?type=live`. Expensive (100 units/call). Only done if ops enables live-tracking per account.

---

## Webhooks (inbound via PubSubHubbub)

YouTube pushes new-video notifications via W3C PubSubHubbub. Setup in [`../ingestion-modes.md`](../ingestion-modes.md) §3.2.

**Subscription:** per-channel, 5-day max lease. Connector's scheduler re-subscribes every 4 days:

```
POST https://pubsubhubbub.appspot.com/subscribe
  hub.mode=subscribe
  hub.topic=https://www.youtube.com/xml/feeds/videos.xml?channel_id=<CHANNEL>
  hub.callback=https://connector.<env>.internal/webhooks/ingest/youtube
  hub.verify=sync
  hub.secret=<rotatable_secret_from_secrets_manager>
```

**Inbound payload:** Atom XML with `<entry>` containing `<yt:videoId>` and `<yt:channelId>`.

**Signature:** HMAC-**SHA1** (legacy protocol — not SHA256) in `X-Hub-Signature: sha1=<hex>`.

**Does NOT push:** deletions, visibility changes, metric updates. Polling handles those.

---

## Rate limits — YouTube is the trickiest

See [`../rate-limiting.md`](../rate-limiting.md) §4 for full strategy. The short version:

- **Data API v3:** 10,000 units/day per GCP project. Shared across **all** our YT accounts.
- **Analytics API:** ~2,000 queries/day (separate quota).
- **Back-pressure:** at ≥80% quota, pause BACKFILL jobs; at ≥95%, pause NORMAL jobs, allow only HIGH (manual refresh).
- **Reset:** UTC 00:00 daily.

**If we outgrow the 10k budget:**
1. Request quota expansion from Google (1-2 week process, usually granted).
2. If >100k accounts: multi-project routing — bucket key includes `gcp_project_id`.

---

## Token lifecycle

- Access tokens: **1 hour** validity.
- Refresh tokens: long-lived (years), obtained via `access_type=offline`.
- Refresh via `POST https://oauth2.googleapis.com/token` with `grant_type=refresh_token`.
- Google rotates refresh tokens occasionally — adapter handles the "new refresh token in response" case.
- Refresh failure (403 `invalid_grant` when user revokes at google.com/security) → `account.needs_reauth`.

---

## Historical backfill — the strongest of all five platforms

YouTube is our most "historically recoverable" platform by a wide margin.

- **Content list:** full channel history via `playlistItems.list` on the uploads playlist. **1 unit per call** of 50 items. 10,000 videos listable/day within zero quota headroom.
- **Video statistics:** current state only from Data API.
- **Audience + engagement history:** ⭐ **YouTube Analytics API** exposes daily-resolution reports going back ~2 years. Adapter does a two-pass backfill:
  1. Pass 1 — `playlistItems.list` → full video list + basic metadata
  2. Pass 2 — `reports.query` with `startDate/endDate` spanning backfill window, per dimension (age, gender, country, per-video views) → populates `posts.metric_history` and `audience_snapshots_history` in MongoDB via events
- **Analytics quota is separate** (~2,000 queries/day). Respected by its own bucket.
- **Deleted / private videos:** disappear from listings; adapter detects absence and marks `content.deleted` if previously tracked.

This makes YouTube unique: **re-backfill at any time reconstructs meaningful daily history**, not just a point-in-time snapshot.

See [`../historical-backfill.md`](../historical-backfill.md) for the cross-platform policy.

## Known quirks / landmines

- **Two APIs with separate quotas:** Data API v3 and Analytics API are different. We track both.
- **Analytics data has a 48-72h delay** — real-time views come from Data API's video `statistics`; demographic breakdowns come from Analytics with a day or two lag. Adapter marks `supported_fields.audience = supported_with_lag` and backend-api's UI can surface "showing data from N days ago".
- **`search.list` returns stale results** — the YT search index is eventually consistent. Use `playlistItems.list` for authoritative ordering.
- **Deleted or private videos** disappear from listings but `videos.list?id=X` returns 404. Adapter detects and emits `content.deleted`.
- **Live stream artifacts:** finished lives show up as VODs with extra metadata. Adapter handles both states.
- **Multiple channels per Google account:** a Brand Account can own multiple channels. OAuth returns the "primary"; the connector may need to call `channels.list?mine=true&managedByMe=true` (requires CMS scope) for agency use cases. Out of phase-1 scope.
- **Age-restricted content** may be omitted from some responses. Adapter logs and flags.
- **Shorts vs regular videos:** same `videos` endpoint; distinguish via `contentDetails.duration` <60s AND `snippet.resourceId` in the shorts feed. Normalized `content_type = 'short'`.

---

## Migration note

Until Google App Verification is complete, we can use "Testing" mode (<100 whitelisted users). For sprint-6 cutover, verification must be approved — plan has this as a tracked risk.

The **existing scraper stops being authoritative for official accounts** the moment that account cuts over to connector. It continues to run for the 10k+ unofficial YouTube accounts untouched.

---

## PoC implementation status (2026-05-05)

Live in `poc/src/modules/platforms/youtube/`. See [`../adr/0016-youtube-integration.md`](../adr/0016-youtube-integration.md) for the implementation choices: `googleapis` SDK + bare-fetch chokepoint client, three OAuth scopes from day one (incl. `yt-analytics-monetary.readonly`), two rate-limit hints (`daily_quota` daily-counter + `qps_analytics` token-bucket) with per-endpoint cost override and a 50-unit quota floor, six parallel Analytics queries for audience, top-N-by-views comments. PubSubHubbub, multi-channel Brand-Account picker, Reporting-API backfill, and OAuth verification + CASA are deferred — tracked in [`../TODO.md`](../TODO.md) §D2.

OAuth is driven manually via `GET /admin/connect/youtube/authorize-url` + `POST /admin/connect/youtube/complete`; setup walkthrough in [`../youtube-oauth-setup.md`](../youtube-oauth-setup.md).

## Related docs

- [`../adr/0016-youtube-integration.md`](../adr/0016-youtube-integration.md) — PoC implementation decisions
- [`../youtube-oauth-setup.md`](../youtube-oauth-setup.md) — Google Cloud Console step-by-step
- [`../rate-limiting.md`](../rate-limiting.md) §4 — quota algorithm detail
- [`../ingestion-modes.md`](../ingestion-modes.md) §3.2 — PubSubHubbub setup
- [`../refresh-cadence.md`](../refresh-cadence.md) — YT cadences and back-pressure interplay
- [`../09-migration/cutover-plan.md`](../09-migration/cutover-plan.md) — scraper handover for official accounts
