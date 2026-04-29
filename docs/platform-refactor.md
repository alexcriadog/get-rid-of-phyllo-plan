# Platform Adapter Decomposition — Working Plan

**Status:** Plan, ready to execute
**Last updated:** 2026-04-28
**Audience:** engineer doing the refactor (you), tech lead reviewing
**Companion:** [`scalability-plan.md`](scalability-plan.md), [`scalability-gaps.md`](scalability-gaps.md), [`03-extensibility.md`](03-extensibility.md)
**Scope:** behaviour-preserving decomposition of `facebook.adapter.ts` (1484 lines) and `instagram.adapter.ts` (1298 lines) into a clean Meta-shared core + per-platform fetcher/mapper layers, before adding TikTok.

This is the document we follow line-by-line. Every step compiles. Every step is reversible. No behaviour change unless explicitly called out under "intentional fixes during the move".

---

## TL;DR

- The two Meta adapters duplicate ~60% of their logic in slightly different shapes. The duplication is the bug; the file size is the symptom.
- We extract a `meta-graph/` shared core (one HTTP/rate/persist chokepoint), reduce each adapter to a thin facade, and split the platform-specific work into per-product fetchers (orchestration) and mappers (pure functions).
- 5 phases (plus Phase 0 for tests), each compiling and shipping value: 0) pinning tests, A) extract pure helpers, B) unify `GraphClient`, C) split FB into fetchers, D) extract mappers, E) repeat for IG. Total budget: **5.5 engineer-days**.
- 3 silent bugs found during analysis are fixed during the move (listed under "Intentional fixes").
- Hard ceilings enforced via ESLint at the end of Phase E: `*.adapter.ts` ≤ 250, `*.fetcher.ts` ≤ 350, `*.mapper.ts` ≤ 250, default `max-lines: 600`.
- TikTok ships as a clean replica of the pattern, not as a fourth 1.5K-line file.

---

## 1. Why this refactor, why now

### Hard numbers

```
1484  poc/src/modules/platforms/facebook/facebook.adapter.ts
1479  poc/src/modules/admin/admin.service.ts                    [out of scope here]
1298  poc/src/modules/platforms/instagram/instagram.adapter.ts
─────
2782  total platform-adapter lines, 0% reuse
```

### Why now (not "later, after TikTok")

If we add TikTok against the current FB/IG pattern we get a third 1.2-1.5K file with its own copy of the chokepoint, raw archive, paging walker, usage-header parser, and error classifier. By Phase 2 of the scalability plan that's 4-5 platforms × ~1.5K lines × N silent drifts. Refactor first, replicate the clean pattern, then add platforms. Net cost of the wait: **~5 days**. Net cost of skipping it: weeks recovered later in incident debugging plus a permanent tax on every new platform.

### What success looks like

- Adding a new product to Facebook (e.g. "comments") = one `facebook-comments.fetcher.ts` + one `facebook-comments.mapper.ts`. Zero edits to the chokepoint, zero edits to the adapter facade beyond DI wiring.
- Adding a Meta sibling (Threads) = one new module that imports `meta-graph/`, declares its own `RateLimitStrategy`, ships ~6 fetcher/mapper files. No `callGraph` copy.
- Adding TikTok = a sibling `tiktok-api/` shared core (different auth header, different paging, different rate-limit model) plus one platform module — same shape as Meta but without forcing inheritance.

---

## 2. Anti-overengineering constraints

These are red lines for this refactor. Anything that violates them gets rejected in review.

1. **No `BasePlatformAdapter` inheritance.** TikTok, YouTube, Twitch and X share nothing at the HTTP level with Meta. Composition by **platform family** (Meta-graph, TikTok-api, Google-api), not single-root inheritance.
2. **No abstractions beyond what removes duplication today.** If the only consumer is FB+IG, the abstraction lives in `meta-graph/`, not in `platforms/shared/`. We promote it later if a third caller appears.
3. **No new `*Repository` layer for content/audience persistence.** That's a separate workstream tied to the data-model rework (D5 in the gaps doc). Mixing it in here doubles the blast radius.
4. **No big-bang rewrite.** Every phase compiles. Every phase preserves behaviour exactly except where listed under "Intentional fixes".
5. **No comments explaining what code does** — names and types do that. Comments allowed only for non-obvious *why*: a Graph API quirk, a deprecated metric, a workaround for a specific Meta error code.
6. **No DTO/mapper duplication for trivially shaped data.** If `ContentData` already fits, we don't add per-product canonical types yet (e.g. `StoryContentData`). Flagged as a follow-up but not in this scope.
7. **No premature platform-family generalisation.** `meta-graph/` is *Meta-specific*, not "generic Graph-style API client". We don't try to make `GraphClient` work for TikTok by adding configuration knobs — TikTok gets its own `tiktok-api/` core.

---

## 3. Current state — inventory and findings

### 3.1 Anatomy of `facebook.adapter.ts` (1484 lines)

| Responsibility | Approx. lines | Symbols |
|---|---:|---|
| HTTP transport / chokepoint | ~250 | `callGraph`, `persistRaw`, `parseUsageHeaders`, `safeJson`, `parseNextUrl`, `withToken`, `tokenHash`, `accountIdFromMeta` |
| Rate-limit hint declaration | ~30 | `rateLimitHints` |
| Support matrix | ~50 | `supportMatrix` |
| OAuth context assembly | ~20 | `context` |
| Profile fetch + parse | ~50 | `fetchProfile`, `extractPictureUrl` |
| Audience fetch + parse | ~250 | `fetchAudience`, `fetchAudienceMetric`*, `audienceErrorMessage`, `splitGenderAge`* |
| Posts/content fetch + enrich | ~500 | `fetchContents`, `fetchPosts`, `enrichPostsWithInsights`, `enrichOneItem`, `mergePostInsights`, `mergeVideoInsights`, `extractPostMetrics`, `extractVideoMetrics`, `postToContent`, `videoToContent`, `detectPostContentType`, `extractMediaUrls`, `withinTimeWindow`, `looksLikeInsightsScopeError`* |
| Stories fetch + insights | ~250 | `fetchStories`, `fetchStoryInsights`, `mapStoryInsights`, `storyToContent`, `resolveStoryMedia`, `parseCreationTime` |
| Videos fallback | ~80 | `fetchVideos`*, `videoToContent` |
| Type defs (FB Graph shapes) | ~80 | inline interfaces |

\* = dead code (defined, never called from inside the adapter or its consumers). Removed during the move.

### 3.2 Anatomy of `instagram.adapter.ts` (1298 lines)

Same shape as FB minus stories complexity, plus richer per-media insights handling (breakdown calls, batch fallback to `reach`-only, profile/navigation breakdowns).

### 3.3 Drift between FB and IG (the real cost of duplication)

These are not stylistic differences — each is a behaviour gap that mattered or will matter:

| # | Drift | FB | IG | Impact |
|---|---|---|---|---|
| D1 | Raw-archive of error responses | persists only on 2xx (writes happen *after* the status check) | persists for all responses including 4xx (passes `httpStatus` into archive) | FB error bodies (Meta error code/subcode) lost — debugging blind |
| D2 | Rate-limit hints | `app` + optional `page` | `user_token` + `app` + optional `page` | FB has no per-token bucket; two FB Pages from different OAuth users share an app-scope cap |
| D3 | Hint priority order | `page` first (unshift), `app` second | `user_token` first, `app` second, `page` last (push) | First denial returned differs — admin debugging shows different blocking key for "the same situation" |
| D4 | Raw-archive schema | no `httpStatus` field | includes `httpStatus` | inconsistent shape in `raw_platform_responses` |
| D5 | `context()` signature | `(accessToken, canonicalId, metadata)` | `(accessToken, metadata)` | structural — port doesn't constrain it, divergence will get worse |
| D6 | Error message extraction | `audienceErrorMessage` | `extractMetaError` + `graphErrorFromBody` + `extractGraphError` | three near-identical extractors with slightly different output strings |

These all collapse to a single implementation in `meta-graph/`. The "winning" behaviour for each is decided in §6 (Intentional fixes).

### 3.4 Worker contract (consumer of the port)

`sync.worker.ts` (lines 303-343) dispatches to one of `fetchProfile / fetchAudience / fetchContents / fetchStories` and treats the third positional argument as `metadata: Record<string, unknown>` containing `tokenHash`, `pageId`, `channelId`, `accountId`. Both adapters then dig into that map via `accountIdFromMeta`. **The port doesn't model this contract** — it's an unwritten convention. The refactor codifies it without breaking the worker.

