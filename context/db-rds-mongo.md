# Session: 2026-04-22

**Started:** ~11:15
**Last Updated:** (end of session)
**Project:** socialmedia-backend (`/Users/alexcriadogonzalez/Camaleonic/socialmedia-backend`)
**Topic:** Knowledge walkthrough — full Phyllo/InsightIQ integration, then full DB map (MySQL + Mongo)

---

## What We Are Building

Nothing new in this session. This was a pure **explanatory / onboarding** pass over the existing code:
1. A complete walkthrough of every Phyllo (InsightIQ) code path — SDK user creation, webhook reception, connect/disconnect/refresh, and content/profile/audience processing.
2. A complete inventory of every MySQL table (three DBs: `social_media`, `shared`, `camaleonic`) and every MongoDB collection (two connections: default SM + `auth`), plus who writes/reads each one.

No features built, no bugs fixed, no refactors.

---

## What WORKED (with evidence)

- **Phyllo code discovery** — confirmed by: located everything via `find` + `grep -l phyllo`, then `Read` on each file (`src/modules/oauth/interfaces/oauth.controller.ts`, all five webhook use cases under `src/modules/oauth/application/webhooks/`, `create-user.usecase.ts`, `refresh-account-connection.usecase.ts`, `insightiq-*.adapter.ts`, `webhook.utils.ts`, `phylloAccountValidation.ts`, `oauth.module.ts`, `connection-method-expiration.cron.ts`, `disconnect-phyllo-account.usecase.ts`).
- **Prisma schema inventory** — confirmed by: `grep -E "^model "` across the three generated schemas (`src/shared/database/prisma/generated/{social_media,shared,camaleonic}/schema.prisma`). Counts: social_media = 23 models + 3 views + 2 enums; shared = 18 models + enums; camaleonic = ~70 models (only `brand` + `country` actually used by this service).
- **Mongoose schema inventory** — confirmed by: `Read` on every file under `src/shared/database/mongoose/schemas/` (13 collections on the default DB + 1 on the `auth` DB) and `mongoose.module.ts` / `mongoose.providers.ts` for wiring.

---

## What Did NOT Work (and why)

- **Initial Bash calls** — failed because: the PreToolUse **Fact-Forcing Gate** hook blocked the first `Bash` invocation of each user turn, requiring me to "quote the user's current instruction verbatim" before retrying. Pattern: quote the instruction, then re-issue the same Bash command. Every turn in this session hit this at least once.
- **`/save-session` auto-`mkdir`** — failed because: user **interrupted** the `mkdir -p ~/.claude/session-data` Bash call. Follow-up request: produce a single markdown file instead of going through the full save-session skill flow. Resolved by using `Write` directly.
- **First `Write` of this file** — failed because: the Gate required fact-presentation (file consumers, existing-file check, data-structure note, instruction quote) before any new-file creation. Resolved by answering the four facts, then retrying the same write.

---

## What Has NOT Been Tried Yet

