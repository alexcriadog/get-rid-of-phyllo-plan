# PLAN — Phyllo (InsightIQ) Schema Alignment

> **IMPLEMENTATION STATUS (2026-06-08): all 4 phases shipped to the codebase.**
> See the "Implementation & cutover runbook" section at the bottom for what
> landed, file paths, and the production cutover steps. Code compiles
> (`tsc --noEmit` clean) with 27 passing unit/contract tests. Two Prisma
> migrations are written but NOT yet applied to prod (apply on deploy).

**Goal:** the consumer backend (today pointed at Phyllo: `sm.demo.camaleonicanalytics.com/oauth/webhook-receiver` + Phyllo GET APIs) can switch to our connector by changing **only the base URL and credentials**. Decision confirmed 2026-06-05: **total compatibility** — thin webhooks identical to Phyllo's + Phyllo-shaped read API + Mongo stores documents in Phyllo shape. Scope: **Identity, Contents (engagement), Audience, Comments** (all four confirmed).

**Evidence base (captured 2026-06-05 from `api.staging.insightiq.ai` with our staging credentials):**
- `context/phyllo-api-samples/*.json` — real payloads: profiles (IG/YT/TikTok/Twitch/X), contents (IG/YT/TikTok), audience (IG), accounts, users, work-platforms, webhook config, error shape.
- `context/phyllo-api-samples/webhook-events-doc.json` — full webhook events doc text.
- `.screenshots/phyllo-airtable-digest.md` + `docs/PHYLLO-DATA-GUIDE-STUDY.md` — field availability matrices.
- Same accounts (camaleonicanalytics IG/TikTok/YT…) are connected in **both** Phyllo staging and our connector → we can golden-diff outputs.

---

## 1. The compatibility contract (what "no cambiar nada" means)

Phyllo's integration model is **notify-then-fetch**:

1. **Webhook (thin)** — `POST` to consumer with `{event, name, id, data: {account_id, user_id, last_updated_time, profile_id? | items[]}}`. Max 100 ids per `items`; multiple webhooks for larger batches. Signed via `Webhook-Signatures` header = HMAC-SHA256(secret, **raw body**) hex; multiple comma-separated signatures during key rotation. 5s timeout; retries at 60s / 5m / 6h (4 tries total); at-least-once ⇒ consumer dedupes on `id`.
2. **Read API (Basic auth `client_id:client_secret`)** — consumer fetches the actual data:

| Resource | Endpoints the consumer uses |
|---|---|
| Accounts | `GET /v1/accounts/{id}`, `GET /v1/accounts?limit&offset` |
| Users | `GET /v1/users/{id}`, `GET /v1/users?limit&offset` |
| Profiles (Identity) | `GET /v1/profiles?account_id&limit&offset`, `GET /v1/profiles/{id}` |
| Contents | `GET /v1/social/contents?account_id&from_date&to_date&limit&offset`, `GET /v1/social/contents/{id}`, **bulk** `POST /v1/social/contents/search` body `{"ids": [...]}` |
| Audience | `GET /v1/audience?account_id` (returns a single object, not a list envelope) |
| Comments | `GET /v1/social/comments?account_id&content_id&limit&offset` |

3. **Envelopes** (verified live):
   - List: `{"data": [...], "metadata": {"offset": 0, "limit": 10, "from_date": null, "to_date": null}}`
   - Error: `{"error": {"type": "RECORD_NOT_FOUND", "code": "incorrect_account_id", "error_code": "…", "message": "…", "status_code": 404, "http_status_code": 404, "request_id": "<uuid>"}}`
   - Timestamps: naive ISO with microseconds, **no timezone suffix** (`2026-06-05T11:12:04.637922`), UTC implied.
   - Percentages: 0–100 scale (`62.95`), not fractions.

4. **Webhook events** the consumer's receiver is subscribed to today (from their live webhook config): `ACCOUNTS.REMOVED`, `ACCOUNTS.DISCONNECTED`, `PROFILES.ADDED`, `PROFILES.UPDATED`, `CONTENTS.ADDED`, `CONTENTS.UPDATED`, `CONTENT-GROUPS.ADDED`, `CONTENT-GROUPS.UPDATED`, `SESSION.EXPIRED`, `PROFILES_AUDIENCE.ADDED`, `PROFILES_AUDIENCE.UPDATED`. We add `ACCOUNTS.CONNECTED` and `CONTENTS_COMMENTS.ADDED/UPDATED` support (documented Phyllo events; comments are in scope).

---

## 2. ID strategy

Phyllo ids are UUIDs; the consumer treats them as opaque strings but they must be **stable across syncs**. We mint **deterministic UUIDv5** per resource, derived from immutable internal keys, computed in one shared helper:

```
ns = uuidv5(DNS, 'connector.camaleonic.internal')   // fixed project namespace
user_id    = uuidv5(ns, 'user:'    + workspace.endUserId)
account_id = uuidv5(ns, 'account:' + accounts.id)            // our BigInt PK
profile_id = uuidv5(ns, 'profile:' + accounts.id)            // 1 profile per account
content_id = uuidv5(ns, 'content:' + accounts.id + ':' + platform_content_id)
comment_id = uuidv5(ns, 'comment:' + accounts.id + ':' + platform_comment_id)
audience_id= uuidv5(ns, 'audience:' + accounts.id)
```

Properties: no new storage needed to map (recomputable both ways via lookup collections), idempotent re-syncs produce identical ids, and re-connects of the same account keep the same `account_id` (ours reuses the row). Platform-native ids stay exposed as `external_id` exactly like Phyllo.

`work_platform.id`: **reuse Phyllo's exact UUIDs** (consumer code may map on them): Instagram `9bb8913b-ddd9-430b-a66a-d74d846e6c66`, YouTube `14d9ddf5-51c6-415e-bde6-f8ed36ad7054`, TikTok `de55aeec-0dc8-4119-bf90-16b3d1f0c987`, Facebook `ad2fec62-2987-40a0-89fb-23485972598c`, Twitch `e4de6c01-5b78-4fc0-a651-24f44134457b`, X `7645460a-96e0-4192-a3ce-a1fc30641f72`, LinkedIn `36410629-f907-43ba-aa0d-434ca9c0501a`, Instagram Direct `d3badb09-a81f-4444-bc27-1a994d939e00` (full list in `context/phyllo-api-samples/work-platforms.json`). For platforms Phyllo lacks (Threads), mint one fixed UUID and add it to the catalog.

---

## 3. Target Mongo collections (Phyllo-shaped documents)

New collections, written by the sync worker **in addition to** (phase 1) and then **instead of** (phase 3) the current normalized ones. Documents are stored exactly as they will be served — the read API becomes a thin projection.

| Collection | Keyed by | Mirrors | Replaces |
|---|---|---|---|
| `phyllo_profiles` | `account_id` (1 doc) | `/v1/profiles` object | `identity_snapshots` |
| `phyllo_contents` | `(account_id, external_id)` | `/v1/social/contents` object | `posts` (incl. stories) |
| `phyllo_audience` | `account_id` (1 doc) | `/v1/audience` object | `audience_snapshots` |
| `phyllo_comments` | `(account_id, content external_id, comment external_id)` | `/v1/social/comments` object | `comments` |

Shared envelope on every document (matches Phyllo exactly):

```jsonc
{
  "id": "<uuidv5>",
  "created_at": "2026-06-05T11:12:04.637922",   // naive UTC, microseconds
  "updated_at": "2026-06-05T11:12:04.637922",
  "user":          { "id": "<user uuid>", "name": "<end user name>" },
  "account":       { "id": "<account uuid>", "platform_username": "…", "username": "…" },
  "work_platform": { "id": "<phyllo platform uuid>", "name": "Instagram", "logo_url": "…" },
  // … resource-specific fields below, ALL fields always present (null when unavailable)
}
```

Key rule copied from Phyllo: **every field of the unified schema is always present**, `null` when the platform doesn't provide it. No per-platform document shapes.

Indexes: `phyllo_contents {account_id: 1, external_id: 1} unique`, `{account_id: 1, published_at: -1}`, `{id: 1} unique`; equivalents for the other collections.

`raw_platform_responses` is untouched (it remains our raw archive / provenance layer). Internal-only data (engagement_deep, ads, ratings, mentions) stays in its current collections — see §7.

---

## 4. Field mappings (current normalized shape → Phyllo shape)

### 4.1 Identity — `ProfileData` → profile document