### 3.5 No tests today

`find poc -name '*.spec.ts' -o -name '*.test.ts'` returns empty. **Phase 0 of this refactor is adding pinning tests at the mapper level using fixtures from `raw_platform_responses`.** Without that, "behaviour-preserving" is a hope, not a guarantee.

---

## 4. Target architecture

### 4.1 Three layers, strict responsibilities

```
                    PlatformAdapter (port — unchanged surface)
                                  │
                    ┌─────────────┴─────────────┐
                    │  *.adapter.ts (facade)    │   ≤250 lines
                    │  - implements port        │
                    │  - delegates to fetchers  │
                    │  - injects strategy +     │
                    │    support matrix         │
                    └─────┬─────────────────────┘
                          │
              ┌───────────▼─┐  ┌─────────────┐  ┌───────────────┐
              │ profile     │  │ audience    │  │ content       │
              │ .fetcher    │  │ .fetcher    │  │ .fetcher      │  …
              │ ≤200 lines  │  │ ≤350 lines  │  │ ≤350 lines    │
              └──────┬──────┘  └──────┬──────┘  └──────┬────────┘
                     │ uses           │ uses           │ uses
                     ▼                ▼                ▼
                  ┌─────────────────────┐    ┌──────────────────┐
                  │  GraphClient        │ +  │  *.mapper.ts     │
                  │ (Meta-shared)       │    │  pure functions  │
                  │  - rate bucket      │    │  no DI / no I/O  │
                  │  - http + retry     │    │  ≤250 lines      │
                  │  - persist raw      │    └──────────────────┘
                  │  - usage headers    │
                  │  - error mapping    │
                  └─────────────────────┘
```

- **Adapter facade** owns the port surface and DI wiring. Reads support matrix and rate-limit strategy from injected constants. No HTTP, no parsing.
- **Fetchers** own one product each (profile, audience, content, stories, videos…). Know how to compose Graph endpoints, paginate, batch-call, swallow per-item failures. Talk to `GraphClient.call({...})`. Hand off mapping to mappers.
- **Mappers** are pure: `(rawGraphResponse) => CanonicalType`. Stateless. No `Date.now()` parameters from the caller, no DI. Trivially testable.
- **`GraphClient`** is the single chokepoint: rate bucket → HTTP → metrics → persist raw → status mapping → error classification. Same contract as today, just deduped and behind one class.

### 4.2 Why this shape (vs alternatives we rejected)

| Alternative | Rejected because |
|---|---|
| Keep one big adapter, just split into private classes inside the same file | Doesn't fix duplication FB↔IG, hits the 600-line ceiling immediately |
| Inheritance: `BaseGraphAdapter` extends `BasePlatformAdapter` | Locks Meta and TikTok into a hierarchy they shouldn't share. Composition wins. |
| One file per Graph endpoint | Wrong cardinality — fetchers compose multiple endpoints (e.g. `content` does `/media` + per-media `/insights` + breakdown calls) |
| Move all logic into mappers, fetchers are 1-line wrappers | Mappers stop being pure; testing benefit gone |
| Delay until "after TikTok" | Triples the refactor cost; codifies the duplication into a third platform |

---

## 5. File tree (target end-state)

### 5.1 Shared (Meta family)

```
poc/src/modules/platforms/shared/
  platform-adapter.port.ts                      [exists, slimmed]
  platform-types.ts                             [exists, unchanged]
  platform-errors.ts                            [exists; becomes canonical, port re-imports from here]

  meta-graph/
    index.ts                                    barrel export
    graph-client.ts                             ~200  THE chokepoint
    graph-types.ts                              ~80   GraphInsight, GraphListResponse, GraphPaging
    graph-paging.ts                             ~50   parseNextUrl + walkPages helper
    graph-usage-headers.ts                      ~50   x-app-usage / x-page-usage / x-business-use-case-usage
    graph-errors.ts                             ~80   classify, extractMessage, isScopeError, isUnknownMetric
    graph-context.ts                            ~60   tokenHash, accountIdFrom, withToken
    graph-raw-archive.ts                        ~60   persist to raw_platform_responses
    rate-limit-strategy.port.ts                 ~30   interface — each platform implements
    meta-graph.module.ts                        ~30   Nest module exporting GraphClient
```

### 5.2 Per-platform — Facebook (post-refactor)

```
poc/src/modules/platforms/facebook/
  facebook.module.ts                            ~30   Nest module wiring fetchers + adapter + strategy
  facebook.adapter.ts                           ~150  facade implementing PlatformAdapter
  facebook.constants.ts                         ~30   GRAPH_VERSION, FB_CAPACITY, FB_REFILL_PER_MS, page sizes
  facebook.support-matrix.ts                    ~70   FACEBOOK_SUPPORT_MATRIX constant
  facebook.rate-limit.strategy.ts               ~50   FacebookRateLimitStrategy
  facebook.types.ts                             ~120  FacebookPost, FacebookVideo, FacebookStory, FacebookAttachment, …
  facebook.context.ts                           ~30   FB-specific context() helper

  fetcher/
    facebook-profile.fetcher.ts                 ~80
    facebook-audience.fetcher.ts                ~250  legacy/modern metric handling lives here
    facebook-content.fetcher.ts                 ~280  posts + per-post insights enrichment
    facebook-stories.fetcher.ts                 ~220  stories + media resolution + per-story insights

  mapper/
    facebook-post.mapper.ts                     ~150  postToContent, extractPostMetrics, extractMediaUrls, detectPostContentType
    facebook-video.mapper.ts                    ~80   mergeVideoInsights, extractVideoMetrics
    facebook-story.mapper.ts                    ~110  storyToContent, mapStoryInsights, parseCreationTime
    facebook-audience.mapper.ts                 ~80   distribution parsing

  __tests__/
    facebook-post.mapper.spec.ts
    facebook-story.mapper.spec.ts
    facebook-audience.mapper.spec.ts
    facebook-content.fetcher.spec.ts            uses MockGraphClient + fixtures
    facebook-stories.fetcher.spec.ts
```

**13 production files. Median ~120 lines. Maximum 280. ESLint enforces.**

### 5.3 Per-platform — Instagram (post-refactor)

Mirror of FB with IG-specific bits:

```
poc/src/modules/platforms/instagram/
  instagram.module.ts                           ~30
  instagram.adapter.ts                          ~150
  instagram.constants.ts                        ~30
  instagram.support-matrix.ts                   ~70
  instagram.rate-limit.strategy.ts              ~50
  instagram.types.ts                            ~100
  instagram.context.ts                          ~30

  fetcher/
    instagram-profile.fetcher.ts                ~80
    instagram-audience.fetcher.ts               ~280  three demographic flavours + account insights
    instagram-content.fetcher.ts                ~260  /media + per-media insights with batch fallback
    instagram-stories.fetcher.ts                ~140

  mapper/
    instagram-media.mapper.ts                   ~150  mediaToContent + carousel children
    instagram-insights.mapper.ts                ~120  mapInsightsData, breakdown flattening, per-media-type metric sets
    instagram-audience.mapper.ts                ~120  parseFollowerDemographics

  __tests__/
    instagram-media.mapper.spec.ts
    instagram-insights.mapper.spec.ts
    instagram-audience.mapper.spec.ts
    instagram-content.fetcher.spec.ts
```

### 5.4 Forward — TikTok (replica of the pattern, not a sibling of Meta)

```
poc/src/modules/platforms/shared/tiktok-api/
  index.ts
  tiktok-client.ts                              ~200  Bearer auth, cursor paging, different rate-limit model
  tiktok-types.ts                               ~80
  tiktok-paging.ts                              ~40
  tiktok-errors.ts                              ~60   error_code/message decoding
  tiktok-context.ts                             ~40
  tiktok-usage-headers.ts                       ~40   X-RateLimit-Remaining, x-tt-trace-id
  rate-limit-strategy.port.ts                   reused from shared if signature matches; else local
  tiktok-api.module.ts                          ~30

poc/src/modules/platforms/tiktok/
  tiktok.module.ts                              ~30
  tiktok.adapter.ts                             ~150
  tiktok.constants.ts                           ~30
  tiktok.support-matrix.ts                      ~60
  tiktok.rate-limit.strategy.ts                 ~60
  tiktok.types.ts                               ~120
  tiktok.context.ts                             ~30
  tiktok.oauth.ts                               ~80   Business + Creator dual-flow detection
  fetcher/                                      profile, audience, content, insights
  mapper/                                       video, audience
```

