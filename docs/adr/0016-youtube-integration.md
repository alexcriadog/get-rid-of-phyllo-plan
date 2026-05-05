# ADR 0016 — YouTube integration (Data API v3 + Analytics API v2)

**Status:** Accepted
**Date:** 2026-05-05
**Related:** ADR 0008 (token-bucket rate limits), ADR 0009 (rate-limit strategy), ADR 0010 (refresh cadence tiers), `docs/07-platforms/youtube.md`, `docs/rate-limiting.md` §4

## Context

YouTube is the fifth platform in the PoC after Instagram, Facebook, TikTok, and Threads. Unlike those four — all of which sit on a single HTTP surface (Graph for Meta, `open.tiktokapis.com` for TikTok, the Threads endpoint family) — YouTube needs **two independent APIs combined**:

1. **YouTube Data API v3** (`googleapis.com/youtube/v3`) — entities and current-state statistics. Quota is **per Google Cloud project**, 10 000 units/day, with per-endpoint cost (`channels.list`/`videos.list`/`playlistItems.list`/`commentThreads.list` = 1 unit, `search.list` = 100 units). Reset at midnight Pacific.
2. **YouTube Analytics API v2** (`youtubeanalytics.googleapis.com/v2/reports`) — daily-resolution time series (views, watch time, demographics, geo, traffic sources, devices, monetization). Not unit-counted — only QPS limits (≈720 req/100s per project, 60 req/100s per user). 24–72h lag on finalized data.

OAuth 2.0 is mandatory for `mine=true` on Data API and for any Analytics call. The previous YouTube doc (`docs/07-platforms/youtube.md`) already framed the architecture; this ADR captures the **implementation choices** made when we actually wired it up.

## Decision

### 1. Use the official `googleapis` SDK rather than hand-rolled fetch.

We use `google-auth-library`'s `OAuth2Client` to obtain access tokens but call the underlying APIs through bare `fetch` from a single chokepoint client (`shared/youtube-api/youtube-client.ts`) so we can:

- Apply the existing `RateLimitStrategy.checkGate()` pre-flight on every call.
- Override per-call cost (1 vs 100 units) per endpoint at one place.
- Persist `api_call_log` rows uniformly.
- Map `GaxiosError`-shaped responses to our `TokenRevokedError` / `RateLimitedError` / `AdapterFetchError` taxonomy in `youtube-errors.ts`.

The trade-off vs going pure fetch is ~5 MB of bundle from `googleapis` types — irrelevant for a backend Node service, and we get full TS coverage of every endpoint we don't use yet (Reporting API for backfill, etc.).

### 2. Three OAuth scopes from day one — including monetary.

```
https://www.googleapis.com/auth/youtube.readonly
https://www.googleapis.com/auth/yt-analytics.readonly
https://www.googleapis.com/auth/yt-analytics-monetary.readonly
```

All three are Google "Restricted" scopes — they require OAuth verification + CASA assessment before production. For the PoC we operate as an OAuth app in **Testing** mode (≤100 testers, refresh tokens expire after 7 days). For channels not in the YouTube Partner Program (YPP) the monetary metrics return zeros; that is harmless, not an error.

### 3. Two rate-limit hints, daily-counter + token-bucket, with a per-call cost override.

`youtube.rate-limit.strategy.ts` returns:

```
daily_quota         — strategy: 'daily-counter', capacity 10 000, reset at midnight Pacific
qps_analytics       — strategy: 'token-bucket', capacity 720, refill 720 / 100 000 ms
qps_analytics_user  — strategy: 'token-bucket', capacity 60,  refill 60 / 100 000 ms (when context.tokenHash present)
```

The `costPerCall` in the hint is `1` and the chokepoint client overrides it per endpoint (`channels.list` = 1, `playlistItems.list` = 1, `videos.list` = 1, `commentThreads.list` = 1, `search.list` = 100, `analyticsQuery` = 0 against `daily_quota` because Analytics API is unit-free).

**Quota floor.** When `daily_quota` drops below 50 units we reject preemptively with `RateLimitedError(resetInMs = msUntilPacificMidnight)`. Big jobs cannot burn the residual budget out from under interactive operations.

### 4. YouTube is its own family — not a Meta derivative.

We considered putting YouTube under the `shared/meta-graph` chokepoint client because both speak HTTP-with-OAuth. Rejected:

- The Meta client is shaped around the Graph API surface, BUC/X-App-Usage headers, App Secret Proof, and per-page token resolution — none of which apply.
- YouTube combines two endpoints with two distinct rate-limit shapes (units vs QPS). The Meta client knows about one bucket family.
- `googleapis`-style auth and pagination differ enough from Graph that the abstraction would leak immediately.