- No deeper dive into the `ui-api` module's use-case layer (how each Mongo collection is actually queried). The DB map names the readers but doesn't walk the queries.
- No inspection of the vision pipeline that writes `post_brand_stats` and `analytics_visual` (out of scope — that's not in this repo).
- Cron-job `AccountStatsUpdaterCron` was mentioned but not opened.
- Session-summary carried two prior tasks — **not touched** this session:
  1. Dividing webhook log levels into custom tiers so Grafana/Loki filtering is easier, scoped to webhooks + connect/disconnect events.
  2. Improving the "end-of-content-processing" summary log (after `OnAddedContentUseCase` finishes downloading media).

---

## Current State of Files

No source files modified. This session produced two large explanatory answers in-chat only.

| File | Status | Notes |
| --- | --- | --- |
| (none) | Read-only | All work was research/explanation. |

---

## Decisions Made

No architectural or code decisions made. A few framing choices worth remembering:

- **"Phyllo" vs "InsightIQ"** — the product was rebranded; the codebase uses `InsightIQ*` class names (adapters, response DTOs) but keeps `phyllo` in env vars (`INSIGHTIQ_SECRET_KEY`, etc.) and in domain terminology (process-log `type: phyllo_*`, `source: 'phyllo'`). Treat them as synonyms when searching.
- **There is no `ACCOUNTS.CONNECTED` webhook** — connect is driven by the frontend calling our own `/integration/account-setup` (which runs `OnConnectedAccountUseCase`). The controller's injected `handleAccountConnectedUseCase` is only reachable via `/webhook-test`.
- **YouTube is special everywhere** — profile/content webhooks are skipped (scraped separately); account is saved to Mongo directly in `OnConnectedAccountUseCase`; `is_active` stays `true` across disconnects so scraping keeps running; restricted contracts are restored on disconnect.

---

## Key Reference Points (for next session)

### Phyllo — single entry point
- Controller: `src/modules/oauth/interfaces/oauth.controller.ts` (endpoints `/oauth/create`, `/oauth/refresh`, `/oauth/webhook-receiver`, `/webhook-receiver/health`, `/oauth/webhook-test`).
- Signature check: `src/modules/oauth/infrastructure/utils/insight-iq/webhook.utils.ts` — HMAC-SHA256 with `INSIGHTIQ_SECRET_KEY` against `webhook-signatures` header, supports multi-secret rotation.
- Event map (controller lines ~77-91): `PROFILES.ADDED/UPDATED`, `CONTENTS.ADDED/UPDATED`, `CONTENT-GROUPS.ADDED/UPDATED`, `PROFILES_AUDIENCE.ADDED/UPDATED`, `ACCOUNTS.DISCONNECTED`, `SESSION.EXPIRED`.
- Handlers (all under `src/modules/oauth/application/webhooks/`):
  - `on-connected-account.usecase.ts` — called from UI-API, not a webhook
  - `on-disconnected-account.usecase.ts`
  - `on-added-profile.usecase.ts`
  - `on-added-content.usecase.ts` (the heaviest one — FB/RapidAPI, TikTok/TikAPI, YT/yt-dlp, viral, brand/sponsorship detection, Redis throttle)
  - `on-added-profile-audience.usecase.ts`
- Validation guard: `src/modules/oauth/infrastructure/utils/phylloAccountValidation.ts` (must have Postgres account + oAuth `connection_method`).
- Adapters: `src/modules/oauth/infrastructure/insightiq-{identity,account,profile,profile-audience,content}.adapter.ts`. SDK token products requested: `IDENTITY`, `IDENTITY.AUDIENCE`, `ENGAGEMENT`, `ENGAGEMENT.AUDIENCE`.
- Cron: `src/modules/oauth/application/cron-jobs/connection-method-expiration.cron.ts` — daily 17:00, notifies 14/7/3/1 days before `connection_method.expires_at`, bilingual ES/EN.
- Disconnect from UI: `src/modules/ui-api/application/settings/integration/disconnect-phyllo-account.usecase.ts`.

### Redis keys used by Phyllo content pipeline
- `webhook_throttle:content_added:{account_id}` — 600s NX lock, deleted on error.
- `content_processing:{account_id}:{YYYY-MM-DD}` — legacy "already processed today" key, deleted by controller on error.
- `content_stories:{account_id}:{YYYY-MM-DD}-HH` — 3h window for stories (currently disabled).
- `fb_resolution_cache` is an in-memory `Map` (per-batch), **not** Redis.

### Mongo collections (default conn `MONGO_URI`)
1. `accounts`
2. `accounts_stats_history`
3. `posts` (index: `has_brands, account_id, publish_date desc`)
4. `accounts_posts_stats_history`
5. `accounts_audience_demographics`
6. `accounts_audience_demographics_history`
7. `post_brand_stats` (external writer — vision pipeline; 5 compound indexes)
8. `analytics_visual` (external writer)
9. `process_logs` (webhook audit trail)
10. `requested_accounts`
11. `post_issues`
12. `search_usage` (unique `{org_id,date}`)
13. `notifications`

Mongo collections (`auth` conn `MONGO_URI_AUTH`)
14. `dashboard_user_invitations`

Wiring: `src/shared/database/mongoose/mongoose.module.ts`, providers at `src/shared/database/mongoose/mongoose.providers.ts`.

### MySQL — `social_media` DB (env `SOCIAL_MEDIA_DATABASE_URL`)
Schema file: `src/shared/database/prisma/generated/social_media/schema.prisma`

**Account graph:** `account`, `account_external_info`, `connection_method`, `pending_account_connections`, `platform`.
**SM users:** `user`, `user_token`, `profession`, `profession_category`, `organization_sm_user`, `organization_benchmark_user`, `user_visible_account`.
**Contracts/pricing:** `user_account_organization_contract`, `user_account_organization_brand_contract`, `user_account_organization_keyword_contract`, `organization_platform_default_values`, `organization_keyword_contract`, `organization_settings`.
**Brand/content helpers:** `keyword`, `brand_keyword`, `brand_entities`, `sponsorship_indicators`, `city_country_code`.
**Views (read-only):** `view_active_users`, `view_current_contracts_brands`, `view_current_contracts_keywords`.
**Enums:** `connection_method_connection_type` (`oAuth|Scraping`), `sponsorship_indicators_category` (`Paid Hashtags|Promotional Language|Other`).

### MySQL — `shared` DB (env `SHARED_DATABASE_URL`)
Schema file: `src/shared/database/prisma/generated/shared/schema.prisma`

`user`, `user_type`, `organization`, `user_organization`, `workspace_config` (theme/lang/palette), `currency`, `contract`, `contract_product`, `contract_product_history`, `product`, `product_tier`, `product_config`, `product_tier_dashboard`, `dashboard`, `dashboard_section`, `organization_dashboard`, `user_visible_product`, `season`, `organization_methodology`, `organization_report`, `notification`, `notification_channel`, `notification_preferences`.

### MySQL — `camaleonic` DB (env `CAMALEONIC_DATABASE_URL`)
Only two tables actually consumed by this service:
- `country` (alpha2 → `country_id` for audience city mapping)
- `brand` (brand metadata)

Every other model (~70) is owned by the vision/events pipeline and only touched transitively via `analytics_visual` references.

### Who writes what (cheat sheet)
| Collection/Table | Primary writer |
|---|---|
| `account`, `account_external_info`, `connection_method`, `user_account_organization_*_contract` | `OnConnectedAccountUseCase` / `OnDisconnectedAccountUseCase` / `RefreshAccountConnectionUseCase` |
| `pending_account_connections` | `PostPendingAccountConnectionUseCase` (create), `OnConnectedAccountUseCase` (delete) |
| `user_token` | `CreateUserUseCase` |
| `city_country_code` | `OnAddedProfileAudienceUseCase` (via Groq batch call) |
| Mongo `accounts`, `accounts_stats_history` | `OnAddedProfileUseCase` (+ `OnConnectedAccountUseCase` for YouTube) |
| Mongo `posts`, `accounts_posts_stats_history` | `OnAddedContentUseCase` |
| Mongo `accounts_audience_demographics[_history]` | `OnAddedProfileAudienceUseCase` |
| Mongo `process_logs` | Every webhook handler + cron + connect/refresh/disconnect |
| Mongo `notifications` | `SendBulkNotificationUseCase` (crons) |
| Mongo `post_brand_stats`, `analytics_visual` | **External** vision pipeline (read-only here) |
| Mongo `search_usage` | Search rate-limit middleware |
| Mongo `post_issues`, `requested_accounts` | UI-API report/request endpoints |
| Mongo `dashboard_user_invitations` (auth DB) | Auth invite flow |

---

## Blockers & Open Questions

- None raised this session. The two prior-session carry-overs (Grafana-friendly log bucketing + content-processing summary log) remain open but were not reopened here.

---

## Exact Next Step

Next step not determined — this was a knowledge-transfer session, not a work session. When resuming:

1. If continuing the prior session's thread, revisit the two carry-overs: **(a)** dividing webhook log levels into custom tiers that Grafana+Loki can filter easily, scoped to webhook + connect/disconnect events; **(b)** improving the "end-of-content-processing" summary log.
2. Otherwise, pick a new task — all Phyllo and DB context is now captured here so `/resume-session` will have the full map.

---

## Environment & Setup Notes

- Node / NestJS + Express, TypeScript.
- Three MySQL databases via three separate Prisma clients (`SocialMediaPrismaService`, `SharedPrismaService`, `CamaleonicPrismaService`) — keep env vars `SOCIAL_MEDIA_DATABASE_URL`, `SHARED_DATABASE_URL`, `CAMALEONIC_DATABASE_URL` set.
- Two Mongo connections: default (`MONGO_URI`) and named `auth` (`MONGO_URI_AUTH`).
- Redis required for `OnAddedContentUseCase` throttle + Facebook rate limiter.
- Phyllo auth: basic `INSIGHTIQ_CLIENT_KEY:INSIGHTIQ_SECRET_KEY` base64 against `API_ACTIVE_URL`. Same `INSIGHTIQ_SECRET_KEY` is the HMAC secret for inbound webhook signature verification.
- External data sources called from this service: TikAPI (TikTok info + downloads), RapidAPI (Facebook video resolution), yt-dlp (YouTube/Twitch downloads), Groq (city → country code batch resolution), Facebook Graph (`getFacebookPageId`), plus Phyllo itself.
- PreToolUse Fact-Forcing Gate hook is active: every first Bash of a user turn and any new-file `Write` needs the user's instruction quoted verbatim (plus file-purpose facts for `Write`) before the call is allowed.