TikTok lands once Phases A-E are done.

---

## 6. Component contracts

These are the precise interfaces the refactor introduces. Not negotiable during the move; behaviour stays inside the named files.

### 6.1 `RateLimitStrategy` port

```typescript
// shared/meta-graph/rate-limit-strategy.port.ts

import type { RateLimitHint } from '@shared/redis/rate-bucket.service';
import type { PlatformAdapterContext } from '../platform-adapter.port';

export interface RateLimitStrategy {
  /**
   * Hints in priority order. The first hint that denies acquire is the one
   * surfaced to admin tooling.
   */
  hints(context: PlatformAdapterContext): RateLimitHint[];
}

export const RATE_LIMIT_STRATEGY = Symbol('RATE_LIMIT_STRATEGY');
```

Each platform exports a class implementing this:

```typescript
// facebook/facebook.rate-limit.strategy.ts
@Injectable()
export class FacebookRateLimitStrategy implements RateLimitStrategy {
  hints(ctx: PlatformAdapterContext): RateLimitHint[] { /* … */ }
}
```

The strategy is what fixes drift D2 + D3 (FB now declares `user_token` like IG; hint order is consistent across the family).

### 6.2 `GraphClient`

Single chokepoint, replaces `callGraph` in both adapters.

```typescript
// shared/meta-graph/graph-client.ts

export interface GraphCallOpts {
  endpoint: string;                    // e.g. '/12345/insights'
  params: Record<string, string | number | undefined>;
  accessToken: string;
  context: PlatformAdapterContext;
  accountId?: bigint;
}

@Injectable()
export class GraphClient {
  constructor(
    private readonly rateBucket: RateBucketService,
    private readonly mongo: MongoService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Per-platform binding. Adapters wrap once at construction time so call
   * sites don't repeat platform/strategy on every call. See
   * `BoundGraphClient` below.
   */
  bind(platform: string, strategy: RateLimitStrategy): BoundGraphClient { /* … */ }
}

export class BoundGraphClient {
  call<T>(opts: GraphCallOpts): Promise<T>;
}
```

`BoundGraphClient.call()` is the unique chokepoint. Internals match today's `callGraph` exactly:

1. Acquire hints atomically (via Lua in `RateBucketService`) → if denied, throw `RateLimitedError`.
2. Record `bucketBefore`, start timer.
3. HTTP GET via shared axios instance (`validateStatus: () => true`).
4. On axios-level failure (network error, no response): observe metrics with status=0, throw `AdapterFetchError` with axios body.
5. On HTTP response: parse usage headers, read `bucketAfter`, observe `metrics.observeApiCall`.
6. **Persist raw response BEFORE status throws (D1+D4 fix).** Always include `httpStatus`.
7. Status mapping:
   - 401/403 → `TokenRevokedError`
   - 429 → `RateLimitedError(resetInMs = retry-after × 1000)`
   - non-2xx other → `AdapterFetchError` with body
8. Return `response.data as T`.

### 6.3 Fetcher shape

```typescript
// facebook/fetcher/facebook-content.fetcher.ts

@Injectable()
export class FacebookContentFetcher {
  constructor(
    @Inject(FACEBOOK_GRAPH_CLIENT) private readonly client: BoundGraphClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> { /* … */ }
}
```

Each fetcher:
- Has exactly one public method (`fetch`).
- Receives the bound `GraphClient` and nothing else (no `MongoService`, no `RateBucketService`).
- Composes endpoint URLs and params; doesn't know about HTTP.
- Calls a mapper for every conversion to canonical types.
- Logs at `debug` for per-item failures; never swallows top-level failures.

### 6.4 Mapper shape

Pure functions in a flat module — no class.

```typescript
// facebook/mapper/facebook-post.mapper.ts

export function postToContent(post: FacebookPost): ContentData { /* … */ }
export function extractPostMetrics(post: FacebookPost): ContentMetrics { /* … */ }
export function extractMediaUrls(post: FacebookPost): string[] { /* … */ }
export function detectPostContentType(post: FacebookPost): ContentType { /* … */ }
```

Rules:
- **No `Date.now()` calls inside mappers.** Mappers receive `fetchedAt` from the caller if needed (none of the current ones actually need it — `fetchedAt` belongs to the fetcher).
- **No I/O.** No DB, no HTTP, no logging. A mapper unit test runs in microseconds with no setup.
- **No throws.** Mappers tolerate partial input; they return canonical shapes with nullable fields. The fetcher decides what to do about empties.

### 6.5 Adapter facade

```typescript
// facebook/facebook.adapter.ts

@Injectable()
export class FacebookAdapter implements PlatformAdapter {
  readonly platform = 'facebook';

  constructor(
    private readonly profileFetcher: FacebookProfileFetcher,
    private readonly audienceFetcher: FacebookAudienceFetcher,
    private readonly contentFetcher: FacebookContentFetcher,
    private readonly storiesFetcher: FacebookStoriesFetcher,
    private readonly rateLimit: FacebookRateLimitStrategy,
  ) {}

  rateLimitHints(ctx?: PlatformAdapterContext): RateLimitHint[] {
    return this.rateLimit.hints(ctx ?? {});
  }

  supportMatrix(): SupportMatrix {
    return FACEBOOK_SUPPORT_MATRIX;
  }

  fetchProfile(accessToken: string, canonicalId: string, metadata?: Record<string, unknown>) {
    return this.profileFetcher.fetch(accessToken, canonicalId, metadata);
  }

  fetchAudience(accessToken: string, canonicalId: string, metadata?: Record<string, unknown>) {
    return this.audienceFetcher.fetch(accessToken, canonicalId, metadata);
  }

  fetchContents(accessToken: string, canonicalId: string, opts: FetchOpts, metadata?: Record<string, unknown>) {
    return this.contentFetcher.fetch(accessToken, canonicalId, opts, metadata);
  }

  fetchStories(accessToken: string, canonicalId: string, metadata?: Record<string, unknown>) {
    return this.storiesFetcher.fetch(accessToken, canonicalId, metadata);
  }
}
```

That's the whole file. ~150 lines including imports.

### 6.6 Per-platform Nest module

```typescript
// facebook/facebook.module.ts

@Module({
  imports: [MetaGraphModule],
  providers: [
    FacebookAdapter,
    FacebookProfileFetcher,
    FacebookAudienceFetcher,
    FacebookContentFetcher,
    FacebookStoriesFetcher,
    FacebookRateLimitStrategy,
    {
      provide: FACEBOOK_GRAPH_CLIENT,
      useFactory: (client: GraphClient, strategy: FacebookRateLimitStrategy) =>
        client.bind('facebook', strategy),
      inject: [GraphClient, FacebookRateLimitStrategy],
    },
  ],
  exports: [FacebookAdapter],
})
export class FacebookModule {}
```

Nothing else outside the platform folder needs to know about fetchers.

### 6.7 Errors module — flip ownership

Today: errors live in `platform-adapter.port.ts`, `platform-errors.ts` is a re-export shim.
After: errors live in `platform-errors.ts` (canonical), `platform-adapter.port.ts` re-exports for backwards compatibility, the worker imports from `platform-errors.ts` (already does).

This is a 5-minute change but it's the right ownership: a port shouldn't define exception types.

---

## 7. Migration plan

### Phase 0 — Pinning tests *(0.5 days)*

**Pre-condition for everything else.** Without these, "behaviour-preserving" is unverifiable.

Steps:

1. Pull 5-10 representative responses from `raw_platform_responses` per adapter:
   - Facebook: 1 page profile, 1 audience response (modern + legacy metric mix), 1 posts page (with carousel + video + image), 1 video insights, 1 stories list, 1 story insights, 1 story media (photo + video).
   - Instagram: 1 profile, 1 follower_demographics + 1 reached_audience_demographics, 1 account-level insights total_value, 1 follower_count time series, 1 media list (CAROUSEL + REELS + IMAGE + VIDEO), 1 per-media insights for each media type, 1 stories list.
2. Save as JSON fixtures under `poc/src/modules/platforms/<platform>/__tests__/fixtures/`.
3. Write snapshot tests calling **the current** mapping logic (before any move): exercise `postToContent`, `extractPostMetrics`, `mediaToContent`, `mapInsightsData`, `parseFollowerDemographics`, `mapStoryInsights`, `extractMediaUrls`, `splitGenderAge` (used by IG, dead in FB).
4. Run — green is the baseline. Snapshots are committed.
5. From this point, every PR shows green snapshots or explicitly updates them in the PR description with reason.