So `shared/youtube-api/` is a new family, parallel to `shared/threads-api/`, with its own client, refresh service, and error mapping. The hexagonal port (`PlatformAdapter`) absorbs the difference — the worker, scheduler, and admin tooling are unchanged.

### 5. Six parallel Analytics queries for audience.

`youtube-audience.fetcher.ts` runs `Promise.allSettled` over six Analytics queries:

1. Daily series — `views`, `estimatedMinutesWatched`, `averageViewDuration`, `subscribersGained/Lost`, `likes`, `comments`, `shares` over the last `periodDays` (default 90).
2. Demographics — `dimensions=ageGroup,gender, metrics=viewerPercentage` → split into `ageDistribution` + `genderDistribution`.
3. Geo — `dimensions=country, metrics=views,estimatedMinutesWatched` (sorted, top 200).
4. Traffic sources — `dimensions=insightTrafficSourceType`.
5. Devices — `dimensions=deviceType`.
6. Monetization — `estimatedRevenue`, `estimatedAdRevenue`, `cpm`, `monetizedPlaybacks`, etc.

Partial failures (e.g. small channels below the demographic privacy threshold) attach to `engagedDemographics.errors[]` rather than tearing down the whole sync. End date is shifted -1 day to absorb the 24-72h Analytics lag.

### 6. Comments via Analytics + Data API — top-N by views.

`commentThreads.list` is a Data-API endpoint at 1 unit per call but we'd burn a lot of units fetching every video. Instead we ask Analytics for the top-N videos by views (`dimensions=video, metrics=views, sort=-views, maxResults=20`), then call `commentThreads.list` only on those. Videos with comments disabled return 403 with `commentsDisabled` reason — we swallow it, not error.

### 7. Brand-account / multi-channel: pick first + warning.

A single OAuth grant can own multiple channels (Brand Accounts). For Phase 1 we pick `items[0]` from `channels.list?mine=true` and log a warning. Phase 5 adds a UI picker. Documented under TODO.

### 8. Manual two-call OAuth flow on the admin surface.

The PoC has no front-end OAuth callback server. We expose two admin endpoints instead:

```
GET  /admin/connect/youtube/authorize-url      → returns Google authorize URL with prompt=consent, access_type=offline
POST /admin/connect/youtube/complete           → body { code }, exchanges code, calls channels.list, seeds account
```

Generated authorize URL pins `prompt=consent` (without it the second authorization does not return a refresh token) and `access_type=offline` (without it Google does not issue a refresh token at all).

## Consequences

### Positive

- Single chokepoint enforces cost-aware rate limiting across both APIs.
- Audience pulled from Analytics, not just current-state stats — daily history goes back ~2 years, well beyond what IG/FB/TikTok give us.
- Monetization scope from day one means YPP channels light up without re-consent.
- Test-mode OAuth lets us iterate without waiting for Google verification.

### Negative / risks

- **7-day refresh-token TTL in OAuth Testing mode.** Mitigated by tracking it in `docs/TODO.md` and planning the production move (verification + CASA) before any real customer traffic.
- **Restricted scopes need CASA before production.** Lead time 6-8 weeks. Not on the PoC critical path; tracked under TODO.
- **`subscriberCount` from Data API is rounded** for channels above ~1k subs. For the truer daily delta we use Analytics' `subscribersGained - subscribersLost`. Documented in the platform doc.
- **No webhook in this commit.** PubSubHubbub for new-upload pushes is out of scope; we rely on `engagement_new` polling at 4h. Move to push when SLOs require it.
- **Backfill > 12 months should use Reporting API v1**, not Analytics. Out of scope here; tracked under TODO.

### What this does NOT do

- Does not introduce push-based ingestion for YouTube (PubSubHubbub deferred).
- Does not implement multi-channel Brand-Account selection UI.
- Does not request OAuth verification or CASA — that's a release-gating activity.
- Does not change rate-limit strategies for any other platform.

## Files

- `poc/src/modules/platforms/shared/youtube-api/` — chokepoint client, token refresh, error mapping, types.
- `poc/src/modules/platforms/youtube/` — adapter, context, support matrix, rate-limit strategy, four fetchers, four mappers.
- `poc/src/modules/admin/admin.controller.ts` — `youtubeAuthorizeUrl()` + `youtubeCompleteOAuth()`.
- `poc/src/modules/admin/admin.service.ts` — `discoverYoutubeConnection()` plus the OAuth completion flow.
- `poc/prisma/seed.ts` — four cadence rows for YouTube.
- `poc/.env.example` — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `YOUTUBE_API_KEY`.
- `docs/youtube-oauth-setup.md` — Google Cloud Console walkthrough.