| Ours (`identity_snapshots.data`) | Phyllo profile field | Notes |
|---|---|---|
| `username` | `platform_username` **and** `username` | both present, same value |
| `displayName` | `full_name`, `platform_profile_name` | YT: also `first_name`/`last_name` split |
| `biography` | `introduction` | |
| `avatarUrl` | `image_url` | |
| `profileUrl` | `url` | |
| `followersCount` | `reputation.follower_count` | IG/TikTok/X/Twitch/FB |
| `followingCount` | `reputation.following_count` | |
| `postsCount` | `reputation.content_count` | |
| `subscriberCount` (Twitch/YT) | `reputation.subscriber_count` | |
| — (YT analytics) | `reputation.watch_time_in_hours` | YT only |
| `verified` | `is_verified` | |
| `accountType` | `platform_account_type` + derive `is_business` | IG business → `is_business: true` |
| `website` | `website` | |
| `category` | `category` | |
| `country` (YT) | `country` | |
| `publishedAt` (YT) | `platform_profile_published_at` | |
| platform user id | `external_id` **and** `platform_profile_id` | both, like Phyllo |
| n/a | `emails[]`, `phone_numbers[]`, `addresses[]` | `[]` default; Twitch: fill `emails[{type:"HOME", email_id}]` from token email |
| n/a | `date_of_birth`, `gender`, `nick_name`, `work_experiences`, `education`, `publications`, `certifications`, `volunteer_experiences`, `honors`, `projects` | always `null` (Phyllo also returns null for our platforms) |
| YT/IG-specific extras (`bannerUrl`, `keywords`, `privacyStatus`, …) | **kept** — additive fields (allowed: "añadir los nuevos campos") | group under our own keys, never colliding with Phyllo names |

### 4.2 Contents — `ContentData` → content document

| Ours (`posts.data`) | Phyllo content field | Notes |
|---|---|---|
| `platformContentId` | `external_id` | |
| `contentType` | `format` + `type` | mapping below |
| `caption` | `description`; `title` = platform title (YT) or first line/derived (IG stories use overlay text or `null`) | Phyllo IG: `title` populated, `description` often null — replicate their per-platform choice: IG `title` = caption excerpt, YT `title` = video title, `description` = video description |
| `permalink` | `url` | |
| `mediaUrls[0]` | `media_url` (signed/ephemeral ok) | `media_urls[]` = `[]` unless carousel (then all children) |
| `thumbnailUrl` | `thumbnail_url` | |
| n/a (new) | `persistent_thumbnail_url` | our re-hosted long-lived thumbnail — see §8 (phase 2; `null` until then) |
| `metrics.likes/comments/shares/saves/views/reach` | `engagement.like_count/comment_count/share_count/save_count/view_count/reach_organic_count` | full `engagement` object always present with all ~20 keys, nulls included |
| `metrics.extra.*`, story metrics | `engagement.additional_info.{profile_visits, bio_link_clicked, followers_gained, story_navigation:{swipe_ups, tap_backs, tap_exits, swipe_backs, swipe_downs, tap_forwards, swipe_forwards, automatic_forwards}}` | exactly Phyllo's IG-story layout (verified live) |
| `publishedAt` | `published_at` | |
| `duration` (ISO8601 on YT) | `duration` | **convert to integer seconds** (Phyllo: `int`) |
| `privacyStatus`/visibility | `visibility` | `PUBLIC / PRIVATE / UNLISTED` upper-case |
| owner info | `platform_profile_id`, `platform_profile_name`, `is_owned_by_platform_user` | |
| hashtags/mentions parsing | `hashtags[]`, `mentions[]`, `content_tags` | parse from caption like Phyllo; `null` when none |
| n/a | `sponsored`, `collaboration`, `authors`, `audience`, `platform`, `replay_count`, email metrics | `null` |

`format` ∈ `VIDEO/IMAGE/AUDIO/TEXT/OTHER`; `type` ∈ `VIDEO/POST/STORY/TWEET/BLOG/IMAGE/THREAD/PODCAST/TRACK/REELS/STREAM/FEED/IGTV` (+`SHORTS` accepted on publish). Our `contentType` → `(format, type)`:

| ours | format | type |
|---|---|---|
| `image` | `IMAGE` | IG `FEED`→`POST`* / generic `IMAGE` |
| `video` | `VIDEO` | `VIDEO` |
| `reel` | `VIDEO` | `REELS` |
| `story` | media-based `IMAGE`/`VIDEO` | `STORY` |
| `carousel` | `IMAGE` | `POST` |
| `live`/`clip` (Twitch) | `VIDEO` | `STREAM` |
| `other` | `OTHER` | `POST` |

\* exact IG `type` values to confirm against more staging samples (our IG account has STORY samples; pull FEED/REELS samples during implementation and copy what Phyllo emits).

**Stories**: Phyllo models them as contents with `type: "STORY"` in the same collection/endpoint (verified). Our separate `stories` product folds into `phyllo_contents`.

### 4.3 Audience — `AudienceData` → audience document

Phyllo (single object per account): `countries[{code, value}]`, `cities[{name, value}]`, `gender_age_distribution[{gender, age_range, value}]`.

