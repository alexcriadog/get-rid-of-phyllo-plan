# Phyllo Replacement — Requirements

**Document version:** v2
**Change log vs v1:** added responsibility boundary with `backend-api` (§1.4), multi-organization sharing model (§2.2), corrected YouTube handling — OAuth-for-authorization-only, data via existing scraper (§2.5, §4), added platform user-ID canonicalization (§2.1), added token-expiry notification cron as a dependent consumer (§2.9), added webhook security specifics and per-account ingestion throttle (§3), updated open questions.

**Document purpose:** define *what* the new internal service must do and *what properties* it must have, before choosing any architecture. No implementation choices are made here.

**Project purpose:** replace Phyllo / InsightIQ as the data gateway between our Social Media Dashboard and the major creator platforms, using our own platform app credentials, for internal use only.

---

## 1. Scope

### 1.1 In scope (phase 1)

- **Products to replicate from Phyllo:** Connect SDK (onboarding), Identity, Audience, Engagement. Exactly matches the SDK-token product scopes the codebase currently requests: `IDENTITY, IDENTITY.AUDIENCE, ENGAGEMENT, ENGAGEMENT.AUDIENCE`.
- **Platforms (launch set, 6):** Instagram, Facebook, YouTube, Twitch, TikTok, X (Twitter). See §4 for what each platform actually contributes — notably, YouTube's role is limited (§1.4, §4).
- **Consumers:** internal only. The existing `backend-api` is the only caller.
- **Tenancy inside this service:** single-tenant at the *credentials* level (our own platform apps, no BYOC). **Multi-tenant at the data level** — the same connected creator account may be shared across multiple internal organizations (§2.2).
- **Account type covered:** *official* creator accounts only — accounts connected through OAuth consent.

### 1.2 Out of scope (phase 1) — won't be built

- Comments, Income, Publishing, Social Listening, Brand Safety, Creator Discovery / Search products.
- **Unofficial accounts / scraping** — handled by the existing separate scraper, which stays. Note: this service and the scraper *do share state* in `backend-api` (§1.4, §2.2, §5.1).
- Public / non-authenticated profile analytics.
- BYOC (customer-provided platform credentials) or any external-facing API.
- Any UI surface beyond what `frontend-app` already exposes. No new admin UI is promised.

### 1.3 Explicit future scope (phase 2+) — must remain cheap to add

The system must not require a rewrite to later add:
- More platforms (Pinterest, Snapchat, LinkedIn, Spotify, Substack, Patreon, Discord, etc.).
- More data products (Comments, Income, Publish, Listening, Brand Safety).
- More granular scopes per existing product.

Extensibility in these directions is a phase-1 property even though the features are not.

### 1.4 Responsibility boundary with `backend-api` — critical

The existing `backend-api` does more than call Phyllo. Much of its OAuth module is *business logic on top of Phyllo's raw data*, and must stay in `backend-api`. The new service must replace Phyllo's *data-gateway* role, not the business logic wrapped around it.

**The new service is responsible for (and only for):**

- OAuth 2.0 flows per platform and token lifecycle (issuance, refresh, revocation, expiry tracking).
- Fetching raw data from each platform for Identity, Audience, and Engagement.
- Normalizing that data into a platform-agnostic schema.
- Emitting events when data changes (`account.connected`, `profile.updated`, `content.added`, etc.).
- Exposing an internal API so `backend-api` can read normalized data and trigger refreshes.
- Respecting each platform's rate limits and quotas globally.

**The new service must NOT take over (stays in `backend-api`):**

- Organization / contract / brand / visibility model (`user_account_organization_contract`, `user_account_organization_brand_contract`, `user_visible_account`).
- Brand detection (matching caption hashtags & mentions against `BrandKeywords`).
- Paid-post detection (matching against Paid Hashtags indicators + Promotional Language regex).
- Virality scoring, engagement-rate averaging, "viral post" flagging.
- Economic-value / pricing enrichment based on contract terms.
- Durable media storage to S3 (with yt-dlp / TikAPI / RapidAPI / ffmpeg fallbacks).
- `city → country_code` resolution via LLM.
- Bilingual token-expiry notifications (the 17:00 cron in `backend-api` that warns users 14/7/3/1 days before expiry — it *reads* expiry data this service provides; §2.9).
- `connection_method` handover between `oAuth` and `Scraping` types when an official org disconnects — the new service *signals* the disconnect, `backend-api` decides what to do next with the scraper.
- Cross-organization visibility / sharing policy and role-based access.
- The MongoDB-side stores (`process_log`, the `accounts` doc, `accounts_stats_history`, `posts`, `accounts_audience_demographics`, etc.) — those remain in `backend-api`.