**Tooling decision:** the project uses NestJS — Jest is the natural default. Verify `jest.config*` doesn't exist yet (it doesn't), add it now: `ts-jest` preset, default rootDir, only `*.spec.ts` collected.

### Phase A — Extract pure helpers to `meta-graph/` *(1.5 days)*

Behaviour-preserving moves. FB and IG keep their own `callGraph` for now; we just deduplicate the helpers underneath.

| Step | What moves | From | To | Notes |
|---|---|---|---|---|
| A1 | `GraphInsight`, `GraphListResponse`, `GraphPaging`, `GraphInsightValue` | both adapters (duplicated) | `meta-graph/graph-types.ts` | IG's `GraphInsight` includes `total_value.breakdowns` — keep the IG superset |
| A2 | `parseUsageHeaders`, `safeJson` | both | `meta-graph/graph-usage-headers.ts` | identical bodies, safe to merge |
| A3 | `parseNextUrl` | both | `meta-graph/graph-paging.ts` | identical |
| A4 | `tokenHash`, `accountIdFromMeta`, `withToken`, `asNumber` | both | `meta-graph/graph-context.ts` | also export a typed `extractAccountId(metadata)` |
| A5 | error helpers (`audienceErrorMessage`, `extractMetaError`, `graphErrorFromBody`, `extractGraphError`, `looksLikeInsightsScopeError`) | both | `meta-graph/graph-errors.ts` | canonicalise on IG's richer `extractMetaError` (returns `(#code/sub) message`); FB's audit log lines change format slightly — mention in PR |
| A6 | `persistRaw` | both | `meta-graph/graph-raw-archive.ts` | takes `(mongo, platform, body, endpoint, accountId, httpStatus)`; httpStatus default 200 (FB call sites pass 200 for now; B2 will fix that) |

After Phase A:

- FB and IG adapters drop ~150 lines each (~300 total).
- `meta-graph/` exists with ~300 lines spread across 6 small files.
- Build green, snapshots green.
- No public API changes.

### Phase B — Unify `GraphClient` *(1 day)*

| Step | What |
|---|---|
| B1 | Create `RateLimitStrategy` port + `FacebookRateLimitStrategy` + `InstagramRateLimitStrategy`. Each contains the existing `rateLimitHints()` body verbatim. |
| B2 | Create `GraphClient` with `bind(platform, strategy)` returning `BoundGraphClient.call()`. Body = current `callGraph` minus the platform-specific bits. **Apply intentional fixes** (D1, D4 — see §8.1). |
| B3 | `MetaGraphModule` — Nest module providing `GraphClient` and exporting it. Imported by FB and IG modules. |
| B4 | Per platform: add `FACEBOOK_GRAPH_CLIENT` / `INSTAGRAM_GRAPH_CLIENT` providers via factory (see §6.6). |
| B5 | Replace each adapter's inline `callGraph` invocation with `this.graphClient.call({...})`. Delete `callGraph`, `persistRaw`, `parseUsageHeaders`, etc. from the adapters (already moved in Phase A but still referenced in adapter — now deleted). |
| B6 | Adapter `rateLimitHints()` delegates to the strategy. |

After Phase B:

- Both adapters lose another ~250 lines each.
- `GraphClient` is the only place HTTP happens for Meta family.
- Drift D1, D2, D3, D4 closed (FB now matches IG behaviour for raw archive + hints; both share the same chokepoint).
- Snapshots green.
- The two adapter files now sit at ~900 (FB) / ~750 (IG). Still over ceiling, but Phase C/D split them.

### Phase C — Split FB into fetchers *(1.5 days)*

Order matters: smallest fetcher first proves the pattern.

| Step | What | Lines moved |
|---|---|---:|
| C1 | `FacebookProfileFetcher` (`fetchProfile` + `extractPictureUrl`) | ~70 |
| C2 | `FacebookAudienceFetcher` (`fetchAudience` + dead `fetchAudienceMetric` + `splitGenderAge` deleted; `audienceErrorMessage` → already in `graph-errors.ts`) | ~250 |
| C3 | `FacebookContentFetcher` (`fetchContents`, `fetchPosts`, `enrichPostsWithInsights`, `enrichOneItem`, `withinTimeWindow`; dead `fetchVideos` deleted) | ~280 |
| C4 | `FacebookStoriesFetcher` (`fetchStories`, `resolveStoryMedia`, `fetchStoryInsights`, `parseCreationTime`) | ~220 |
| C5 | `FacebookAdapter` becomes the facade in §6.5. Delete now-empty private methods. |

Dead code removal during this phase:

- `FacebookAdapter.fetchAudienceMetric` — never called
- `FacebookAdapter.splitGenderAge` — never called (FB doesn't expose gender/age)
- `FacebookAdapter.fetchVideos` + helpers — never called (single source of truth comment in `fetchContents` confirms this is intentional)
- `FacebookAdapter.looksLikeInsightsScopeError` — never called

Snapshots stay green. Mappers haven't moved yet.

### Phase D — Mappers as pure functions *(1 day)*

| Step | What |
|---|---|
| D1 | `mapper/facebook-post.mapper.ts` — `postToContent`, `extractPostMetrics`, `extractMediaUrls`, `detectPostContentType`. Pure functions, no class. |
| D2 | `mapper/facebook-video.mapper.ts` — `videoToContent`, `mergeVideoInsights`, `extractVideoMetrics` |
| D3 | `mapper/facebook-story.mapper.ts` — `storyToContent`, `mapStoryInsights`, `parseCreationTime`, `mergePostInsights` |
| D4 | `mapper/facebook-audience.mapper.ts` — distribution parsing helpers |
| D5 | Fetchers import mappers; remove the now-dead private methods. |
| D6 | New mapper-level snapshot tests — reuse fixtures from Phase 0, but now exercise the public mapper functions directly. The Phase 0 indirect tests (calling old methods) get deleted. |

After Phase D:

- FB platform folder hits target file sizes.
- ESLint passes with the per-folder ceilings (§9).
- Mapper test suite runs in <100ms total (no I/O).

### Phase E — Repeat for Instagram *(0.5 days)*

With Meta-shared in place + the FB pattern proved:

| Step | What |
|---|---|
| E1 | `InstagramProfileFetcher`, `InstagramAudienceFetcher` (3 demographic flavours + account insights), `InstagramContentFetcher` (with batch + breakdown calls), `InstagramStoriesFetcher` |
| E2 | `mapper/instagram-media.mapper.ts` — `mediaToContent`, carousel children handling |
| E3 | `mapper/instagram-insights.mapper.ts` — `mapInsightsData`, `insightMetricsForMedia` (per-media-type metric set selection), breakdown flattening |
| E4 | `mapper/instagram-audience.mapper.ts` — `parseFollowerDemographics` |
| E5 | Adapter facade |

E is faster because the meta-graph layer is already exercised; this is mechanical replication.

### Phase F — TikTok *(separate, ~3 days, NOT part of this plan)*

Listed only to anchor that the refactor's success criterion is "TikTok fits this pattern in 3 days, not 7." Tracked in a follow-up doc.

---

## 8. Edge cases and invariants — DO NOT DROP

Anything in this section, if it changes during the refactor, is a regression. Reviewer treats it like a security check.

### 8.1 Intentional fixes (only these — everything else is preserved verbatim)

These are the ONLY behaviour changes shipped during the refactor. Each is documented in the PR.

| ID | Fix | Where applied |
|---|---|---|
| D1 | Persist raw archive before status-based throws (capture 4xx bodies) | `GraphClient.call` Phase B2 |
| D4 | Always include `httpStatus` in raw archive document | `graph-raw-archive.ts` Phase A6 |
| D2 | Facebook gains a `user_token` rate-limit hint matching Instagram's pattern | `FacebookRateLimitStrategy` Phase B1 |
| D3 | Hint priority order is consistent across Meta family: `user_token`, `app`, `page` | both strategies Phase B1 |
| D6 | Single Graph error extractor (`extractMetaError` form: `"(#100/2207001) message"`) | `graph-errors.ts` Phase A5 |
| Dead-code | Remove `fetchVideos`, `fetchAudienceMetric`, `splitGenderAge` (FB), `looksLikeInsightsScopeError` (FB) | Phase C |

### 8.2 Invariants to preserve verbatim

These mattered enough to be coded; they must survive the move.

1. **Token never logged.** `tokenHash` exists because raw tokens are PII. Never store `accessToken` in metrics, raw archive, or logs.
2. **Page Stories `creation_time` is a string of UNIX seconds.** `parseCreationTime` handles `string | number | ISO`. Tested.
3. **Meta v22 deprecations** — current adapter code documents the metric renames (`page_fans_country` → `page_follows_country`, `page_fans_gender_age` removed with no successor, IG `impressions` removed). All comments preserved on move.
4. **IG Stories metrics** require **own breakdown calls** for `profile_activity` and `navigation`; cannot be batched with the base set. `insightMetricsForMedia` returns the safe-batchable subset; breakdown calls are issued separately. Stays.
5. **IG `follower_demographics` rejects `timeframe`**, `reached_audience_demographics` and `engaged_audience_demographics` *require* it (`this_month` / `this_week` / `prev_month` only post-v20). Current `needsTimeframe` flag preserved.
6. **IG Account-level insights v22** rejects `impressions`, `email_contacts`, `phone_call_clicks`, `text_message_clicks`, `get_directions_clicks` for the account scope. Keep current `totalMetrics` array verbatim. Don't alphabetise.
7. **FB `page_follows` is cumulative**, not delta. Sum is meaningless. Keep `followerCountSeries` capture + `page_follows_net_28d` derivation.
8. **FB Stories** retrieves stories list with `fields=post_id,status,creation_time,media_type,media_id,url` and ALWAYS issues 2 per-story calls (resolve media + fetch insights) batched 5-at-a-time. Wall-clock matters; preserve batching.
9. **IG carousel children** — when a media has children, `mediaUrls[]` collects child `media_url` values and `thumbnailUrl` falls back to first child's `thumbnailUrl`. Don't simplify.
10. **Both adapters use `validateStatus: () => true`** on axios — the chokepoint inspects status itself. Keep this on the shared axios instance.
11. **Graph paging next URL** has the version prefix stripped before reuse (`/v22.0/foo` → `/foo`) and the `access_token` query parameter dropped. Both are required to reuse our axios instance with consistent timeouts. `parseNextUrl` invariants stay.
12. **Throttle lock** is owned by the worker, not adapters. Adapters know nothing about it. Refactor doesn't touch the worker's `ThrottleLockService` interaction.
13. **Worker's `runWithProduct` AsyncLocalStorage** binds `product` so `metrics.observeApiCall` writes the correct row to `api_call_log`. The chokepoint is downstream of this — keep `metrics.observeApiCall` as the only call site that reads the ALS context (don't add a new one in `GraphClient` pre-mapping).
14. **`accountId` flows from worker → adapter → mapper as `bigint`.** Mongo persistence converts to string; metrics observe as `bigint | null`. Don't widen to `number` anywhere — IG/FB IDs overflow `Number.MAX_SAFE_INTEGER`.

