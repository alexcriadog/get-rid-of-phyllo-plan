# Max-capture for ALL platforms — design & field map

**Date:** 2026-07-16 · **Branches:** connector `feat/max-capture-all-platforms` (off `main`), backend `feat/max-capture-all-platforms-back` (off `develop`)

Threads set the precedent: the connector captures everything the platform API offers and
exposes it on `/v1` as **additive, only-when-present, snake_case keys**; socialmedia-backend
persists that superset into the shared `posts` collection. This change extends the same
pattern to every other platform, with three invariants:

1. **Reuse names across platforms.** One concept = one key, everywhere (`alt_text` is the same
   key for Threads and Instagram; `category_id` serves YouTube's videoCategoryId and Twitch's
   game_id). snake_case on `/v1` and in Mongo schemas, camelCase in entities.
2. **Never store the same datum twice.** Derived values are not persisted (e.g. `title` is the
   caption's first line on most platforms → not persisted outside YouTube's real `video_title`).
   Where a Phyllo-canonical slot exists, we FILL it instead of inventing a new key
   (FB `shares` → `engagement.share_count`; TikTok `video_duration` → `duration`; TikTok
   `is_ad` → `sponsored`; FB `place` → `location`; IG `collaborators` → `collaboration` + `authors`).
3. **Additive only — zero shape change for existing docs.** New keys appear only when the
   platform exposed the datum (`...(x != null ? { key: x } : {})`). Phyllo payloads and
   already-stored docs are untouched. Backend writes use `?? undefined` so absent keys are
   simply not written.

## 1. Canonical fills (no new keys — reuse Phyllo slots)

| Platform | Source datum | Fills |
|---|---|---|
| Facebook | `shares.count` (new fetch field) | `engagement.share_count` |
| Facebook | `place` (new fetch field) | `location` (existing additive key, tagged-place shape) |
| Facebook | `message_tags` names (new fetch field) | `mentions` (union with caption-derived) |
| TikTok | `video_duration` | `duration` (int seconds) |
| TikTok | `is_ad` | `sponsored: { is_sponsored, tags: null }` |
| Instagram | `collaborators{username}` (already fetched) | `collaboration: { has_collaboration: true }` + `authors: string[]` |
| LinkedIn | video asset `duration` (ms, already fetched) | `duration` (int seconds) |

## 2. Additive keys — reused across platforms (existing ones from Threads marked ✓)

| /v1 key (snake) | Entity prop (camel) | Type | Platforms |
|---|---|---|---|
| `alt_text` ✓ | `altText` | string | Threads ✓, **Instagram** (already fetched, was dropped) |
| `link_attachment_url` ✓ | `linkAttachmentUrl` | string | Threads ✓, **LinkedIn** (article.source), **Facebook** (link attachment `unshimmed_url`) |
| `link_attachment_title` (new) | `linkAttachmentTitle` | string | **LinkedIn** (article.title), **Facebook** (attachment title) |
| `location` ✓ | `locationData` | object | Threads ✓, **Facebook** (place) |
| `media_product_type` (new) | `mediaProductType` | string | **IG** (FEED/REELS/STORY/AD), **FB** (status_type), **YouTube**, **Twitch** (ARCHIVE/HIGHLIGHT/UPLOAD/CLIP) |
| `embed_url` (new) | `embedUrl` | string | **TikTok**, **YouTube**, **Twitch** |
| `category_id` (new) | `categoryId` | string | **YouTube** (videoCategoryId), **Twitch** (game_id) |
| `default_language` (new) | `defaultLanguage` | string | **YouTube**, **Twitch** |
| `upload_status` (new) | `uploadStatus` | string | **YouTube**, **LinkedIn** (lifecycleState) |

## 3. Additive keys — single-platform (same mechanism, ready for reuse)

| /v1 key | Type | Platform | Source |
|---|---|---|---|
| `is_comment_enabled` | boolean | Instagram | already fetched, was dropped |
| `is_shared_to_feed` | boolean | Instagram | already fetched (canonical), was dropped at /v1 |
| `default_audio_language` | string | YouTube | canonical, was dropped at /v1 |
| `definition` / `dimension` | string | YouTube | hd/sd · 2d/3d |
| `has_captions` | boolean | YouTube | normalize API "true"/"false" |
| `licensed_content` / `embeddable` / `public_stats_viewable` / `made_for_kids` | boolean | YouTube | canonical, dropped at /v1 |
| `license` | string | YouTube | youtube/creativeCommon |
| `live_broadcast_content` | string | YouTube | none/upcoming/live |
| `topic_categories` | string[] | YouTube | Wikipedia topic URLs |
| `recording_date` | string | YouTube | ISO timestamp |
| `recording_location` | object | YouTube | `{latitude, longitude, altitude}` (GPS ≠ tagged place → NOT `location`) |
| `live_streaming_details` | object | YouTube | start/end/scheduled/concurrentViewers |
| `is_featured` | boolean | Twitch clips | already fetched, was dropped |
| `source_video_id` | string | Twitch clips | source VOD reference |
| `engagement.additional_info.reactions_breakdown` | object | Facebook | `{like, love, wow, haha, sad, angry, care}` from post_reactions_by_type_total |