| Ours | Phyllo | Transform |
|---|---|---|
| `countryDistribution[{label, value}]` | `countries[{code, value}]` | label→ISO-2 `code`; value → 0–100 with 2 decimals |
| `cityDistribution` | `cities[{name, value}]` | |
| `genderDistribution` × `ageDistribution` | `gender_age_distribution[{gender: MALE/FEMALE/OTHER, age_range: "13-17"/"18-24"/…/"65-", value}]` | **store the cross product from the platform** (Meta/YT/TikTok all provide gender×age natively — change normalizers to keep the joint distribution instead of splitting it) |
| `interests`, `accountInsights`, LinkedIn extras | — | kept as **additive fields** (e.g. `interests`, `account_insights`) — consumer ignores unknown keys |

Percent scale fix: ours mixes fractions; Phyllo is 0–100. Normalize at write time.

### 4.4 Comments — `CommentData` → comment document

| Ours | Phyllo | Notes |
|---|---|---|
| `platformCommentId` | `external_id` | |
| `platformContentId` | `content.id` (**our content UUID**) + `content.url` + `content.published_at` | embed content ref like Phyllo |
| `text` | `text` | |
| `authorHandle` | `commenter_username` | |
| `authorDisplayName` | `commenter_display_name` | |
| platform commenter id | `commenter_id`, `commenter_profile_url` | YT only per their matrix; null elsewhere |
| `metrics.likes/replies` | `like_count`, `reply_count` | |
| `publishedAt` | `published_at` | (their comment docs also carry envelope + timestamps) |
| `parentCommentId`, `pinned`, `likedByCreator`, `isOwnerReply` | additive fields | Phyllo doesn't model threads — keep ours as extra keys |

### 4.5 Per-post audience (viewer demographics on the content) — TikTok, YouTube

**Phyllo reserves a slot but never fills it.** Every Phyllo `content` object carries a top-level `audience` key (verified live: present on every TikTok/YouTube/IG content, value always `null`), and the Airtable *Engagement* dictionary lists `audience` as a defined field with **zero platform checkboxes** → Phyllo does not deliver per-post audience for any platform. This is data **we have and they don't** ⇒ we fill their reserved `null` slot (additive, non-colliding).

**Where it goes:** the top-level `audience` field of the `phyllo_contents` document, reusing the **same sub-shape as account-level audience** (§4.3) for consistency.

| Ours (`posts.data.insights.*`) | → `phyllo_contents.audience.*` | Notes |
|---|---|---|
| `audienceCountries[{label,value}]` | `audience.countries[{code, value}]` | label→ISO-2; value 0–100 |
| `audienceCities[{label,value}]` | `audience.cities[{name, value}]` | |
| `audienceGenders` × age | `audience.gender_age_distribution[{gender, age_range, value}]` | joint where the platform gives it |
| `audienceTypes` (NEW/RETURN/FOLLOWER/NON_FOLLOWER) | `audience.audience_types[{label, value}]` | **additive** sub-key (no Phyllo equivalent) |

Producers today: TikTok `tiktok-video.mapper.ts:92-95` (in-band on `posts.data.insights`); YouTube per-video viewer demographics come from the engagement-deep snapshot (`countries`, `demographics`) — see §4.6 for the join.

**Invariant (Phyllo rule):** `audience` is **always present** on the content doc; arrays empty / `null` when the platform withholds them. TikTok marks these `empty_possible` (`tiktok.support-matrix.ts:51-54`) — only returned above TikTok's per-video viewer threshold, so empty is the common case.

### 4.6 Deep per-post analytics (traffic sources, devices, retention, …) — the "engagement_deep" data

**Phyllo has NO field for any of this.** Its content object's only analytics keys are `engagement.*` and `engagement.additional_info.*` (verified: YouTube content returns `engagement.additional_info: null`; no `traffic_sources` / `devices` / `retention` keys anywhere), and there is no "deep analytics" product in their catalog (Identity / Engagement / Audience / Comments / Income / Publish / Activity only). So this is entirely **our extension** — it has no native Phyllo home and must not reuse a Phyllo field name.

**Where it goes:** an **additive namespaced `insights` object** on the `phyllo_contents` document, so it rides along with `GET /v1/social/contents` — the consumer reads `content.insights` if it wants the richer data, ignores it otherwise, and nothing it parses today changes. The internal `engagement_deep_snapshots` collection stays as the raw source/archive (like `raw_platform_responses`); at write time each `items[contentId]` and the retention curve are **folded into the matching `phyllo_contents` doc** by joining on `contentId = external_id`.

Target additive shape (consistent across platforms; every key present, `null`/`[]` when unsupported):