The line to remember: **platform-normalized data and events out; business enrichment, multi-org policy, durable media and notifications in `backend-api`.**

---

## 2. Functional requirements

### 2.1 Connect / onboarding

- **F-01** A user of the dashboard must be able to connect one or more creator accounts from any of the 6 supported platforms.
- **F-02** A single dashboard user may connect multiple accounts on the same platform.
- **F-03** Connection uses each platform's official OAuth 2.0 (or equivalent) consent flow.
- **F-04** The creator must see, before granting consent, what data will be accessed and for what purpose.
- **F-05** A connection can be revoked (disconnected) from the dashboard; tokens are invalidated and syncing stops.
- **F-06** When a token expires or a scope is revoked on the platform side, the account is marked *needs re-authentication* without affecting other accounts, and an event is emitted (§2.7).
- **F-07** Reconnecting an account must resume syncing and preserve history — no duplicate account records. The service must distinguish a real reconnect from a duplicate webhook / double-submission.
- **F-08** Only Instagram Business / Creator accounts linked to a Facebook Page are connectable via the primary Instagram flow. The UI must surface this *before* OAuth starts.
- **F-09** **Platform user-ID canonicalization.** After OAuth, the service must resolve the *canonical* platform user ID, because the ID returned by OAuth is not always the useful one:
  - Facebook → resolve Page ID (Graph API), with retries (2s / 5s / 10s today).
  - TikTok → resolve via TikTok's user-info endpoint, with retries.
  - Instagram (Direct flow, if kept — §9) → dedicated resolver.
  - Other platforms → OAuth-returned ID is canonical.
  This canonical ID is what `backend-api` keys on; it must be stable across reconnects.
- **F-10** The service must track a **pending-connection state** for accounts mid-handshake (after consent but before canonical-ID resolution completes) and clear it on success or failure.
- **F-11** On first successful connection, the service must trigger an initial fetch of all in-scope data products for that account (Identity, Audience, Engagement). Today `backend-api` does this by calling Phyllo's `/v1/profiles/refresh` and `/v1/social/contents/refresh`; the new service must provide an equivalent automatic trigger.

### 2.2 Multi-organization account sharing — critical

The existing system models a connected account as shareable across multiple internal organizations. Full policy stays in `backend-api`, but the new service must provide the hooks to support it.

- **F-20** The service must accept and store, per connected account, the identifier of the organization that initiated the OAuth connection (the "owning" or "official" organization).
- **F-21** The service must support multiple organizations referencing the same *platform* account without requiring multiple OAuth flows for that account.
- **F-22** The system of record for *which org is official* and *which orgs have visibility* is `backend-api`. The service provides the data and the events; `backend-api` applies visibility.
- **F-23** On disconnect, the event payload must identify *which organization* disconnected (another org may still have access). The service must not assume disconnection means the account is gone — it means one org dropped its OAuth.
- **F-24** `backend-api` decides whether to fall back to scraping, hand ownership to another org, or fully deactivate the account. The new service is not involved in that decision.

### 2.3 Identity data

For every connected account the service must collect and keep current:

- **F-30** Platform handle / username.
- **F-31** Display name, biography, avatar URL, canonical profile URL.
- **F-32** Verified status (where the platform exposes it).
- **F-33** Account type (business / creator / personal) where applicable.
- **F-34** Current totals: followers, following, posts / videos / items count.
- **F-35** Historical snapshots of totals are **not produced by this service** — `backend-api` already maintains `accounts_stats_history` in MongoDB and computes daily `followers_growth`. The service provides the current values and a fetch timestamp; `backend-api` snapshots them.

### 2.4 Audience data

For every connected account, where the platform exposes it:

- **F-40** Gender distribution.
- **F-41** Age distribution.
- **F-42** Country distribution and, where available, city distribution (raw only; city→country resolution is `backend-api`'s job).
- **F-43** Interests / affinities where available.
- **F-44** The service's output must distinguish "field not supported by platform" from "field supported but empty". `backend-api` needs this distinction to render the dashboard honestly.

### 2.5 Engagement data

- **F-50** List of contents published by the connected account, covering the content types the platform exposes (posts, videos, reels, stories where applicable, shorts, streams, tweets).
- **F-51** Per-content metadata: type, caption / title, media URL(s), permalink, publish timestamp, platform content ID.
- **F-52** Per-content metrics, where the platform exposes them: likes, comments, views, shares, saves, impressions, reach, watch time.
- **F-53** Default historical window on first connection: last 90 days of content. Configurable per account up to each platform's maximum.
- **F-54** **YouTube and Twitch content data** is NOT supplied by this service — today the existing scraper produces it, and that continues. For YouTube/Twitch the service provides only *connection state* and *identity-level* data, not content or metrics (§4).
- **F-55** X / Twitter repost filtering (`RT @`) is a `backend-api` concern. The service returns tweets as they come from the platform.
- **F-56** Media URLs returned by platforms are transient. The service must include each media URL's fetch timestamp so `backend-api` can schedule durable copy-to-S3 before expiry.

### 2.6 Data synchronization

- **F-60** Each data product (Identity, Audience, Engagement) must be refreshed automatically on a configurable schedule per account.
- **F-61** The dashboard must be able to trigger an on-demand refresh of any data product for any account.
- **F-62** On initial connection, the service runs a one-time backfill up to the configured historical window and emits an event on completion.
- **F-63** Ephemeral content (Instagram Stories) must be captured on a faster cadence than normal content, appropriate to its 24h lifetime.
- **F-64** Default refresh cadences must be overridable globally, per platform, and per account without code changes.

### 2.7 Event notifications

The service must emit internal events `backend-api` (and future consumers) can subscribe to:

- **F-70** Lifecycle: `account.connected`, `account.disconnected`, `account.needs_reauth`, `account.pending`, `account.ready`.
- **F-71** Data-product events: `profile.updated`, `audience.updated`, `content.added`, `content.updated`, `content.deleted`.
- **F-72** Backfill: `account.backfill_started`, `account.backfill_complete`.
- **F-73** Operational: `sync.failed` (after retries exhausted), `token.expiring_soon` (emitted N days before expiry — consumed by the cron in §2.9).
- **F-74** Every event must carry enough context to be processed independently: platform, account ID, organization ID (emitting org), timestamps, and a stable event ID for idempotency.
- **F-75** Delivery semantics: **at-least-once, with retries and a dead-letter path**. Consumers deduplicate by event ID.
- **F-76** **ACK-first delivery.** When this service *ingests* platform webhooks, it must ACK immediately (no heavy work in the HTTP handler) so platform-side 5-second timeouts never fire. When this service *emits* events to `backend-api`, it must accept that `backend-api` ACKs within 5s and processes asynchronously.
- **F-77** All emitted events must be **signed** (HMAC-SHA256 with a shared secret), with a header comparable to today's `webhook-signatures`, and **support for multiple valid secrets simultaneously** so keys can be rotated with zero downtime. Signature check uses constant-time comparison.
- **F-78** The event schema must be stable and versioned.

### 2.8 Platform extensibility

- **F-80** Adding a new platform must not require changes to the core sync engine, scheduling logic, storage schema for normalized data, event system, or internal API.
- **F-81** Adding a new platform = register the platform, implement its specific contract (OAuth + fetchers + canonical-ID resolver), provide credentials, deploy.
- **F-82** Onboarding time for a new platform, assuming it offers a stable OAuth + data API, is measured in **days**, not weeks.

### 2.9 Administration & operations

- **F-90** Operators can see sync health per account: last success, last failure, cadence, queue position, token `expires_at`.
- **F-91** Operators can re-enqueue failed syncs, pause syncing per account or per platform, and resume them.
- **F-92** Platform app credentials are rotatable without downtime or data loss.
- **F-93** Default cadences per data product per platform are changeable without a deploy.
- **F-94** **Token expiry awareness.** Every active account must have an accurate `expires_at` derived from each platform's token-validity window, kept current across refreshes. `backend-api` already runs `ConnectionMethodExpirationCron` daily at 17:00 which reads this and sends bilingual (ES/EN) notifications 14/7/3/1 days before expiry. The new service's contract with `backend-api` must preserve that behaviour.
- **F-95** The service must expose counts: accounts per platform, per status, per data-product freshness bucket.
- **F-96** **Developer-experience endpoint.** A protected, non-production-default endpoint that allows manually triggering profile / audience / content handlers for a given account — equivalent to today's `/oauth/webhook-test`. Required for debugging.

### 2.10 Internal API

- **F-100** Stable internal API for `backend-api` to read users, accounts, profiles, audiences, contents, content metrics, and to trigger refreshes / disconnects.
- **F-101** Versioned. Breaking changes require a new version; old versions remain for a deprecation window.
- **F-102** Designed so migrating `backend-api` off Phyllo is as close to a base-URL + auth change as possible, not a data-model rewrite.
- **F-103** The OAuth port-adapter structure in `backend-api` (`OAuthIdentityAPI`, `OAuthAccountAPI`, `OAuthProfileAPI`, `OAuthProfileAudienceAPI`, `OAuthContentAPI`) must remain usable — the new service exposes endpoints that slot cleanly behind those same ports with a new adapter implementation.

### 2.11 Ingestion throttling and idempotency

- **F-110** The service must throttle per-account processing of repeated ingestion triggers for the same data product, so duplicated platform callbacks do not cause repeated full fetches. Current behaviour in `backend-api` is a 10-minute Redis lock per `(account_id, content)`; the replacement provides an equivalent guarantee (lock, debounce, or deduplicated queue).
- **F-111** All ingestion handlers must be idempotent: running the same fetch twice must not corrupt state or double-count anything.
- **F-112** Duplicate disconnect / reconnect signals must be detectable: the service knows whether a given state change is a real transition or a replay (equivalent to today's `wasDisconnected` / `wasAlreadyDisconnected` snapshots).

---

## 3. Non-functional requirements

### 3.1 Scalability

- **NF-01** Launch load: ~50 connected accounts.
- **NF-02** 12-month target: at least **5,000** connected official accounts (no hard upper bound; product intent is "as many as we can").
- **NF-03** 3-year horizon: must reach **50,000** connected accounts without re-architecting — only by adding capacity.
- **NF-04** Sync workers must scale **horizontally**. Doubling worker capacity must roughly double throughput without code changes.
- **NF-05** The scheduling layer must not become a bottleneck as account count grows (no O(N) tight loops over all accounts per tick, no single-process cron for sync orchestration).
- **NF-06** Normalized-data storage must handle ~50,000 accounts × years of content within a defined retention policy (§3.8).

### 3.2 Isolation & fault containment

- **NF-10** The service must run on infrastructure **separate from `backend-api`** (at minimum: separate database, separate process group, separate deploy unit; ideally separate host).
- **NF-11** Failure of any single platform integration must not affect syncing of the other 5 platforms.
- **NF-12** A failure storm (e.g., Meta outage, mass token invalidation) must not cascade into `backend-api` or exhaust shared resources such as Redis.
- **NF-13** The worker layer must be restartable at any time without losing in-flight work.
- **NF-14** Per-account work throttling (§2.11) must be safe under worker restarts (no stuck locks after a crash).

### 3.3 Reliability & availability

- **NF-20** Target availability for the internal API consumed by `backend-api`: **99.5%** monthly.
- **NF-21** All sync operations and event handlers must be **idempotent**.
- **NF-22** All external API calls use bounded retries with exponential backoff and jitter.
- **NF-23** Persistently failing work lands in a dead-letter queue with an alert.
- **NF-24** Recovery from a full host loss is possible from backups + redeploy. Target RTO < 1h. Target RPO < 24h for bulk data, < 1h for tokens and config.

### 3.4 Data freshness SLOs (p95 staleness from platform having new data)

| Data product | Target | Notes |
|---|---|---|
| Identity (totals) | ≤ 6 hours | Cheap API call. |
| Audience | ≤ 24 hours | Expensive, slow-changing. |
| Engagement — new content detected | ≤ 2 hours | New post visible in dashboard within this. |
| Engagement — metrics for content < 7 days old | ≤ 6 hours | Growth is fast. |
| Engagement — metrics for content 7–90 days old | ≤ 24 hours | Growth is slow. |
| Ephemeral (Stories etc.) | ≤ 1 hour | Source TTL is 24h. |
| On-demand refresh | ≤ 60 seconds after handler completes | UX requirement. |

- **NF-30** SLO breaches must be measurable and alertable.
- **NF-31** Cadences must be tunable per account and per platform to trade off freshness vs. rate-limit budget.

### 3.5 Rate-limit discipline

- **NF-40** The service respects every platform's published rate limits globally — across all workers, all accounts, all our platform apps combined.
- **NF-41** Budgets proactively, not reactively (no "wait for 429, then back off").
- **NF-42** Sustained rate-limit exhaustion degrades gracefully: lower-priority work (bulk periodic syncs) pauses; higher-priority work (on-demand refresh, new-account backfill) continues.
- **NF-43** YouTube quota (daily *units*) must be tracked distinctly.
- **NF-44** Per-account ingestion throttling (§2.11) coexists with platform-level rate limits; both are enforced.

### 3.6 Security

- **NF-50** OAuth access and refresh tokens encrypted at rest with a managed key.
- **NF-51** Platform app credentials (client IDs / secrets) live in a secrets manager. Never in repos, compose files, images, or logs.
- **NF-52** No credential or token of any kind may be logged, even in debug.
- **NF-53** OAuth state parameters must be single-use, short-lived, bound to `(user, platform)`.
- **NF-54** The internal API must authenticate every caller. `frontend-app` must not be able to call it directly — only `backend-api`.
- **NF-55** All service-to-service traffic on a private network or encrypted.
- **NF-56** **Webhook signature verification with multi-secret rotation** — incoming and outgoing webhooks use HMAC-SHA256 with a secret header; verification accepts any secret in a currently-valid set so keys can be rotated with zero downtime.
- **NF-57** Constant-time comparison for signature checks.
- **NF-58** Audit log of credential access, token issuance, refresh, revocation, and admin actions (pauses, cadence changes, re-enqueues, credential rotations).

### 3.7 Compliance

- **NF-60** Consent captured and recorded per account: which scopes, which privacy-notice version, timestamp, organization that initiated consent.
- **NF-61** Per-creator data must be fully deletable within a defined GDPR SLA: tokens, profile, audience, content, metrics, and any logs containing personal data.
- **NF-62** Exportable per-creator data dump producible on request.
- **NF-63** Platform developer terms complied with (retention limits, cache duration, permitted uses). Where a platform requires data deletion after disconnect, this service enforces it in its own store; `backend-api` enforces it in its own.

### 3.8 Data retention

- **NF-70** Raw platform responses retained for a bounded window (proposal: 30–90 days) for debugging and reprocessing, then pruned.
- **NF-71** Normalized data kept as long as the account is connected, plus a grace period after disconnection consistent with platform terms.
- **NF-72** This service does not own long-term time-series metric storage — `backend-api` / MongoDB already keeps `accounts_stats_history`, `accounts_posts_stats_history`, `accounts_audience_demographics_history`. Retention policy for time series is a `backend-api` concern.
- **NF-73** On account deletion (GDPR), purge within SLA regardless of policy.

### 3.9 Observability

- **NF-80** Metrics: sync duration, success / failure rate (by platform, product, error class), rate-limit headroom, YouTube quota headroom, queue depth, queue age, webhook delivery latency (inbound and outbound), account counts by status, data freshness per product, per-account throttle-lock hits.
- **NF-81** Logs structured and correlatable by a request / job ID that flows through OAuth callbacks, sync jobs, and event deliveries.
- **NF-82** Alerting on: SLO breaches, DLQ depth > 0, rate-limit saturation, OAuth callback error-rate spikes, event-delivery failures, worker queue depth above threshold, unusual spike in `needs_reauth` accounts.
- **NF-83** Observability integrates with the **existing observability stack** (`agent-prometheus`, `agent-promtail`, `agent-node-exporter`). No parallel monitoring system.
- **NF-84** `backend-api` today writes a `process_log` document in MongoDB for every webhook handler (source, type, level, processId, duration, metadata). The new service must emit enough data in events that `backend-api` can keep producing those logs unchanged — **OR** the service writes them on `backend-api`'s behalf. Decision deferred to architecture phase.

### 3.10 Extensibility (non-functional)

- **NF-90** Cost of adding a new platform stays roughly constant as supported platforms grow. Adding #11 is not meaningfully harder than adding #7.
- **NF-91** Cost of adding a new data product (Comments in phase 2) does not require changes to existing platform integrations beyond their own new methods.
- **NF-92** Schema and internal API changes backward-compatible by default.

### 3.11 Deployability & operations

- **NF-100** Integrates with the existing CI/CD pattern: GitHub Actions → ECR → EC2 with Docker Compose.
- **NF-101** Dev and prod environments mirror today's setup.
- **NF-102** Deploys zero-downtime for the internal API. Workers may drain and restart.
- **NF-103** Rollback to the previous image completes under 5 minutes.
- **NF-104** Platform app credential rotation is a config change, not a redeploy.

### 3.12 Cost

- **NF-110** Operating cost at 12-month target (~5,000 accounts) must be materially lower than the equivalent Phyllo / InsightIQ spend. Exact target once current Phyllo spend is confirmed.
- **NF-111** Cost scales predictably with account count, not step-function on thresholds.

---

## 4. Platform-specific requirements

Each row is what the *new service* must provide for that platform. Known platform-side constraints are listed so they are not forgotten.

| Platform | Identity | Audience | Engagement (content + metrics) | Known constraints & landmines |
|---|---|---|---|---|
| **Instagram (Business / Creator via Graph API)** | Yes | Yes — gender, age, country, city | Posts, Reels, Stories, Carousels + likes / comments / reach / impressions / saves / video views | Only Business/Creator accounts linked to a FB Page. Meta App Review for `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `business_management`. Per-user rate limits. Stories TTL 24h — fast cadence needed. |
| **Instagram Direct** | *Open* (§9) | *Open* | *Open* | Distinct flow exists today (`is_ig_direct`, `getInstagramDirectAccountId`). Decide whether to keep, deprecate, or defer. |
| **Facebook (Pages)** | Yes | Yes (Page Insights) | Posts, videos + reach / impressions / reactions / video metrics | Pages only, not personal profiles. Long-lived token refresh (~60 days). Today's FB video URLs are broken (provider returns images) — that workaround is a `backend-api` concern today and should disappear with direct Graph API calls. |
| **YouTube** | **Yes — OAuth + identity only** | **No (from scraper)** | **No (from scraper)** | In the current system YouTube's profile / audience / content data is produced by the existing scraper, not Phyllo. The new service provides only OAuth connection state, token lifecycle, identity, and the events (`account.connected`, `account.disconnected`, token expiry). Profile, audience, and content webhooks are intentionally skipped for YT. **This must be preserved.** |
| **Twitch** | Yes | Very limited (platform barely exposes audience) | VODs, clips, streams + views / followers | Identical to today: audience fields mostly empty. Content data path for Twitch to be confirmed with §9.5 — may be partly via scraper. |
| **TikTok (Business / Creator)** | Yes | Very limited via official API | Videos + likes / comments / shares / views | App review per product (3–7 days). Audience data is weak in the official API. Video download URLs not returned by official API — `backend-api` uses TikAPI for downloads; that stays. Strict token refresh. |
| **X (Twitter)** | Yes | Minimal | Tweets + impressions / likes / retweets / replies (tier-dependent) | Paid API tiers since 2023. The tier (Basic $200/mo vs Pro $5,000+/mo) is a **business decision** needed before phase-1 scope is locked (§9). Strict rate limits. Repost (`RT @`) filtering is done in `backend-api`, not here. |

- **FP-01** The service must expose, per platform and data product, which fields are actually populated, so `backend-api` can distinguish "not supported" from "empty".
- **FP-02** The service must not assume any platform supports the full data model.
- **FP-03** YouTube's reduced role (connection + identity only) must be first-class behaviour, not a special-case hack.

---

## 5. Constraints

### 5.1 Technical constraints (given, not chosen)

- **C-01** Runs on AWS. EC2-based deployment pattern already established.
- **C-02** Dev + prod environment split already exists.
- **C-03** Existing services on the EC2 host: `nginx-proxy`, `frontend-app`, `backend-api`, `redis-cache`, `zvec-api`, `cp-frontend`, `cp-backend`, `reporting-service`, observability agents, plus the separate scraper.
- **C-04** CI/CD is GitHub Actions → ECR → EC2.
- **C-05** TLS via Let's Encrypt on the reverse proxy.
- **C-06** `backend-api` is a Nest.js service organized in **hexagonal layers** (`domain/`, `infrastructure/`, `application/`, `interfaces/`). Its OAuth module exposes five ports (`OAuthIdentityAPI`, `OAuthAccountAPI`, `OAuthProfileAPI`, `OAuthProfileAudienceAPI`, `OAuthContentAPI`). Today those ports have InsightIQ adapters. The new service must be reachable through a new set of adapters behind those same ports, with no changes to domain or use cases above them.
- **C-07** `backend-api` uses **MySQL on RDS for relational data** — three logical databases on the same instance: `social_media` (account graph, SM users, contracts, brand helpers — 23 models), `shared` (users, orgs, products, notifications — 18 models), `camaleonic` (vision pipeline — only `country` and `brand` consumed here) — and **MongoDB for documents / time-series / logs** across two connections: default (13 collections including `accounts` doc, `posts`, `accounts_stats_history`, `accounts_posts_stats_history`, `accounts_audience_demographics`, `accounts_audience_demographics_history`, `process_logs`, `notifications`) and `auth` (`dashboard_user_invitations`). The new service will own its own store for its own concerns; it must not require any change to this multi-DB topology.
- **C-08** The **existing scraper must continue to function unchanged** and must continue to take over an account's data pipeline when the OAuth connection drops — current `connection_method` transitions to `Scraping`. The new service issues the disconnect signal; `backend-api` + scraper react.

### 5.2 Organizational constraints

- **C-10** Build team: **1–2 backend developers + 1 infrastructure engineer**.
- **C-11** We already hold approved business / developer accounts on Meta, TikTok, X, Google, Twitch consoles.
- **C-12** We are responsible for all ongoing App Review cycles.
- **C-13** Phase 1 target: parity with the 4 Phyllo products (Connect, Identity, Audience, Engagement) across the 6 platforms under the constraints in §1.4 and §4, with Phyllo decommissioned afterward.

### 5.3 Product constraints

- **C-20** Internal use only. No external SLAs.
- **C-21** Our single set of platform app credentials.
- **C-22** The scraper handles the ~10,000 unofficial accounts and stays out of this service's scope, but its coexistence with OAuth accounts is in scope (C-08).

---

## 6. Assumptions

- **A-01** OAuth redirect URIs can be registered on our existing domain for both dev and prod.
- **A-02** The 50 accounts currently connected via Phyllo can be re-onboarded through the new OAuth flow (creators re-consent). If silent migration is required, it becomes a separate explicit requirement.
- **A-03** `backend-api` will be modified to consume the new service; we control it.
- **A-04** Network egress from EC2 to platform APIs is unrestricted.
- **A-05** The existing observability stack has spare capacity and is reused.
- **A-06** Redis is available and can host queues, locks, and rate-limit buckets for the new service.
- **A-07** The MongoDB cluster used by `backend-api` is not used by the new service directly — only via events / API.
- **A-08** The existing RDS MySQL instance can host one more database (the new service's own) without resizing. Verifiable; if capacity becomes an issue, the new service can migrate to a dedicated RDS later.

Any assumption that turns out false is a change in requirements.

---

## 7. Success criteria

Over a rolling 30-day window after cutover:

- **S-01** All 6 platforms connectable end-to-end through the new service (with YouTube's reduced role per §4).
- **S-02** ≥ 95% sync success rate per platform, per data product it is responsible for.
- **S-03** Data freshness SLOs (§3.4) met at p95.
- **S-04** Existing 50 accounts (plus any added during the build) migrated with no loss of historical series (series continues to live in `backend-api` / MongoDB as today).
- **S-05** `backend-api` depends solely on the new service for Connect / Identity / Audience / Engagement data. Phyllo / InsightIQ integration removed.
- **S-06** Phyllo / InsightIQ subscription cancelled.
- **S-07** Operating cost materially below the Phyllo spend (target set once current billing is confirmed).
- **S-08** Adding a 7th platform as a controlled test takes ≤ 2 developer-weeks end-to-end.
- **S-09** `backend-api`'s existing token-expiry cron continues to deliver correct 14/7/3/1-day alerts using `expires_at` data fed by the new service.
- **S-10** Org-sharing behaviour (handover to another org, fallback to scraping, role-based visibility) behaves identically to today.

---

## 8. Non-goals (explicit)

- **NG-01** No new admin UI in phase 1.
- **NG-02** No replication of Phyllo's creator discovery or 400M+ public index.
- **NG-03** No scraping, public-data collection, or TOS-ambiguous acquisition — stays in the existing scraper.
- **NG-04** No multi-region, no global CDN, no HA clustering for phase 1.
- **NG-05** No attempt to ingest non-official accounts.
- **NG-06** No business logic in the new service: brand detection, paid-post detection, virality, economic value, media S3 storage, city→country LLM resolution, notifications, org-sharing policy — all stay in `backend-api`.
- **NG-07** No change to `backend-api`'s existing MongoDB schemas (`accounts`, `posts`, `accounts_stats_history`, `accounts_audience_demographics`, `accounts_audience_demographics_history`, `process_log`). The new service feeds them indirectly through events / API; it does not own them.

---

## 9. Open questions to resolve before architecture phase

1. **Connect widget placement** — embedded in `frontend-app` or its own hosted page?
2. **X / Twitter API tier budget** — which paid tier, or is X deferred out of phase 1?
3. **Phyllo migration style** — re-consent all 50 accounts cleanly, or attempt silent migration if Phyllo supports a token export path?
4. **Instagram Direct flow** — keep, deprecate, or phase-2? Distinct code path today (`is_ig_direct`, `getInstagramDirectAccountId`).
5. **Twitch content strategy** — confirm whether Twitch engagement currently comes from Phyllo, from the scraper, or both. Needed to lock §4.
6. **Historical backfill depth** — stay with 90 days or pay for longer (per-platform max)?
7. **Metric granularity** — `backend-api` stores daily `accounts_stats_history`. Do we need higher-than-daily resolution anywhere?
8. **Current Phyllo monthly spend** — to set NF-110 / S-07.
9. **Expected internal-API QPS from `backend-api`** — to size the service.
10. **`process_log` continuity** — does `backend-api` keep writing `process_log` from events it receives, or does the new service write to MongoDB directly? (Impacts the service boundary and coupling.)
11. **Organization model authority** — does `backend-api` remain sole source of truth for orgs / contracts / visibility with the new service only storing a reference, or do we denormalize some fields into the new service for efficient filtering?

---

## 10. Glossary

- **Account** — one creator profile on one platform, connected via OAuth.
- **User** — one dashboard user; owns zero, one, or many accounts.
- **Organization** — an internal tenant in `backend-api`. An account is attached to one "official" organization (the one that OAuthed) and may be visible to others.
- **Contract** — an organization's agreement to manage an account; carries brands, economic value, active / restricted flags.
- **Connection method** — how an account's data flows: `oAuth` (via this service / today Phyllo) or `Scraping` (via the separate scraper). Changes over time.
- **Platform** — one of the 6 supported social networks at launch.
- **Data product** — Identity, Audience, Engagement (phase 1). Later: Comments, Income, Publish, etc.
- **Sync** — a scheduled or on-demand operation that calls a platform API and updates the normalized store.
- **Backfill** — one-time historical sync on first connection.
- **Freshness** — time between the platform having new data and our store reflecting it.
- **Cadence** — scheduled interval between automatic syncs for a given account + data product.
- **Dead-letter queue (DLQ)** — durable store for jobs that failed all retries, for human inspection.
- **Official account** — connected through OAuth consent. Distinct from scraped "unofficial" accounts handled by the existing scraper.
- **Canonical platform user ID** — the platform's real identifier for the connected account (e.g., FB Page ID for Facebook), which may differ from what OAuth returns and must be resolved after consent.
- **`needs_reauth`** — state of an account whose token has expired or whose scopes were revoked; stays in storage but is excluded from sync until re-consented.