## 4. Connector changes (`poc/`)

- `platform-types.ts`: add `mentions?`, `sponsored?` (bool), `collaborators?` (string[]),
  `isCommentEnabled?`, `linkAttachmentTitle?`, `isFeatured?`, `sourceVideoId?` to `ContentData`.
- `api-types.ts`: optional keys on `ApiContent` per tables above; `reactions_breakdown` on
  `ApiEngagementAdditionalInfo`.
- `content.mapper.ts`: extend the only-when-present spread block; `authors` from
  `collaborators`; `sponsored`/`collaboration` objects; `mentions` union; reactions_breakdown
  collection from `extra.reaction_*` keys.
- Platform mappers: IG (alt_text, collaborators, is_comment_enabled), TikTok (duration,
  sponsored), LinkedIn (article → link attachment, video duration), Twitch (is_featured,
  source_video_id, VOD type → mediaProductType), FB (place→location, shares→metrics.shares,
  message_tags→mentions, status_type→mediaProductType, link attachments). YouTube: mapper-only
  projection (canonical already complete).
- `facebook-content.fetcher.ts`: extended field list **with automatic degrade** — if the
  extended `/posts` call fails with a Graph field error, retry the same page with the current
  lite field list and remember for the rest of the run (never break sync on a field Meta
  rejects; log which field set was used).
- Contract tests per platform mirroring `content-threads-additive.spec.ts`.

## 5. Backend changes (`socialmedia-backend`)

- `insightiq-content.responses.ts`: optional superset keys per tables (all `?:`).
- `oauth-content.entity.ts`: camelCase props + `fromResponse` mapping (`?? null`).
- NEW shared helper `assignProviderExtras(post, content)` (parsers layer): assigns the ENTIRE
  superset uniformly; ALL 7 platform parsers call it (replaces the hand-rolled blocks in
  IG/TikTok/Threads — IG gains `completion_rate`, TikTok gains `reels_skip_rate`, all gain the
  full key set). Platform-specific constructor slots stay in each parser (e.g. legacy
  `location` display-name string).
- `post.entity.ts`: new optional props; `providerExtrasPersistence()` extended; move the
  commented-out `dislikes_count` into it (`?? undefined` → only written when present).
- All 7 post entities spread `providerExtrasPersistence()` (today only IG/TikTok/Threads do).
- `posts.schema.ts`: new optional `@Prop`s (snake_case, default null / Object).
- Backend also picks up keys the connector ALREADY emits but the backend drops today:
  `visibility` (Phyllo-standard, never persisted) and the IG-story metrics
  `engagement.additional_info.{story_replies, sticker_interactions, unique_media_views}`.
- Tests: extend `oauth-content.max-capture.spec.ts` pattern for new fields + a cross-platform
  parser spec asserting every parser persists the superset.

## Known semantics (review-accepted trade-offs)

- **Last-known-good merge**: `coalesce-merge` keeps the stored value when a fresh sync
  yields null/absent (protection against partial-fetch clobbering). State-like additive
  fields inherit this: if an IG collaborator is later REMOVED from a post, the stored
  `collaboration`/`authors` keep their last captured value — same class as the
  pre-existing Threads `location`/`poll` behavior. Boolean flips (e.g. `is_ad`,
  `is_comment_enabled`) are safe: `false` is a real value and always wins.
  FB `is_published` was dropped from the plan for exactly this reason: it is only
  meaningful when `false`, so a post transitioning to published would freeze a stale
  `UNPUBLISHED` visibility (and `/posts` only returns published posts anyway).
- **Phyllo-standard fields newly persisted by the backend**: `visibility`,
  `engagement.dislike_count` and the story metrics are part of the Phyllo contract too,
  so Phyllo payloads that carry them (YouTube/Twitch `visibility` does) now persist
  them as well. Deliberate — the goal is to store everything; the "no new keys" clause
  applies to the *connector superset* keys, which stay only-when-present.

## 6. Explicitly deferred (documented, not lost)

- **Comments persistence** (connector /v1 has a comments product; backend has no schema) — separate feature.
- **Profile & audience superset** (`profile.mapper.ts` / `audience.mapper.ts` have no additive
  mechanism; backend accounts/audience schemas have no superset columns) — next iteration;
  inventory shows bannerUrl, Twitch subscriber tiers, LinkedIn professional facets, IG/TikTok
  accountInsights series all waiting.
- FB `story` field, FB `click_*`/`activity_*` breakdowns, IG `profile_activity__*`/`navigation__*`
  breakdowns, Twitch `game_name` (needs `/games` lookup), Twitch `stream_id`, `owner_handle`,
  IG `copyright_check_information` re-probe.
- YouTube/X backend content webhook early-returns stay untouched (scraped pipelines);
  their parsers/entities get wired anyway so the path is ready.