```jsonc
"insights": {
  "traffic_sources":    [{ "source": "SEARCH", "views": 1200, "minutes": 4300, "value": 18.5 }],
  "devices":            [{ "device_type": "MOBILE", "views": 5400, "minutes": 19000 }],
  "audience_retention": [{ "elapsed_ratio": 0.0, "watch_ratio": 1.0, "relative_performance": 0.9 }],
  "viewer_demographics":[{ "gender": "MALE", "age_range": "18-24", "value": 12.3 }],
  "sharing":            [{ "service": "WHATSAPP", "shares": 42 }],
  "viewer_types":       [{ "label": "NEW_VIEWER", "value": 71.0 }],
  "retention_curve":    [{ "second": 0, "value": 100.0 }],
  "likes_timeline":     [{ "second": 5, "value": 3.2 }],
  "extra":              { /* platform metric bag, e.g. cardClicks, annotationImpressions */ }
}
```

**Per-platform landing map** (source field → internal collection → `phyllo_contents.insights.*`). This is the direct answer to "para YouTube dónde quedan devices / traffic_sources / audience retention, y para todas las plataformas":

| Platform | Deep field (source) | Internal collection today | → `phyllo_contents` |
|---|---|---|---|
| **YouTube** | traffic sources (`insightTrafficSourceType`, views+minutes) | `engagement_deep_snapshots.data.items[].trafficSources` | `insights.traffic_sources` |
| **YouTube** | **devices** (`deviceType`, views+minutes) | `…items[].devices` | `insights.devices` |
| **YouTube** | **audience retention** (`elapsedVideoTimeRatio` → watch/relative) | `…retention.points[]` | `insights.audience_retention` |
| **YouTube** | per-video countries (views+minutes) | `…items[].countries` | viewer demo → `audience.countries` (§4.5, as %) + raw kept in `insights.extra.countries` |
| **YouTube** | demographics (`ageGroup`×`gender` viewerPercentage) | `…items[].demographics` | `audience.gender_age_distribution` (§4.5) + `insights.viewer_demographics` |
| **YouTube** | sharing (`sharingService`) | `…items[].sharing` | `insights.sharing` |
| **YouTube** | card/end-screen/annotation metrics | `…items[].metrics.*` | `insights.extra.*` |
| **TikTok** | traffic sources (`impression_sources`, %) | `posts.data.insights.trafficSources` | `insights.traffic_sources` (`value` only; no views/minutes) |
| **TikTok** | retention curve (`video_view_retention`, per-second %) | `posts.data.insights.retentionCurve` | `insights.retention_curve` |
| **TikTok** | likes timeline (`engagement_likes`, per-second) | `posts.data.insights.likesTimeline` | `insights.likes_timeline` |
| **TikTok** | viewer types (NEW/RETURN/FOLLOWER/NON_FOLLOWER) | `posts.data.insights.audienceTypes` | `audience.audience_types` (§4.5) |
| **TikTok** | viewer countries/cities/genders | `posts.data.insights.audience*` | `audience.*` (§4.5) |
| **Instagram** | reels watch-time, skip rate, CTA breakdowns | `posts.data.metrics.extra.*` | `insights.extra.*` (no IG deep traffic/devices/retention exists) |
| **Facebook** | reaction-by-type, click-by-type, activity-by-type | `posts.data.metrics.extra.*` | `insights.extra.*` |
| **Threads** | views/likes/replies/reposts/quotes only | `posts.data.metrics.*` | none (no deep data) |
| **Twitch** | — (all deep `not_supported`, `twitch.support-matrix.ts:72-79`) | — | `insights` all `null`/`[]` |
| **LinkedIn** | — (per-post deep `not_supported`; org audience is account-level) | — | `insights` all `null`/`[]` |