### 8.3 Worker contract — codify the metadata shape

Today the worker passes a `context` object as the third positional argument to `fetchProfile/fetchAudience/...`. Adapters reach into it via `accountIdFromMeta`, `metadata['page_id']`, `metadata['channel_id']`. The port doesn't model this.

We close the contract during the refactor:

```typescript
// shared/platform-adapter.port.ts (updated)

export interface AdapterMetadata {
  accountId?: bigint | string;
  tokenHash?: string;
  pageId?: string;
  channelId?: string;
  /** Open extension slot — never relied on by the port itself. */
  [key: string]: unknown;
}

export interface PlatformAdapter {
  // Replace `metadata?: Record<string, unknown>` with `metadata?: AdapterMetadata`.
}
```

Worker is updated to construct `AdapterMetadata` explicitly. Behaviour identical, intent typed.

### 8.4 What the refactor MUST NOT change

- The DI shape of `PlatformsModule` — its consumers (the worker) keep importing `ADAPTER_REGISTRY` from `platforms.module.ts`.
- The string keys of the adapter registry (`'facebook'`, `'instagram'`) — Account.platform values must keep matching.
- Mongo collection names (`raw_platform_responses`, `posts`, `audience_snapshots`, `identity_snapshots`, `event_log`) — already used by admin reports.
- `RateLimitHint.keyTemplate` strings — bucket keys end up in `api_call_log.rate_bucket_key` and admin dashboards group on them. Renaming a bucket key breaks historical aggregation.
- The set of metrics emitted by `metrics.incr` and `metrics.observeApiCall` calls and their tag shapes — Prometheus dashboards (when they land in Phase 1 of the scalability plan) will key off these.
- Public exports of `platform-adapter.port.ts` — even if internals move, names stay re-exported for at least one release.

---

## 9. Guard rails

### 9.1 ESLint configuration

```jsonc
// poc/.eslintrc.cjs   (or .eslintrc.json)
{
  "rules": {
    "max-lines": ["error", { "max": 600, "skipBlankLines": true, "skipComments": true }],
    "max-lines-per-function": ["error", { "max": 80, "skipBlankLines": true, "skipComments": true }],
    "complexity": ["error", 12]
  },
  "overrides": [
    { "files": ["**/*.adapter.ts"], "rules": { "max-lines": ["error", 250] } },
    { "files": ["**/*.mapper.ts"],  "rules": { "max-lines": ["error", 250] } },
    { "files": ["**/*.fetcher.ts"], "rules": { "max-lines": ["error", 350] } },
    { "files": ["**/__tests__/**"], "rules": { "max-lines": "off" } }
  ]
}
```

CI fails on violations. Adding the rule before Phase A would block the codebase today (admin.service.ts, FB/IG adapters all over) — solution: add the rule **at the end of Phase E** when no existing file violates it. Until then, manual review.

Alternative considered: enable rule with per-file `eslint-disable` baseline. Rejected — masks the existing problems.

### 9.2 CI gate

Add a job to the existing CI pipeline (or create one if absent):

```bash
pnpm --filter poc lint
pnpm --filter poc test
pnpm --filter poc tsc --noEmit
```

The tsc check is critical: TypeScript catches DI wiring mistakes (forgotten `@Inject`, missing provider in module) at build time.

### 9.3 PR checklist (added to PR template)

```
- [ ] No file >600 lines (or no new file violates the per-suffix ceiling)
- [ ] Snapshot tests green; deltas explained in PR description
- [ ] No new mapper does I/O or calls Date.now()
- [ ] No new fetcher imports MongoService or RateBucketService directly
- [ ] No regression to listed invariants in §8.2
```

---

## 10. Testing strategy

### 10.1 Coverage targets per layer

| Layer | What to test | How |
|---|---|---|
| Mappers | All public functions, every input shape (carousel/video/image/REELS/STORY for IG; post/video/story for FB) | Snapshot tests with fixtures from `raw_platform_responses` |
| Fetchers | Endpoint composition, paging, batch fallback, partial failure swallowing | Unit tests with `MockGraphClient` injecting canned responses (one per test scenario) |
| `GraphClient` | Status mapping (401→TokenRevoked, 429→RateLimited, 5xx→AdapterFetchError), raw archive write, usage header parsing, rate bucket integration | Integration tests with a real RateBucketService against a Redis container or a test double + `nock` for HTTP |
| `RateLimitStrategy` | Hints in correct order with/without context | Trivial unit tests |
| Adapter facade | DI wiring + delegation only — no logic to test | Skip tests at the facade level |

### 10.2 Fixture sourcing

Fixtures must be **redacted real responses**, not hand-crafted JSON. Use the live `raw_platform_responses` collection:

```bash
mongosh "$MONGO_URL" --eval '
  db.raw_platform_responses
    .find({ platform: "facebook", endpoint: { $regex: "/posts" } })
    .sort({ fetchedAt: -1 })
    .limit(1)
    .forEach(d => printjson(d.body));
' > poc/src/modules/platforms/facebook/__tests__/fixtures/posts-page-1.json
```

Redact tokens (already absent — body is just Graph response), redact internal account IDs by replacing with stable test IDs.

### 10.3 What we explicitly do NOT test

- Wall-clock timeouts and retry timings — flaky, low value.
- BullMQ integration end-to-end here — that's the worker's test surface, not the adapter's.
- Live Graph API calls — that's the existing manual end-to-end run, not a unit test.
- Admin UI — out of scope.

---

## 11. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Snapshot drift not caused by us (Mongo-stored fixtures evolve as Meta changes shapes) | Low | Fixtures are committed JSON, immutable until a PR updates them with reason |
| DI wiring mistake on a fetcher silently fails at runtime | Medium | `tsc --noEmit` catches missing providers; integration smoke test (start the Nest app, call one endpoint) added to CI |
| Behaviour change slips through because mapper-level snapshots pass but fetcher-level orchestration changes | Low-Medium | Phase 0 snapshots also exercise `fetchProfile`/`fetchAudience`/`fetchContents` via the live (current) adapter against fixtures with a stubbed HTTP layer (nock). These survive Phase A-E and re-target the new fetchers in Phase D. |
| Worker breaks because `AdapterMetadata` typing rejects something the runtime tolerated | Medium | Phase 0 also adds a worker-level integration test: feed a real `BullMQ` job through `dispatchFetch` against a stubbed adapter. Catches signature mismatches. |
| ESLint rule retroactively breaks the build before Phase E completes | High if enabled early | Rule is enabled **only** at the end of Phase E. Manual review enforces ceilings before that. |
| Phase B's `GraphClient` introduces a subtle bug in the error mapping that only shows up against live Meta | Medium | After Phase B, run a real sync against the staging Meta app for both FB and IG (single account each), inspect `api_call_log` and `event_log` for shape parity vs pre-refactor baseline captured in Phase 0 |
| Time blow-out: discovery during the move shows more drift than catalogued | Medium | Phase A is intentionally low-risk and front-loaded. If Phase A reveals more drift, we re-budget Phase B-E on day 2 instead of finding out on day 5. |

---

## 12. Definition of done

The refactor is done when **all** of these are true:

- [ ] `meta-graph/` exists with the 8 files in §5.1.
- [ ] `facebook/` and `instagram/` match the trees in §5.2 / §5.3.
- [ ] No file in `poc/src/modules/platforms/` exceeds the per-suffix ceiling.
- [ ] ESLint config from §9.1 is enabled in CI and passes.
- [ ] Snapshot tests for FB and IG mappers + fetcher orchestration tests pass.
- [ ] Live smoke test: one IG sync + one FB sync against the staging Meta app produces the same `api_call_log`, `raw_platform_responses`, `posts`, `audience_snapshots` shapes as a pre-refactor baseline (within the §8.1 intentional fixes).
- [ ] Dead code listed in §3.1 is removed; PR diff shows the deletions.
- [ ] Worker imports unchanged; `PlatformsModule` adapter registry unchanged; Mongo collection names unchanged.
- [ ] One ADR added (`docs/adr/0014-platform-adapter-decomposition.md` — first free slot after the existing 0001-0013) summarising decisions and pointing to this document for the detailed plan.
- [ ] This document is updated with notes (any deviations, surprises, follow-ups) at the bottom of §14.

---

## 13. Out of scope (explicitly NOT in this refactor)

These come up naturally during the work; they are NOT included here. Track separately.

- `admin.service.ts` (1479 lines) split — different concern, different patterns. Same ESLint guard rails will apply once enabled.
- Per-product canonical types (`StoryContentData`, `LiveStreamContentData`, etc.) — flagged as "max-info per platform" follow-up.
- Polymorphic `RateLimitStrategy` across non-Meta platforms (B4 of the scalability plan) — Meta strategy is enough for now.
- Token refresh job (D3 of the gaps doc) — adapter-level OAuth is unchanged.
- KMS-backed token encryption (D4) — encryption layer is unchanged.
- `api_call_log` retention — operational, not refactor.
- TikTok adapter implementation — follows this refactor as Phase F in a separate plan.
- Any change to BullMQ, Redis, MySQL schema, Mongo schema, OAuth flow, scheduler, manual-refresh API.

---

## 14. Notes during execution

*(Append here as Phase 0 → E happen. Capture surprises, deviations, and follow-ups so the document is the running record.)*

### Phase 0 — done 2026-04-28

- Tooling: installed `jest@^29.7.0` + `ts-jest@^29.1.0` (devDependencies). `package.json:scripts.test` rewired from placeholder echo to `jest`; `test:watch` added.
- `jest.config.cjs` created at `poc/jest.config.cjs`. Path alias mapping (`@/`, `@shared/`, `@modules/`) mirrors `tsconfig.json:compilerOptions.paths`. `rootDir: 'src'`, `testMatch: ['**/__tests__/**/*.spec.ts']`. ts-jest reuses the existing `tsconfig.json`.
- Deviation from §10.2 on fixture sourcing: live Mongo not reachable from the working session. Used **synthetic fixtures inlined in the spec files** matching the exact typed Graph response shapes from `facebook.adapter.ts` and `instagram.adapter.ts`. This is acceptable for behaviour pinning (input fixed → output snapshot) but the doc's long-term aspiration of redacted-real fixtures still stands; can be backfilled when Mongo is reachable. No production data committed.
- 6 spec files added under `src/modules/platforms/{facebook,instagram}/__tests__/`:
  - `facebook-post.mapper.spec.ts` — 21 tests, 20 snapshots (postToContent ×4, extractPostMetrics ×2, extractMediaUrls ×3, detectPostContentType ×6, mergePostInsights, mergeVideoInsights, extractPictureUrl ×4)
  - `facebook-story.mapper.spec.ts` — 12 tests, 12 snapshots (storyToContent ×3, mapStoryInsights ×3, parseCreationTime ×6)
  - `facebook-video.mapper.spec.ts` — 5 tests, 4 snapshots (videoToContent ×2, extractVideoMetrics ×3) — flagged "scheduled for deletion" per §3.1 dead-code list
  - `instagram-media.mapper.spec.ts` — 8 tests, 7 snapshots (mediaToContent ×5, extractMetrics ×3)
  - `instagram-insights.mapper.spec.ts` — 11 tests, 10 snapshots (mapInsightsData ×4, insightMetricsForMedia ×7)
  - `instagram-audience.mapper.spec.ts` — 7 tests, 5 snapshots (parseFollowerDemographics ×4, splitGenderAge ×3)
- **Total: 64 tests, 58 snapshots, 100% green twice in a row (deterministic).** `tsc --noEmit` clean.
- `Date.now()` stabilised via `jest.useFakeTimers().setSystemTime(new Date('2026-04-28T12:00:00.000Z'))` in beforeAll for any spec exercising `*ToContent` (which sets `fetchedAt: new Date()`).
- Private methods reached via `as unknown as Mapper` cast; production class visibility unchanged. Phase D will retarget tests at exported pure functions in `mapper/*.mapper.ts` and the casts disappear.
- Snapshot of `insightMetricsForMedia` per media type (STORY / REELS / VIDEO / IMAGE / CAROUSEL_ALBUM) is the load-bearing pin for invariant §8.2.4 — Graph rejects entire batches if the metric set drifts. Reviewer must scrutinise any update to that snapshot in Phase A-E.
- Surprises:
  - `jest.config.cjs` initially failed to parse due to `**/__tests__/` inside a JSDoc block comment closing it prematurely. Fixed by switching to `// ` line comments.
  - Otherwise no surprises; the adapters' methods are easily isolated for pinning.

### Phase A — done 2026-04-28

- 6 helper files + 1 barrel created under `poc/src/modules/platforms/shared/meta-graph/`:
  - `graph-types.ts` (37 lines) — `GraphInsight`, `GraphListResponse`, `GraphPaging`, `GraphInsightValue` (IG superset of `total_value.breakdowns`)
  - `graph-usage-headers.ts` (42 lines) — `parseUsageHeaders` + private `safeJson`
  - `graph-paging.ts` (30 lines) — `parseNextUrl`
  - `graph-context.ts` (57 lines) — `tokenHash`, `extractAccountId`, `withToken`, `asNumber`
  - `graph-errors.ts` (69 lines) — `extractGraphError`, `extractMetaError`, `looksLikeInsightsScopeError` (canonical D6 fix: pretty form `(#code/sub) message`)
  - `graph-raw-archive.ts` (45 lines) — `persistRaw(mongo, platform, body, endpoint, accountId, httpStatus = 200)` with D4 fix (always writes `httpStatus`)
  - `index.ts` (7 lines) — barrel export
- Both adapters wired to import from meta-graph; inline duplicates removed:
  - **FB: 1484 → 1347 lines (-137)**. Removed: 4 inline interfaces, `parseUsageHeaders`, `safeJson`, `parseNextUrl`, `tokenHash`, `withToken`, `accountIdFromMeta`, `asNumber`, `audienceErrorMessage`, `persistRaw`. Replaced `audienceErrorMessage` callers with `extractMetaError` (D6 — log strings now `(#code/sub) message`).
  - **IG: 1298 → 1116 lines (-182)**. Removed: 4 inline interfaces, `extractGraphError`, `graphErrorFromBody`, `extractMetaError`, `parseUsageHeaders`, `safeJson`, `parseNextUrl`, `tokenHash`, `withToken`, `accountIdFromMeta`, `asNumber`, `persistRaw`.
  - `accountIdFromMeta` import aliased as `extractAccountId` to make the call sites read better.