Notes:
1. **YouTube is the only platform whose deep data lives in a separate windowed collection** (`engagement_deep_snapshots`, one doc per account, top-N videos, lower cadence due to Analytics API's 24–72h lag). The fold step must handle that the snapshot may cover only the top-N recent videos → older `phyllo_contents` docs keep `insights` from their last fold; never overwrite a populated `insights` with empties on a partial snapshot.
2. **TikTok deep data is in-band** on each post already → trivial fold (same document).
3. **`value` normalization**: YouTube gives absolute `views`/`minutes`; we additionally compute a `value` (%) for `traffic_sources` so the field is comparable to TikTok's percent-only output, but keep the raw counts.
4. These extra fields are **never emitted as their own Phyllo webhook event** — they update silently with `CONTENTS.UPDATED` (the consumer re-fetches the content and gets the richer `insights` if it reads it). Optional future: our own `ENGAGEMENT-DEEP.UPDATED` extension event (§7).

---

## 5. Webhook emitter changes (`outbound-webhooks` module)

New Phyllo-compatible event mode (per endpoint config flag `format: 'phyllo'`, default for the consumer's endpoint):

| Our internal event | Phyllo event emitted |
|---|---|
| `account.connected` | `ACCOUNTS.CONNECTED` |
| `account.disconnected` | `ACCOUNTS.DISCONNECTED` |
| first `data.identity.updated` after connect | `PROFILES.ADDED`; subsequent → `PROFILES.UPDATED` |
| first `data.audience.updated` | `PROFILES_AUDIENCE.ADDED`; then `PROFILES_AUDIENCE.UPDATED` |
| `data.engagement_new.updated` / `data.stories.updated` (new items) | `CONTENTS.ADDED` with `items: [content uuids]` (≤100/webhook, chunked) |
| metric refreshes on existing items | `CONTENTS.UPDATED` with affected ids |
| `data.comments.updated` | `CONTENTS_COMMENTS.ADDED/UPDATED` with `items` = **content** uuids whose comments changed (per Phyllo doc) |
| `token.expired` / `token.refresh_failed` (terminal) | `SESSION.EXPIRED` |

Envelope (exact):

```json
{
  "event": "CONTENTS.ADDED",
  "name": "contents added",
  "id": "<uuid4 per delivery>",
  "data": {
    "account_id": "<uuid>",
    "user_id": "<uuid>",
    "last_updated_time": "2026-06-05T11:12:04.637922",
    "items": ["<content uuid>", "..."]
  }
}
```

(`PROFILES.*` / `PROFILES_AUDIENCE.*` carry `profile_id` instead of `items`; `ACCOUNTS.*` carry neither.)

Signature: replace our `signature_header` scheme with Phyllo's for these endpoints — header `Webhook-Signatures: <hex>` = HMAC-SHA256(client_secret, raw body). Keep 100-id chunking, at-least-once retries (our delivery ledger already does 60s/5m/6h-style backoff — align intervals), 5s delivery timeout.

ADDED-vs-UPDATED tracking: per `(account_id, product)` first-sync flag (exists already as `sync_jobs.lastSuccessAt` null-check) + per-item "new vs seen" (the upsert already knows `created` vs `updated` — propagate that bit to the event buffer).

## 6. Read API — Phyllo-compatible surface (new `phyllo-compat` module)

New controller namespace mounted at `/v1` (separate from current internal `/v1/accounts/:id/...` — those stay until consumer migration completes; mount compat routes first-match or under a dedicated hostname, decide at implementation):

- `GET /v1/accounts/{id}`, `GET /v1/accounts?limit&offset` — account doc incl. `data.{identity,engagement}.{status, last_sync_at, monitor_type, refresh_since, data_available_from}` sync-state block (consumer uses it to poll sync status; map from `sync_jobs`).
- `GET /v1/users/{id}`, `GET /v1/users?limit&offset` — `{id, name, external_id, status: "ACTIVE", created_at, updated_at}` from workspace end-users.
- `GET /v1/profiles?account_id`, `GET /v1/profiles/{id}` — serve `phyllo_profiles` verbatim.
- `GET /v1/social/contents?account_id&from_date&to_date&limit&offset`, `GET /v1/social/contents/{id}`, `POST /v1/social/contents/search {ids:[≤100]}` — serve `phyllo_contents`.
- `GET /v1/audience?account_id` — serve `phyllo_audience` (single object, no list envelope).
- `GET /v1/social/comments?account_id&content_id&limit&offset` — serve `phyllo_comments` (`content_id` = our content UUID).
- `GET /v1/work-platforms`, `GET /v1/work-platforms/{id}` — static catalog with Phyllo UUIDs.

Cross-cutting: Basic auth (`client_id:client_secret` per workspace — reuse/extend existing workspace API-key model to issue id+secret pairs); list envelope `{data, metadata:{offset, limit, from_date, to_date}}`; error envelope with `error.{type, code, error_code, message, status_code, http_status_code, request_id}`; naive-UTC timestamp serialization; default `limit=10` (Phyllo's default observed), max 100.

## 7. Our extra products (additive, never colliding)

Per the agreed rule "solo añadir los nuevos campos que ofrecemos":

- **Stories** → already inside contents (`type: STORY`) + `engagement.additional_info.story_navigation`.
- **Mentions / Ratings / Ads / Engagement-deep** → stay on current internal endpoints & events; NOT mapped into the Phyllo surface in this phase. Later option: Phyllo-style naming (`/v1/social/mentions`, `MENTIONS.ADDED`) as our own extensions.
- Extra fields inside compat documents are allowed (additive keys), but **never** reuse a Phyllo field name with different semantics.

## 8. `persistent_thumbnail_url` (phase 2, optional but valuable)

Phyllo re-hosts thumbnails (`media-resources.getphyllo.com/...`). Plan: on content upsert, enqueue thumbnail fetch → store in our object storage (S3/MinIO via tools stack) → serve stable URL → set `persistent_thumbnail_url`. Until implemented, field present as `null` (consumer already handles Phyllo accounts where it's missing).

## 9. Migration & rollout phases

**Phase 0 — Contract fixtures (0.5d)**
Golden fixtures: for the accounts connected in both systems (IG `camaleonicanalytics`, TikTok, YT), store Phyllo staging responses (already in `context/phyllo-api-samples/`) as test fixtures + a contract test harness that diffs our compat output against them (ignoring values, asserting keys/types/enums).

**Phase 1 — Schema layer + dual write (2–3d)**
- `phyllo-mapper` shared module: `toPhylloProfile/Content/Audience/Comment` (pure, unit-tested per platform against fixtures), UUIDv5 helper, timestamp/percent serializers.
- Sync worker dual-writes new `phyllo_*` collections alongside existing ones. Backfill script replays existing `posts/identity_snapshots/audience_snapshots/comments` (+ `raw_platform_responses` where the normalized doc lacks a Phyllo field we can recover) into `phyllo_*`. Idempotent upserts keyed by deterministic ids.

**Phase 2 — Read API (2d)**
- `phyllo-compat` controllers + Basic auth + envelopes + error shapes. Contract tests green against fixtures. Add `persistent_thumbnail_url` pipeline if time allows.

**Phase 3 — Webhooks (1–2d)**
- Phyllo-format emitter (event mapping, envelope, `Webhook-Signatures`, ADDED/UPDATED split, 100-id chunking). Test with a webhook.site receiver, then point a staging copy of the consumer at us.

**Phase 4 — Validation & cutover (1–2d)**
- Side-by-side soak: same creator connected to Phyllo staging and to us; diff webhook streams + API reads for a week of syncs.
- Consumer flips base URL + credentials in staging → verify zero code changes needed → prod cutover per workspace.
- Decommission: stop dual-writing legacy normalized collections once no internal reader remains (admin/dashboard readers migrate to `phyllo_*` or keep both — decide then).

## 10. Risks / open questions

1. **IG `title` vs `description` semantics** — copy Phyllo's exact per-platform behavior from more samples during phase 1 (we control both sides in staging).
2. **`SESSION.EXPIRED` payload** not shown in their docs page (events list cut off) — verify via their `POST /v1/webhooks/send` simulator in staging before phase 3.
3. **Gender×age joint distribution** requires normalizer changes (we currently split) — Meta/YT/TikTok provide it natively; LinkedIn doesn't (omit rows, like Phyllo does for unsupported platforms).
4. **Threads** has no Phyllo platform UUID — mint ours; consumer must add one mapping entry (unavoidable, it's a net-new platform for them).
5. **Account `data.*` sync-state block** drives consumer polling — map our `sync_jobs` statuses to Phyllo's `NOT_SYNCED/SYNC_IN_PROGRESS/SYNCED/…` vocabulary (capture exact enum from staging accounts in phase 1).
6. Consumer's receiver subscribes to `CONTENT-GROUPS.*` — we don't have playlists/albums as a product; we simply never emit those events (valid: Phyllo also only emits where supported).

**Total estimate: ~7–9 dev days** across 4 phases, each independently shippable.

---

## Implementation & cutover runbook (shipped 2026-06-08)

### What landed

**Phase 0 — contract fixtures & tests**
- `poc/src/modules/phyllo-compat/__tests__/fixtures/*.json` — real Phyllo staging payloads (profiles/contents/audience) as golden fixtures.
- `__tests__/shape.ts` + `mappers.contract.spec.ts` — structural superset assertion: our mapper output carries **every** key Phyllo returns. `ids.spec.ts` — UUIDv5 determinism.

**Phase 1 — mapper module + dual-write**
- `poc/src/modules/phyllo-compat/` — pure mapping layer: `ids.ts` (deterministic UUIDv5), `serializers.ts` (naive-UTC µs timestamps, 2-dp percent), `buckets.ts` (count/percent/fraction → 0..100, per-platform scale-robust), `format.ts` (contentType→format/type, ISO-8601 duration→int seconds, gender/age), `work-platforms.ts` (Phyllo's exact platform UUIDs + minted Threads UUID), `mappers/{profile,content,audience,comment,envelope}.mapper.ts`.
- `poc/src/modules/sync/phyllo-dual-write.service.ts` — projects every sync result into `phyllo_{profiles,contents,audience,comments}` (best-effort, never breaks the sync). YouTube deep snapshots fold into existing content docs (`doc.audience`/`doc.insights`). Wired into `sync.worker.ts` after `persistToMongo`.
- `poc/scripts/backfill-phyllo-projection.ts` — replays existing internal collections into `phyllo_*` (idempotent; `DRY_RUN=1`, `ACCOUNT_ID=` supported).
- Mongo indexes for `phyllo_*` added in `mongo.service.ts`.

**Phase 2 — Phyllo-compatible read API** (`poc/src/modules/phyllo-api/`)
- Mounted at **`/phyllo/v1/*`** (consumer base URL = `https://<host>/phyllo`). Basic auth via new `PhylloCompatCredential` Prisma model; `PhylloBasicAuthGuard` resolves the workspace. Endpoints: `accounts`, `accounts/:id`, `users`, `users/:id`, `work-platforms[/:id]`, `profiles[?account_id]`, `profiles/:id`, `social/contents` (+`/:id`, +`POST /search` bulk ≤100), `audience?account_id`, `social/comments?account_id&content_id`. List/error envelopes + naive-UTC timestamps match Phyllo exactly. Tenancy enforced by recomputing UUIDv5 over the workspace's accounts (`PhylloAccountResolver`).
- `poc/scripts/issue-phyllo-credential.ts` — issues a `client_id`/`client_secret` pair for a workspace.

**Phase 3 — Phyllo-format webhooks**
- `poc/src/modules/outbound-webhooks/phyllo-webhook-events.ts` (event mapping) + `phyllo-webhook-emitter.service.ts` (thin payloads, minted UUIDs, ADDED-vs-UPDATED via a `phyllo_emit_state` marker, 100-id chunking, comment→content-id resolution).
- `webhook_endpoints.format` column (`camaleonic` | `phyllo`). The delivery worker signs phyllo endpoints with `Webhook-Signatures: <hex>` = HMAC-SHA256(secret, raw body); native endpoints unchanged.
- Hooked into `DataEventDispatcher.fire` (data events, always immediate), `accounts.service` (ACCOUNTS.CONNECTED/DISCONNECTED), `token-lifecycle-emitter` (SESSION.EXPIRED).
- `poc/scripts/register-phyllo-endpoint.ts` — registers the consumer's receiver URL as a phyllo-format endpoint subscribed to all Phyllo events.

**Phase 4 — validation & cutover tooling**
- `poc/scripts/validate-phyllo-parity.ts` — golden-diffs our `/phyllo/v1/*` responses against LIVE Phyllo for the same creator (reports any Phyllo key we're missing). Env-driven (PHYLLO_* + OURS_*).

### Migrations (apply on deploy — NOT yet run against prod)
- `prisma/migrations/20260608120000_phyllo_compat_credentials/` — Basic-auth credential table.
- `prisma/migrations/20260608130000_webhook_endpoint_format/` — `webhook_endpoints.format` column (default `camaleonic`, zero-downtime).

### Cutover steps (per workspace)
1. Deploy (runs both migrations). Mongo `phyllo_*` indexes self-create on boot.
2. Backfill: `npx ts-node -r tsconfig-paths/register scripts/backfill-phyllo-projection.ts` (or `ACCOUNT_ID=` for one). Go-forward syncs dual-write automatically.
3. Issue read credentials: `scripts/issue-phyllo-credential.ts <workspace>` → give the consumer `CLIENT_ID`/`CLIENT_SECRET` + base URL `https://<host>/phyllo`.
4. Register their webhook receiver: `scripts/register-phyllo-endpoint.ts <workspace> <receiver-url>` → give them the `SECRET` (verify `Webhook-Signatures`).
5. Validate parity: `validate-phyllo-parity.ts` for a creator connected in both systems (e.g. `camaleonicanalytics` IG). Expect `PARITY PASS`.
6. Consumer flips base URL + credentials. No consumer code changes — only new fields are additive.

### Known follow-ups (deferred, low-risk)
- `persistent_thumbnail_url` re-hosting pipeline (currently `null`).
- True joint gender×age distribution needs per-platform normalizer changes (today: separate `gender_distribution`/`age_distribution` additive fields; `gender_age_distribution` filled only when the platform emits combined labels). See §10.3.
- `SESSION.EXPIRED` exact payload to be confirmed via Phyllo's `POST /v1/webhooks/send` simulator.
- A dedicated compat hostname (Caddy rewrite `/phyllo` → `/`) so the consumer gets a clean `/v1` base.
- E2E test against a running stack + Mongo (unit/contract coverage is green; integration deferred).