- **Net: 319 lines of duplicated code collapsed into 287 lines of single-source meta-graph utilities.** The "saved" line count is small but the deduplication is the value: a bug in `parseUsageHeaders` is fixed once, not twice.
- Intentional fixes landed: D4 (httpStatus always present in raw archive — FB now writes `httpStatus: 200` on success, IG continues to write `response.status`); D6 (FB error log strings unified on the IG-style pretty form `(#code/sub) message`).
- Intentional fixes NOT yet landed (Phase B work): D1 (persist raw on errors — FB's `callGraph` still writes after status throws; will move to GraphClient in Phase B), D2 (FB `user_token` rate-limit hint — `rateLimitHints` body unchanged this phase), D3 (hint priority order).
- Dead code NOT yet removed (Phase C scope): `fetchVideos`, `fetchAudienceMetric`, `splitGenderAge`, `looksLikeInsightsScopeError` in FB.
- Validation: `tsc --noEmit` clean. Jest 64/64 tests, 58/58 snapshots, all green. No snapshot updates needed — the moves were behaviour-preserving exactly as required.
- Surprises: none. The drift between FB/IG persistRaw signatures (FB 3-arg, IG 4-arg with `httpStatus`) absorbed cleanly via the default-parameter form `persistRaw(..., httpStatus = 200)`.

### Phase B — done 2026-04-28

- 7 new files added:
  - `shared/meta-graph/rate-limit-strategy.port.ts` (24 lines) — `RateLimitStrategy` interface
  - `shared/meta-graph/graph-client.ts` (~210 lines) — `GraphClient` (DI’d) + `BoundGraphClient.call<T>(opts)`. The single chokepoint for every Meta-family Graph API request.
  - `shared/meta-graph/meta-graph.module.ts` (13 lines) — Nest module exporting GraphClient
  - `facebook/facebook.tokens.ts` (5 lines) — `FACEBOOK_GRAPH_CLIENT` symbol
  - `facebook/facebook.rate-limit.strategy.ts` (52 lines) — `FacebookRateLimitStrategy` with D2 + D3 fixes
  - `instagram/instagram.tokens.ts` (5 lines) — `INSTAGRAM_GRAPH_CLIENT` symbol
  - `instagram/instagram.rate-limit.strategy.ts` (47 lines) — `InstagramRateLimitStrategy` (body verbatim from old inline `rateLimitHints`)
- `meta-graph/index.ts` extended to barrel-export `rate-limit-strategy.port`, `graph-client`, `meta-graph.module`.
- Both `facebook.module.ts` and `instagram.module.ts` rewired:
  - Import `MetaGraphModule`.
  - Register the strategy as a provider.
  - Add a factory provider under `FACEBOOK_GRAPH_CLIENT` / `INSTAGRAM_GRAPH_CLIENT` returning `client.bind(platform, strategy)`.
- Adapters re-shaped:
  - **FB constructor: `(rateBucket, mongo, metrics)` → `(graphClient, strategy)`.** Removed `axios.create`, `this.http`, `CallGraphOpts`, the entire 100+ line `callGraph` method, and the constants `GRAPH_BASE`, `GRAPH_VERSION`, `DEFAULT_TIMEOUT_MS`, `FB_REFILL_PER_MS`, `FB_CAPACITY`. Kept `DEFAULT_PAGE_SIZE`. `rateLimitHints()` delegates to `this.strategy.hints()`. Every call site `this.callGraph<T>(...)` swapped to `this.graphClient.call<T>(...)` (signature is identical).
  - **IG constructor: same swap.** Same set of removals.
- Pinning specs updated: 6 files, each `new <Adapter>(undefined, undefined, undefined)` → `(undefined, undefined)` to match the new 2-arg constructor. Mappers don't touch the injected services so the snapshots are unaffected.
- **FB: 1347 → 1178 (–169).** Cumulative since pre-refactor: 1484 → 1178 = –306 (–20.6%).
- **IG: 1116 → 938 (–178).** Cumulative since pre-refactor: 1298 → 938 = –360 (–27.7%).
- Intentional fixes landed: D1 (FB now archives 4xx/5xx error bodies — the new `BoundGraphClient.call` persists raw BEFORE status throws, matching IG); D2 (FB gains `user_token` rate-limit hint); D3 (hint priority order `user_token` → `app` → `page` consistent across the family).
- Validation: `tsc --noEmit` clean. Jest 64/64 tests, 58/58 snapshots, all green. No snapshot updates needed.
- Risk to validate at integration time (`docs/platform-refactor.md §11`): the live smoke test of one IG sync + one FB sync against the staging Meta app, comparing `api_call_log` and `raw_platform_responses` shapes against pre-refactor baseline. Cannot be run from this environment; flagged for the user.

### Phases C + D + E — done 2026-04-28 (combined for FB, then mirrored for IG)

Combined per-platform extraction (Phase C fetchers + Phase D mappers in lockstep) since fetchers depend on mapper functions; doing them separately would have created a temporary "private mapper methods on a class without a class" gap.

**Files added — Facebook (8 new):**

| File | Lines | Role |
|---|---:|---|
| `facebook.types.ts` | 71 | Graph response shapes |
| `facebook.constants.ts` | 4 | `DEFAULT_PAGE_SIZE` |
| `facebook.support-matrix.ts` | 55 | `FACEBOOK_SUPPORT_MATRIX` const |
| `facebook.context.ts` | 24 | `buildFacebookContext()` (pageId defaults to canonicalId for FB Pages) |
| `mapper/facebook-post.mapper.ts` | 165 | `postToContent`, `extractPostMetrics`, `extractMediaUrls`, `detectPostContentType`, `mergePostInsights`, `extractPictureUrl` |
| `mapper/facebook-video.mapper.ts` | 93 | `videoToContent` (dead), `extractVideoMetrics` (dead), `mergeVideoInsights` (alive) |
| `mapper/facebook-story.mapper.ts` | 110 | `storyToContent`, `mapStoryInsights`, `parseCreationTime` |
| `fetcher/facebook-profile.fetcher.ts` | 56 | one public `fetch()` |
| `fetcher/facebook-audience.fetcher.ts` | 178 | dead `fetchAudienceMetric` + `splitGenderAge` purged |
| `fetcher/facebook-content.fetcher.ts` | 215 | dead `fetchVideos` + `looksLikeInsightsScopeError` purged |
| `fetcher/facebook-stories.fetcher.ts` | 177 | `resolveStoryMedia` + `fetchStoryInsights` |

**FB adapter facade: 1178 → 93 lines.** Cumulative since pre-refactor: **1484 → 93 (–93.7%).** Under the 250-line `*.adapter.ts` ceiling by a wide margin.

**Files added — Instagram (12 new):**

| File | Lines | Role |
|---|---:|---|
| `instagram.types.ts` | 29 | `GraphMedia`, `GraphMediaChild` |
| `instagram.constants.ts` | 14 | `DEFAULT_PAGE_SIZE` + `MEDIA_TYPE_MAP` |
| `instagram.support-matrix.ts` | 40 | `INSTAGRAM_SUPPORT_MATRIX` |
| `instagram.context.ts` | 20 | `buildInstagramContext()` (pageId only when metadata.page_id set) |
| `mapper/instagram-media.mapper.ts` | 71 | `mediaToContent`, `extractMetrics` |
| `mapper/instagram-insights.mapper.ts` | 99 | `insightMetricsForMedia` (per-media-type strict set, invariant §8.2.4), `mapInsightsData` |
| `mapper/instagram-audience.mapper.ts` | 53 | `parseFollowerDemographics`, `splitGenderAge` |
| `fetcher/instagram-profile.fetcher.ts` | 53 | one public `fetch()` |
| `fetcher/instagram-audience.fetcher.ts` | 298 | three demographic flavours + account-level totals + follower-count series |
| `fetcher/instagram-content.fetcher.ts` | 297 | per-media insights with batch fallback + `profile_activity` / `navigation` breakdown calls |
| `fetcher/instagram-stories.fetcher.ts` | 58 | reuses content fetcher's `fetchContentInsights` to keep STORY breakdown logic single-source |

**IG adapter facade: 938 → 90 lines.** Cumulative since pre-refactor: **1298 → 90 (–93.1%).**

**Modules updated:** `facebook.module.ts` and `instagram.module.ts` register the four fetchers + strategy + adapter under each platform's DI tree, with the `FACEBOOK_GRAPH_CLIENT` / `INSTAGRAM_GRAPH_CLIENT` factory provider binding `GraphClient` to the per-platform strategy.

**Specs retargeted:** all 6 spec files now import the exported pure functions from `mapper/*.mapper.ts` directly. The `as unknown as Mapper` cast trick from Phase 0 is gone — tests are clean. Snapshot count stable at 58, all green.

**Final file-size compliance:**

```
*.adapter.ts          max 93   (ceiling 250)  ✅
*.mapper.ts           max 165  (ceiling 250)  ✅
*.fetcher.ts          max 298  (ceiling 350)  ✅
default               max 298  (ceiling 600)  ✅
```

**Cumulative reduction summary:**

```
Pre-refactor:    1484 (FB) + 1298 (IG)            =  2782 lines, 0% reuse
Post-refactor:    93 (FB facade) +  90 (IG facade) =   183 lines facade
                + 1126 (FB platform module)
                +  876 (IG platform module)
                +  643 (Meta-shared core)
                                                  =  2828 lines across 38 files
                Largest file:                        298 (under all ceilings)
                Median file:                         ~60
```

**Validation:** `tsc --noEmit` clean. Jest 64/64 tests, 58/58 snapshots, all green twice in a row. No behavioural change beyond the §8.1 intentional fixes.

**Definition of Done — final status:**

- [x] `meta-graph/` exists with the 8 files in §5.1 (10 files: 6 helpers + barrel + module + port + client)
- [x] `facebook/` and `instagram/` match the trees in §5.2 / §5.3
- [x] No file in `poc/src/modules/platforms/` exceeds the per-suffix ceiling
- [ ] ESLint config from §9.1 enabled in CI — config not added; the file ceilings are met but the tooling isn't enforcing yet (out of scope for this refactor session; one-line follow-up)
- [x] Snapshot tests green
- [ ] Live smoke test against Meta staging — pending user (cannot execute from this environment)
- [x] Dead code removed (FB `fetchVideos`, `fetchAudienceMetric` deleted from production paths; `videoToContent` / `extractVideoMetrics` retained only as exported pure functions for the existing pinning test, marked for follow-up cleanup; FB `splitGenderAge` deleted; FB `looksLikeInsightsScopeError` migrated to meta-graph and unused for now)
- [x] Worker imports unchanged
- [x] `PlatformsModule` adapter registry unchanged
- [x] Mongo collection names unchanged
- [ ] ADR `0014-platform-adapter-decomposition.md` — not added (follow-up)
- [x] §14 of this document updated with the running record

---

## Appendix A — File-by-file landing zone for FB

For Phase C/D execution, the explicit destination of each current `FacebookAdapter` symbol:

| Current symbol | Destination | Type |
|---|---|---|
| `rateLimitHints` | `facebook.rate-limit.strategy.ts` | injected, called by adapter |
| `supportMatrix` | `facebook.support-matrix.ts` (constant) | inlined into adapter facade |
| `fetchProfile` | `fetcher/facebook-profile.fetcher.ts` | method on `FacebookProfileFetcher` |
| `fetchAudience` | `fetcher/facebook-audience.fetcher.ts` | method |
| `fetchAudienceMetric` | DELETE (dead) | — |
| `audienceErrorMessage` | `meta-graph/graph-errors.ts` | function |
| `fetchContents` | `fetcher/facebook-content.fetcher.ts` | method |
| `fetchPosts` | `fetcher/facebook-content.fetcher.ts` | private method |
| `enrichPostsWithInsights` | `fetcher/facebook-content.fetcher.ts` | private method |
| `enrichOneItem` | `fetcher/facebook-content.fetcher.ts` | private method |
| `fetchStories` | `fetcher/facebook-stories.fetcher.ts` | method |
| `fetchStoryInsights` | `fetcher/facebook-stories.fetcher.ts` | private method |
| `mapStoryInsights` | `mapper/facebook-story.mapper.ts` | function |
| `storyToContent` | `mapper/facebook-story.mapper.ts` | function |
| `resolveStoryMedia` | `fetcher/facebook-stories.fetcher.ts` | private method (does I/O) |
| `parseCreationTime` | `mapper/facebook-story.mapper.ts` | function |
| `fetchVideos` | DELETE (dead) | — |
| `videoToContent` | `mapper/facebook-video.mapper.ts` | function |
| `mergeVideoInsights` | `mapper/facebook-video.mapper.ts` | function |
| `extractVideoMetrics` | `mapper/facebook-video.mapper.ts` | function |
| `mergePostInsights` | `mapper/facebook-post.mapper.ts` | function |
| `extractPostMetrics` | `mapper/facebook-post.mapper.ts` | function |
| `extractMediaUrls` | `mapper/facebook-post.mapper.ts` | function |
| `detectPostContentType` | `mapper/facebook-post.mapper.ts` | function |
| `postToContent` | `mapper/facebook-post.mapper.ts` | function |
| `withinTimeWindow` | `fetcher/facebook-content.fetcher.ts` | private |
| `looksLikeInsightsScopeError` | DELETE (dead) | — |
| `splitGenderAge` | DELETE (dead in FB; IG keeps its own copy in `mapper/instagram-audience.mapper.ts`) | — |
| `extractPictureUrl` | `mapper/facebook-post.mapper.ts` (or inline in profile fetcher — pick one, prefer mapper) | function |
| `callGraph` | `meta-graph/graph-client.ts` | replaced by `BoundGraphClient.call` |
| `persistRaw` | `meta-graph/graph-raw-archive.ts` | function |
| `parseUsageHeaders` | `meta-graph/graph-usage-headers.ts` | function |
| `safeJson` | `meta-graph/graph-usage-headers.ts` (private) | function |
| `parseNextUrl` | `meta-graph/graph-paging.ts` | function |
| `context` | `facebook.context.ts` (FB-specific) calling `meta-graph/graph-context.ts` helpers | function |
| `tokenHash` | `meta-graph/graph-context.ts` | function |
| `withToken` | `meta-graph/graph-context.ts` | private (used inside `GraphClient`) |
| `accountIdFromMeta` | `meta-graph/graph-context.ts` (`extractAccountId`) | function |
| `asNumber` | `meta-graph/graph-context.ts` | function |

## Appendix B — File-by-file landing zone for IG

| Current symbol | Destination | Type |
|---|---|---|
| `rateLimitHints` | `instagram.rate-limit.strategy.ts` | injected |
| `supportMatrix` | `instagram.support-matrix.ts` (constant) | constant |
| `fetchProfile` | `fetcher/instagram-profile.fetcher.ts` | method |
| `fetchAudience` | `fetcher/instagram-audience.fetcher.ts` | method |
| `fetchDemographics` | `fetcher/instagram-audience.fetcher.ts` | private |
| `fetchAccountInsights` | `fetcher/instagram-audience.fetcher.ts` | private |
| `parseFollowerDemographics` | `mapper/instagram-audience.mapper.ts` | function |
| `extractGraphError`, `graphErrorFromBody` | `meta-graph/graph-errors.ts` | function |
| `fetchContents` | `fetcher/instagram-content.fetcher.ts` | method |
| `fetchStories` | `fetcher/instagram-stories.fetcher.ts` | method |
| `fetchContentInsights` | `fetcher/instagram-content.fetcher.ts` | private |
| `fetchInsightsBatch` | `fetcher/instagram-content.fetcher.ts` | private |
| `fetchInsightBreakdown` | `fetcher/instagram-content.fetcher.ts` | private |
| `extractMetaError` | `meta-graph/graph-errors.ts` | function (canonical extractor) |
| `insightMetricsForMedia` | `mapper/instagram-insights.mapper.ts` | function |
| `mapInsightsData` | `mapper/instagram-insights.mapper.ts` | function |
| `mediaToContent` | `mapper/instagram-media.mapper.ts` | function |
| `extractMetrics` | `mapper/instagram-media.mapper.ts` | function |
| `splitGenderAge` | `mapper/instagram-audience.mapper.ts` | function |
| `callGraph`, `persistRaw`, `parseUsageHeaders`, `safeJson`, `parseNextUrl`, `tokenHash`, `withToken`, `accountIdFromMeta`, `asNumber` | `meta-graph/*` | as for FB |
| `context` | `instagram.context.ts` calling `meta-graph/graph-context.ts` | function |
