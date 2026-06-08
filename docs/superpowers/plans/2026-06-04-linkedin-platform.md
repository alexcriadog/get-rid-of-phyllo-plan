# LinkedIn Platform (Member + Organizations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `linkedin` as a first-class platform: OAuth connect (member token), member identity + follower/post analytics, and full organization (company page) accounts with posts + share statistics.

**Architecture:** Follows the Twitch template exactly: a `PlatformDef` in connect-tool drives OAuth; a shared `linkedin-api` HTTP client (rate-bucket + raw-archive + metrics chokepoint) feeds a `LinkedInAdapter` implementing the `PlatformAdapter` port. One LinkedIn OAuth produces 1 member account + N organization accounts (same token, distinguished by `metadata.kind`). Token refresh handled both ways: programmatic refresh when LinkedIn returns a `refresh_token`, `needs_reauth` at expiry otherwise.

**Tech Stack:** NestJS (poc), Next.js App Router (connect-tool), axios, Prisma/MySQL, Mongo raw archive, Redis rate buckets, Zod, Jest (ts-jest).

---

## Research summary (constraints that shaped this plan)

| Capability | Endpoint | Status |
|---|---|---|
| OAuth 3-legged | `https://www.linkedin.com/oauth/v2/authorization` + `/accessToken` | 60-day token (5184000s). `refresh_token` (365d) ONLY if LinkedIn enabled programmatic refresh for the app — detect at exchange time. |
| Member identity | `GET /v2/me` (`r_basicprofile`) | UNVERSIONED v2 surface. No `LinkedIn-Version` header. Person `id` is app-scoped. |
| Connections count | `GET /v2/connections/urn:li:person:{id}` (`r_1st_connections_size`) | URN literally in path. Returns `{firstDegreeSize}`. |
| Member follower count | `GET /rest/memberFollowersCount?q=me` / `q=dateRange` (`r_member_profileAnalytics`) | Versioned REST. Lifetime + daily. |
| Member post analytics | `GET /rest/memberCreatorPostAnalytics?q=me` (`r_member_postAnalytics`) | ONE metric per call (`queryType`), `aggregation=TOTAL|DAILY`. 202605: `metricType` is a plain string. |
| **Member posts list** | `GET /rest/posts?q=author` (person) | ⛔ **BLOCKED** — needs `r_member_social` (closed permission). Member accounts return `[]` from `fetchContents`; aggregates land in the `audience` product. |
| Org discovery | `GET /rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED` (`rw_organization_admin`) | Versioned REST. |
| Org posts | `GET /rest/posts?author=urn%3Ali%3Aorganization%3A{id}&q=author` (`r_organization_social`) | Offset paging `start`/`count` (max 100). Needs `X-RestLi-Method: FINDER`. |
| Org share stats | `GET /rest/organizationalEntityShareStatistics?q=organizationalEntity&...&shares=List(...)` | `List(...)` commas must NOT be URL-encoded → build query manually. |
| Org follower count | `GET /rest/networkSizes/{encodedOrgUrn}?edgeType=COMPANY_FOLLOWED_BY_MEMBER` | Returns `{firstDegreeSize}`. |
| Org follower gains | `GET /rest/organizationalEntityFollowerStatistics?q=organizationalEntity&timeIntervals=(...)` | Daily organic+paid gains. |

**Versioned REST headers (every `/rest/` call):** `LinkedIn-Version: 202605`, `X-Restli-Protocol-Version: 2.0.0`. Never send `LinkedIn-Version` to `/v2/`.
**Rate limits:** dev tier ≈ 500 calls/app/day + 100 calls/member/day, reset midnight UTC, no rate headers → conservative cadences + token-bucket approximation.
**Scopes:** space-separated in the authorize URL.
**Redirect URI:** exact match against the portal Auth tab (user has registered them).

---

## File structure

**Create (poc):**
```
poc/src/modules/platforms/shared/linkedin-api/
├── index.ts
├── linkedin-api.module.ts
├── linkedin-client.ts
├── linkedin-errors.ts
├── linkedin-restli.ts            ← query-string helpers (dateRange, List, URN enc)
├── linkedin-token-refresh.service.ts
├── linkedin-types.ts
└── __tests__/
    ├── linkedin-errors.spec.ts
    └── linkedin-restli.spec.ts
poc/src/modules/platforms/linkedin/
├── linkedin.adapter.ts
├── linkedin.constants.ts
├── linkedin.context.ts
├── linkedin.module.ts
├── linkedin.rate-limit.strategy.ts
├── linkedin.support-matrix.ts
├── linkedin.tokens.ts
├── fetcher/
│   ├── linkedin-audience.fetcher.ts
│   ├── linkedin-content.fetcher.ts
│   └── linkedin-profile.fetcher.ts
├── mapper/
│   ├── linkedin-analytics.mapper.ts
│   ├── linkedin-post.mapper.ts
│   └── linkedin-profile.mapper.ts
└── __tests__/
    ├── linkedin-analytics.mapper.spec.ts
    ├── linkedin-post.mapper.spec.ts
    └── linkedin-profile.mapper.spec.ts
```

**Modify (poc):** `products.catalog.ts`, `platform-types.ts` (+`connectionsCount`), `platforms.module.ts`, `token-refresh.cron.service.ts`, `token-refresh.module.ts`, `admin.controller.ts` (seed enum), `prisma/seed.ts`, `.env`, `.env.example`.

**Modify (connect-tool):** `lib/platforms.ts`, `lib/seed-client.ts`, `lib/session.ts`, `app/api/oauth/[...slug]/route.ts`, `app/api/seed-confirm/route.ts`, `app/connect/shell-machine.ts`, `app/connect/ConnectShell.tsx`, `app/connect/PlatformIcon.tsx`, `app/page.tsx`, `components/PlatformTile.tsx`, `.env`, `.env.example`.

**Account model:** platform `'linkedin'` for both kinds. `metadata.kind = 'member' | 'organization'`. Member: `canonical_user_id` = person id, `metadata.person_urn`. Org: `canonical_user_id` = org numeric id, `metadata.organization_urn`, `metadata.person_urn` (owner), `metadata.role`. All accounts share the member's access/refresh token.

**Products:**
- `identity` (required): member → /v2/me + connections + follower count; org → org lookup + networkSizes.
- `audience` (default): member → follower daily series + post-analytics aggregates into `accountInsights`; org → follower gains series.
- `engagement_new` (default): org → posts + share stats. Member → `[]` (documented gap).

---

### Task 1: POC catalog + canonical types plumbing

**Files:**
- Modify: `poc/src/modules/accounts/products.catalog.ts`
- Modify: `poc/src/modules/platforms/shared/platform-types.ts`
- Modify: `poc/src/modules/admin/admin.controller.ts` (ConnectSeedSchema only)
- Modify: `poc/prisma/seed.ts`

- [ ] **Step 1.1: Check the existing catalog spec for platform enumerations**

Run: `cd poc && npx jest products.catalog --no-coverage`
Expected: PASS today. Read `poc/src/modules/accounts/__tests__/products.catalog.spec.ts` — if it asserts exact platform lists/counts, you will extend those assertions in step 1.3.

- [ ] **Step 1.2: Add `linkedin` to the catalog**

In `products.catalog.ts`:

```ts
export type Platform =
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'threads'
  | 'youtube'
  | 'twitch'
  | 'linkedin';
```

Add `'linkedin'` to `PLATFORM_IDS` (after `'twitch'`).

Add to `PLATFORM_CATALOG` (after the `twitch` entry):

```ts
  linkedin: [
    {
      id: 'identity',
      label: 'Profile',
      hint: 'Member profile, connections + follower count; org page metadata',
      required: true,
      default: true,
      // r_basicprofile → /v2/me; r_1st_connections_size → /v2/connections;
      // rw_organization_admin → organizationAcls discovery + /rest/organizations
      // (org accounts are seeded from the same OAuth, so identity must carry it).
      scopes: ['r_basicprofile', 'r_1st_connections_size', 'rw_organization_admin'],
    },
    {
      id: 'audience',
      label: 'Followers + analytics',
      hint: 'Member follower series + aggregate post analytics; org follower gains',
      default: true,
      // r_member_profileAnalytics → memberFollowersCount; r_member_postAnalytics
      // → memberCreatorPostAnalytics; r_organization_followers → org follower stats.
      scopes: [
        'r_member_profileAnalytics',
        'r_member_postAnalytics',
        'r_organization_followers',
      ],
    },
    {
      id: 'engagement_new',
      label: 'Org posts + metrics',
      hint: 'Organization posts with share statistics. Member posts are not exposed by LinkedIn (r_member_social is a closed permission).',
      default: true,
      scopes: ['r_organization_social'],
    },
  ],
```

- [ ] **Step 1.3: Run the catalog spec; extend enumerating assertions if present**

Run: `cd poc && npx jest products.catalog --no-coverage`
Expected: PASS (after extending any exact-list assertions with `linkedin`).

- [ ] **Step 1.4: Add `connectionsCount` to ProfileData**

In `platform-types.ts`, after the `subscribersByTier` field (before `fetchedAt`):

```ts
  /**
   * LinkedIn 1st-degree connections (bidirectional, distinct from followers).
   * Other platforms leave this null.
   */
  connectionsCount?: number | null;
```

- [ ] **Step 1.5: Allow `linkedin` in the seed schema**

In `admin.controller.ts`, `ConnectSeedSchema`:

```ts
    platform: z.enum([
      'instagram',
      'facebook',
      'tiktok',
      'threads',
      'youtube',
      'twitch',
      'linkedin',
    ]),
```

(Do NOT touch `ConnectDiscoverSchema` — the discover handler has no LinkedIn implementation; that's a follow-up.)

- [ ] **Step 1.6: Seed cadences + backfill map**

In `prisma/seed.ts`, append to `CADENCE_DEFAULTS`:

```ts
  // LinkedIn — dev tier is ~500 calls/app/day + 100/member/day (midnight UTC
  // reset), so cadences are deliberately slow. identity ≈3 calls, audience
  // ≈11 calls (one metric per memberCreatorPostAnalytics call), org
  // engagement ≈3 calls per sync.
  { platform: 'linkedin', product: 'identity', defaultIntervalSeconds: 21600 },
  { platform: 'linkedin', product: 'audience', defaultIntervalSeconds: 86400 },
  { platform: 'linkedin', product: 'engagement_new', defaultIntervalSeconds: 21600 },
```

And to `PRODUCTS_BY_PLATFORM_FOR_BACKFILL`:

```ts
  linkedin: ['identity', 'audience', 'engagement_new'],
```

- [ ] **Step 1.7: Type-check + commit**

Run: `cd poc && npx tsc --noEmit`
Expected: clean.

```bash
git add poc/src/modules/accounts/products.catalog.ts poc/src/modules/platforms/shared/platform-types.ts poc/src/modules/admin/admin.controller.ts poc/prisma/seed.ts poc/src/modules/accounts/__tests__/products.catalog.spec.ts
git commit -m "feat(poc): register linkedin platform — catalog, seed schema, cadences"
```

---

### Task 2: Restli helpers + error mapper (TDD)

**Files:**
- Create: `poc/src/modules/platforms/shared/linkedin-api/linkedin-restli.ts`
- Create: `poc/src/modules/platforms/shared/linkedin-api/linkedin-errors.ts`
- Test: `poc/src/modules/platforms/shared/linkedin-api/__tests__/linkedin-restli.spec.ts`
- Test: `poc/src/modules/platforms/shared/linkedin-api/__tests__/linkedin-errors.spec.ts`

- [ ] **Step 2.1: Write failing tests for the Restli helpers**

`__tests__/linkedin-restli.spec.ts`:

```ts
import {
  encodeUrn,
  restliDate,
  restliDateRange,
  restliList,
  restliTimeIntervals,
} from '../linkedin-restli';

describe('linkedin-restli', () => {
  test('encodeUrn percent-encodes colons', () => {
    expect(encodeUrn('urn:li:organization:123')).toBe(
      'urn%3Ali%3Aorganization%3A123',
    );
  });

  test('restliDate renders (year:Y,month:M,day:D)', () => {
    expect(restliDate(new Date(Date.UTC(2026, 4, 4)))).toBe(
      '(year:2026,month:5,day:4)',
    );
  });

  test('restliDateRange composes start+end', () => {
    const start = new Date(Date.UTC(2026, 4, 4));
    const end = new Date(Date.UTC(2026, 5, 4));
    expect(restliDateRange(start, end)).toBe(
      '(start:(year:2026,month:5,day:4),end:(year:2026,month:6,day:4))',
    );
  });

  test('restliList keeps commas raw but encodes URNs', () => {
    expect(restliList(['urn:li:share:1', 'urn:li:share:2'])).toBe(
      'List(urn%3Ali%3Ashare%3A1,urn%3Ali%3Ashare%3A2)',
    );
  });

  test('restliTimeIntervals renders epoch-ms day granularity', () => {
    expect(restliTimeIntervals(1000, 2000)).toBe(
      '(timeRange:(start:1000,end:2000),timeGranularityType:DAY)',
    );
  });
});
```

Run: `cd poc && npx jest linkedin-restli --no-coverage`
Expected: FAIL — module not found.

- [ ] **Step 2.2: Implement `linkedin-restli.ts`**

```ts
// Restli 2.0 query-value builders. LinkedIn's versioned REST API uses
// structured query params — (key:value) records, List(...) arrays — whose
// parens/commas/colons MUST stay raw, while URN values inside them must be
// percent-encoded. axios's default serializer would encode everything, so
// the LinkedIn client builds query strings by hand with these helpers.

/** Percent-encode a URN for use inside a path or query value. */
export function encodeUrn(urn: string): string {
  return encodeURIComponent(urn);
}

/** `(year:2026,month:5,day:4)` — UTC calendar date. */
export function restliDate(d: Date): string {
  return `(year:${d.getUTCFullYear()},month:${d.getUTCMonth() + 1},day:${d.getUTCDate()})`;
}

/** `(start:(...),end:(...))` — start inclusive, end exclusive (per docs). */
export function restliDateRange(start: Date, end: Date): string {
  return `(start:${restliDate(start)},end:${restliDate(end)})`;
}

/** `List(a,b,c)` with each item URN-encoded but commas raw. */
export function restliList(urns: ReadonlyArray<string>): string {
  return `List(${urns.map(encodeUrn).join(',')})`;
}

/** `(timeRange:(start:ms,end:ms),timeGranularityType:DAY)` */
export function restliTimeIntervals(startMs: number, endMs: number): string {
  return `(timeRange:(start:${startMs},end:${endMs}),timeGranularityType:DAY)`;
}
```

- [ ] **Step 2.3: Run the restli tests**

Run: `cd poc && npx jest linkedin-restli --no-coverage`
Expected: PASS (5 tests).

- [ ] **Step 2.4: Write failing tests for the error mapper**

`__tests__/linkedin-errors.spec.ts`:

```ts
import {
  RateLimitedError,
  TokenRevokedError,
  AdapterFetchError,
} from '../../platform-adapter.port';
import { mapLinkedInError } from '../linkedin-errors';

function axiosLike(status: number, data: unknown) {
  return { response: { status, data }, message: `HTTP ${status}` };
}

describe('mapLinkedInError', () => {
  test('401 → TokenRevokedError', () => {
    const err = mapLinkedInError(
      'linkedin',
      '/v2/me',
      axiosLike(401, { status: 401, message: 'Invalid access token', serviceErrorCode: 65600 }),
      'bucket',
    );
    expect(err).toBeInstanceOf(TokenRevokedError);
  });

  test('REVOKED_ACCESS_TOKEN serviceErrorCode → TokenRevokedError even on 400', () => {
    const err = mapLinkedInError(
      'linkedin',
      '/rest/posts',
      axiosLike(400, { status: 400, message: 'The token used in the request has been revoked', serviceErrorCode: 65601 }),
      'bucket',
    );
    expect(err).toBeInstanceOf(TokenRevokedError);
  });

  test('429 → RateLimitedError with positive reset', () => {
    const err = mapLinkedInError(
      'linkedin',
      '/rest/posts',
      axiosLike(429, { status: 429, message: 'Resource level throttle limit reached' }),
      'bucket',
    );
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).resetInMs).toBeGreaterThan(0);
  });

  test('403 ACCESS_DENIED → AdapterFetchError (NOT revoked)', () => {
    const err = mapLinkedInError(
      'linkedin',
      '/rest/posts',
      axiosLike(403, { status: 403, message: 'Not enough permissions to access this resource', serviceErrorCode: 100 }),
      'bucket',
    );
    expect(err).toBeInstanceOf(AdapterFetchError);
  });
});
```

Run: `cd poc && npx jest linkedin-errors --no-coverage`
Expected: FAIL — module not found.

- [ ] **Step 2.5: Implement `linkedin-errors.ts`**

```ts
// Map LinkedIn REST/v2 errors to the canonical adapter errors:
//   - TokenRevokedError → account.status = 'needs_reauth' (no retry)
//   - RateLimitedError  → backoff (LinkedIn quotas reset at midnight UTC;
//     no Retry-After / rate headers are documented, so we back off until
//     the next UTC midnight, capped to keep the worker responsive)
//   - AdapterFetchError → bump failure_count, retry per cadence
//
// LinkedIn error body: { status, message, serviceErrorCode }.
// 401 = invalid/expired token. 65601 = REVOKED_ACCESS_TOKEN (can ride a 400).
// 403 = product/permission mismatch — NOT a dead token; keep it AdapterFetch
// so identity keeps syncing when one product's permission is missing.

import {
  AdapterFetchError,
  RateLimitedError,
  TokenRevokedError,
} from '../platform-adapter.port';

interface LinkedInErrorBody {
  status?: number;
  message?: string;
  serviceErrorCode?: number;
}

interface AxiosLikeError {
  response?: { status?: number; data?: unknown };
  message?: string;
}

const REVOKED_SERVICE_CODES = new Set([65600, 65601, 65602]);
const MAX_429_BACKOFF_MS = 6 * 60 * 60_000; // 6h cap — daily quota, slow cadences

export function mapLinkedInError(
  platform: string,
  endpoint: string,
  err: unknown,
  bucketKey: string,
): Error {
  const e = err as AxiosLikeError;
  const status = e?.response?.status;
  const body =
    e?.response?.data && typeof e.response.data === 'object'
      ? (e.response.data as LinkedInErrorBody)
      : undefined;
  const message = body?.message ?? messageOf(err);

  if (
    status === 401 ||
    (body?.serviceErrorCode !== undefined &&
      REVOKED_SERVICE_CODES.has(body.serviceErrorCode))
  ) {
    return new TokenRevokedError(
      platform,
      endpoint,
      `LinkedIn rejected token on ${endpoint}: ${message || 'unauthorized'}`,
    );
  }

  if (status === 429) {
    return new RateLimitedError(
      platform,
      msUntilNextUtcMidnight(),
      bucketKey,
      `LinkedIn throttled ${endpoint}: daily quota resets at midnight UTC`,
    );
  }

  return new AdapterFetchError(platform, endpoint, err, undefined, body);
}

function msUntilNextUtcMidnight(): number {
  const now = new Date();
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  const ms = next - now.getTime();
  return Math.min(Math.max(ms, 60_000), MAX_429_BACKOFF_MS);
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : '';
}
```

- [ ] **Step 2.6: Run error tests + commit**

Run: `cd poc && npx jest linkedin-errors linkedin-restli --no-coverage`
Expected: PASS (9 tests).

```bash
git add poc/src/modules/platforms/shared/linkedin-api/
git commit -m "feat(poc): linkedin restli helpers + error mapper (TDD)"
```

---

### Task 3: LinkedIn API types + client + refresh service + module

**Files:**
- Create: `poc/src/modules/platforms/shared/linkedin-api/linkedin-types.ts`
- Create: `poc/src/modules/platforms/shared/linkedin-api/linkedin-client.ts`
- Create: `poc/src/modules/platforms/shared/linkedin-api/linkedin-token-refresh.service.ts`
- Create: `poc/src/modules/platforms/shared/linkedin-api/linkedin-api.module.ts`
- Create: `poc/src/modules/platforms/shared/linkedin-api/index.ts`

- [ ] **Step 3.1: Write `linkedin-types.ts`**

```ts
// Response shapes for the LinkedIn surfaces we call. Field lists kept to
// what the mappers consume — the full raw payload is archived in Mongo by
// the client anyway.

export interface LinkedInMe {
  id: string;
  localizedFirstName?: string;
  localizedLastName?: string;
  localizedHeadline?: string;
  vanityName?: string;
  profilePicture?: {
    displayImage?: string;
    'displayImage~'?: {
      elements?: Array<{
        identifiers?: Array<{ identifier?: string }>;
      }>;
    };
  };
}

export interface LinkedInConnectionsSize {
  firstDegreeSize?: number;
}

export interface LinkedInDateRange {
  start?: { year: number; month: number; day: number };
  end?: { year: number; month: number; day: number };
}

export interface LinkedInPaging {
  start?: number;
  count?: number;
  total?: number;
  links?: Array<{ rel?: string; href?: string }>;
}

export interface LinkedInCollection<T> {
  elements?: T[];
  paging?: LinkedInPaging;
}

export interface LinkedInMemberFollowersElement {
  memberFollowersCount?: number;
  dateRange?: LinkedInDateRange;
}

/** memberCreatorPostAnalytics — 202605 returns metricType as a STRING.
 * Older versions returned an object; accept both. */
export interface LinkedInMemberAnalyticsElement {
  count?: number;
  metricType?: string | Record<string, unknown>;
  dateRange?: LinkedInDateRange;
  targetEntity?: Record<string, string>;
}

export interface LinkedInOrganizationAcl {
  organization: string; // urn:li:organization:123
  role?: string;
  state?: string;
  roleAssignee?: string;
}

export interface LinkedInOrganization {
  id?: number;
  localizedName?: string;
  vanityName?: string;
  localizedDescription?: string;
  localizedWebsite?: string;
}

export interface LinkedInNetworkSize {
  firstDegreeSize?: number;
}

export interface LinkedInPost {
  id: string; // urn:li:share:... | urn:li:ugcPost:...
  author?: string;
  commentary?: string;
  createdAt?: number;
  publishedAt?: number;
  lastModifiedAt?: number;
  lifecycleState?: string;
  visibility?: string;
  content?: {
    media?: { id?: string; title?: string };
    article?: { source?: string; title?: string; thumbnail?: string };
    multiImage?: { images?: Array<{ id?: string }> };
  };
}

export interface LinkedInTotalShareStatistics {
  impressionCount?: number;
  uniqueImpressionsCount?: number;
  clickCount?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  engagement?: number;
}

export interface LinkedInShareStatsElement {
  share?: string;
  ugcPost?: string;
  organizationalEntity?: string;
  totalShareStatistics?: LinkedInTotalShareStatistics;
}

export interface LinkedInFollowerGainsElement {
  followerGains?: {
    organicFollowerGain?: number;
    paidFollowerGain?: number;
  };
  timeRange?: { start?: number; end?: number };
  organizationalEntity?: string;
}

export interface LinkedInTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}
```

- [ ] **Step 3.2: Write `linkedin-client.ts`**

Mirrors `twitch-client.ts` (bind → BoundClient; acquire → call → observe + persistRaw → mapped errors). Two HTTP surfaces: unversioned `/v2`, versioned `/rest`.

```ts
// LinkedInClient — single chokepoint for both LinkedIn API surfaces:
//   - legacy /v2 (identity, connections): NO LinkedIn-Version header
//   - versioned /rest (posts, analytics, orgs): LinkedIn-Version +
//     X-Restli-Protocol-Version 2.0.0 mandatory
//
// Restli structured query params (dateRange, List, timeIntervals) must keep
// parens/commas raw, so every method builds its query string by hand with
// linkedin-restli helpers and passes a fully-formed path; axios `params` is
// never used here.
//
// Mirrors twitch-client.ts: bind(strategy) → BoundLinkedInClient; each call
// acquires the rate bucket, archives the raw response, observes metrics and
// maps errors to typed adapter exceptions.

import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError, type AxiosInstance } from 'axios';
import { MongoService } from '@shared/database/mongo.service';
import { RateBucketService } from '@shared/redis/rate-bucket.service';
import { MetricsService } from '@shared/metrics/metrics.service';
import {
  PlatformAdapterContext,
  RateLimitedError,
} from '../platform-adapter.port';
import type { RateLimitStrategy } from '../meta-graph/rate-limit-strategy.port';
import { persistRaw } from '../meta-graph/graph-raw-archive';
import { mapLinkedInError } from './linkedin-errors';
import {
  encodeUrn,
  restliDateRange,
  restliList,
  restliTimeIntervals,
} from './linkedin-restli';
import type {
  LinkedInCollection,
  LinkedInConnectionsSize,
  LinkedInFollowerGainsElement,
  LinkedInMe,
  LinkedInMemberAnalyticsElement,
  LinkedInMemberFollowersElement,
  LinkedInNetworkSize,
  LinkedInOrganization,
  LinkedInOrganizationAcl,
  LinkedInPost,
  LinkedInShareStatsElement,
} from './linkedin-types';

const PLATFORM_NAME = 'linkedin';
const API_BASE = 'https://api.linkedin.com';
export const LINKEDIN_API_VERSION = '202605';
const REQUEST_TIMEOUT_MS = 15_000;
const COST_PER_CALL = 1;

export interface LinkedInCallContext {
  accessToken: string;
  context: PlatformAdapterContext;
  accountId?: bigint;
}

export interface GetMemberAnalyticsArgs extends LinkedInCallContext {
  queryType:
    | 'IMPRESSION'
    | 'MEMBERS_REACHED'
    | 'RESHARE'
    | 'REACTION'
    | 'COMMENT';
  aggregation: 'TOTAL' | 'DAILY';
  /** Optional date window; lifetime when omitted. */
  start?: Date;
  end?: Date;
}

export interface GetOrgPostsArgs extends LinkedInCallContext {
  orgUrn: string;
  start?: number;
  count?: number;
}

export interface GetShareStatsArgs extends LinkedInCallContext {
  orgUrn: string;
  /** urn:li:share:* ids — passed via shares=List(...) */
  shareUrns?: string[];
  /** urn:li:ugcPost:* ids — passed via ugcPosts=List(...) */
  ugcPostUrns?: string[];
}

@Injectable()
export class LinkedInClient {
  constructor(
    private readonly rateBucket: RateBucketService,
    private readonly mongo: MongoService,
    private readonly metrics: MetricsService,
  ) {}

  bind(strategy: RateLimitStrategy): BoundLinkedInClient {
    return new BoundLinkedInClient(
      strategy,
      this.rateBucket,
      this.mongo,
      this.metrics,
    );
  }
}

export class BoundLinkedInClient {
  private readonly logger = new Logger(`LinkedInClient[${PLATFORM_NAME}]`);
  private readonly http: AxiosInstance;

  constructor(
    private readonly strategy: RateLimitStrategy,
    private readonly rateBucket: RateBucketService,
    private readonly mongo: MongoService,
    private readonly metrics: MetricsService,
  ) {
    this.http = axios.create({
      baseURL: API_BASE,
      timeout: REQUEST_TIMEOUT_MS,
      // Same OrbStack HTTPS_PROXY hardening as the Twitch client.
      proxy: false,
    });
  }

  // ─── /v2 surface (unversioned) ──────────────────────────────────────────

  async getMe(args: LinkedInCallContext): Promise<LinkedInMe> {
    const projection =
      '(id,localizedFirstName,localizedLastName,localizedHeadline,vanityName,' +
      'profilePicture(displayImage~:playableStreams))';
    return this.get(`/v2/me?projection=${projection}`, args, false);
  }

  async getConnectionsSize(
    args: LinkedInCallContext & { personId: string },
  ): Promise<LinkedInConnectionsSize> {
    // URN sits literally in the path (doc example keeps colons unencoded).
    return this.get(
      `/v2/connections/urn:li:person:${args.personId}`,
      args,
      false,
    );
  }

  // ─── /rest surface (versioned) ──────────────────────────────────────────

  async getMemberFollowersCount(
    args: LinkedInCallContext,
  ): Promise<LinkedInCollection<LinkedInMemberFollowersElement>> {
    return this.get('/rest/memberFollowersCount?q=me', args, true, 'FINDER');
  }

  async getMemberFollowersDaily(
    args: LinkedInCallContext & { start: Date; end: Date },
  ): Promise<LinkedInCollection<LinkedInMemberFollowersElement>> {
    const range = restliDateRange(args.start, args.end);
    return this.get(
      `/rest/memberFollowersCount?q=dateRange&dateRange=${range}`,
      args,
      true,
      'FINDER',
    );
  }

  async getMemberPostAnalytics(
    args: GetMemberAnalyticsArgs,
  ): Promise<LinkedInCollection<LinkedInMemberAnalyticsElement>> {
    let path =
      `/rest/memberCreatorPostAnalytics?q=me` +
      `&queryType=${args.queryType}&aggregation=${args.aggregation}`;
    if (args.start && args.end) {
      path += `&dateRange=${restliDateRange(args.start, args.end)}`;
    }
    return this.get(path, args, true, 'FINDER');
  }

  async getOrganizationAcls(
    args: LinkedInCallContext,
  ): Promise<LinkedInCollection<LinkedInOrganizationAcl>> {
    return this.get(
      '/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=50',
      args,
      true,
      'FINDER',
    );
  }

  async getOrganization(
    args: LinkedInCallContext & { orgId: string },
  ): Promise<LinkedInOrganization> {
    return this.get(`/rest/organizations/${args.orgId}`, args, true);
  }

  async getOrganizationFollowerCount(
    args: LinkedInCallContext & { orgUrn: string },
  ): Promise<LinkedInNetworkSize> {
    return this.get(
      `/rest/networkSizes/${encodeUrn(args.orgUrn)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`,
      args,
      true,
    );
  }

  async getOrganizationFollowerGains(
    args: LinkedInCallContext & { orgUrn: string; startMs: number; endMs: number },
  ): Promise<LinkedInCollection<LinkedInFollowerGainsElement>> {
    const intervals = restliTimeIntervals(args.startMs, args.endMs);
    return this.get(
      `/rest/organizationalEntityFollowerStatistics?q=organizationalEntity` +
        `&organizationalEntity=${encodeUrn(args.orgUrn)}&timeIntervals=${intervals}`,
      args,
      true,
      'FINDER',
    );
  }

  async getOrganizationPosts(
    args: GetOrgPostsArgs,
  ): Promise<LinkedInCollection<LinkedInPost>> {
    const start = args.start ?? 0;
    const count = args.count ?? 50;
    return this.get(
      `/rest/posts?author=${encodeUrn(args.orgUrn)}&q=author` +
        `&count=${count}&start=${start}&sortBy=LAST_MODIFIED`,
      args,
      true,
      'FINDER',
    );
  }

  async getShareStatistics(
    args: GetShareStatsArgs,
  ): Promise<LinkedInCollection<LinkedInShareStatsElement>> {
    let path =
      `/rest/organizationalEntityShareStatistics?q=organizationalEntity` +
      `&organizationalEntity=${encodeUrn(args.orgUrn)}`;
    if (args.shareUrns?.length) path += `&shares=${restliList(args.shareUrns)}`;
    if (args.ugcPostUrns?.length)
      path += `&ugcPosts=${restliList(args.ugcPostUrns)}`;
    return this.get(path, args, true, 'FINDER');
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private async get<T>(
    pathWithQuery: string,
    args: LinkedInCallContext,
    versioned: boolean,
    restliMethod?: 'FINDER',
  ): Promise<T> {
    const endpoint = pathWithQuery.split('?')[0];
    const acquired = await this.acquire(args.context, COST_PER_CALL);
    const started = Date.now();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${args.accessToken}`,
      'X-Restli-Protocol-Version': '2.0.0',
    };
    if (versioned) headers['LinkedIn-Version'] = LINKEDIN_API_VERSION;
    if (restliMethod) headers['X-RestLi-Method'] = restliMethod;
    try {
      const res = await this.http.get<T>(pathWithQuery, { headers });
      await this.observeAndPersist(
        endpoint,
        args.accountId,
        acquired.bucketKey,
        acquired.tokensRemaining,
        res.status,
        Date.now() - started,
        res.data,
      );
      return res.data;
    } catch (err: unknown) {
      const ax = err as AxiosError;
      const status = ax.response?.status ?? 0;
      await this.observeAndPersist(
        endpoint,
        args.accountId,
        acquired.bucketKey,
        acquired.tokensRemaining,
        status,
        Date.now() - started,
        ax.response?.data ?? { error: messageOf(err) },
      );
      throw mapLinkedInError(PLATFORM_NAME, endpoint, err, acquired.bucketKey);
    }
  }

  private async acquire(
    context: PlatformAdapterContext,
    cost: number,
  ): Promise<{ bucketKey: string; tokensRemaining: number }> {
    const hints = this.strategy.hints(context).map((h) => ({
      ...h,
      costPerCall: cost,
    }));
    const acquireCtx: Record<string, string> = {};
    if (context.tokenHash) acquireCtx['hash'] = context.tokenHash;
    if (context.channelId) acquireCtx['channel_id'] = context.channelId;
    const acquired = await this.rateBucket.acquire(hints, acquireCtx);
    if (!acquired.allowed) {
      this.metrics.incr('acquire_total', {
        scope: acquired.bucketKey,
        result: 'denied',
      });
      throw new RateLimitedError(
        PLATFORM_NAME,
        acquired.resetInMs,
        acquired.bucketKey,
      );
    }
    this.metrics.incr('acquire_total', {
      scope: acquired.bucketKey,
      result: 'allowed',
    });
    return {
      bucketKey: acquired.bucketKey,
      tokensRemaining: acquired.tokensRemaining,
    };
  }

  private async observeAndPersist(
    endpoint: string,
    accountId: bigint | undefined,
    bucketKey: string,
    bucketBefore: number,
    status: number,
    durationMs: number,
    body: unknown,
  ): Promise<void> {
    const bucketAfterState = await this.rateBucket.getState(bucketKey);
    const bucketAfter = bucketAfterState?.tokens ?? null;
    this.metrics.observeApiCall({
      platform: PLATFORM_NAME,
      endpoint,
      method: 'GET',
      status,
      durationMs,
      bucketBefore,
      bucketAfter,
      usageHeader: null,
      accountId: accountId ?? null,
      rateBucketKey: bucketKey,
    });
    await persistRaw(
      this.mongo,
      PLATFORM_NAME,
      body,
      endpoint,
      accountId ?? null,
      status,
    );
  }
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : JSON.stringify(err);
}
```

- [ ] **Step 3.3: Write `linkedin-token-refresh.service.ts`**

```ts
// LinkedIn OAuth token refresh.
//
// LinkedIn access tokens last 60 days (5184000s). Programmatic refresh is
// only available when LinkedIn has enabled it for the app — detected at
// OAuth exchange time by the presence of `refresh_token` in the response
// (365-day TTL that does NOT reset on use). When the account row has no
// refresh token, this service is never called; the cron flags needs_reauth
// at expiry instead (Meta-style).
//
// Refresh endpoint: POST https://www.linkedin.com/oauth/v2/accessToken
//   Form body: grant_type=refresh_token, refresh_token=..., client_id=...,
//              client_secret=...

import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@shared/database/prisma.service';
import { AesLocalService } from '@shared/crypto/aes-local.service';
import { TokenLifecycleEmitter } from '@modules/outbound-webhooks/token-lifecycle-emitter.service';
import type { LinkedInTokenResponse } from './linkedin-types';

const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
/** 60-day tokens: a 7-day lead gives a failed refresh days of hourly retries. */
const REFRESH_LEAD_TIME_MS = 7 * 24 * 60 * 60_000;
const REFRESH_TIMEOUT_MS = 15_000;

@Injectable()
export class LinkedInTokenRefreshService {
  private readonly logger = new Logger(LinkedInTokenRefreshService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aes: AesLocalService,
    private readonly config: ConfigService,
    private readonly lifecycle: TokenLifecycleEmitter,
  ) {}

  async ensureFresh(
    accountId: bigint,
    currentAccessToken: string,
  ): Promise<string> {
    const row = await this.prisma.oAuthToken.findUnique({
      where: { accountId },
      select: { expiresAt: true, refreshTokenCiphertext: true },
    });
    if (!row || !row.expiresAt || !row.refreshTokenCiphertext) {
      return currentAccessToken;
    }
    if (row.expiresAt.getTime() - Date.now() > REFRESH_LEAD_TIME_MS) {
      return currentAccessToken;
    }
    try {
      const refreshToken = this.aes.decrypt(row.refreshTokenCiphertext);
      return await this.refresh(accountId, refreshToken);
    } catch (err) {
      this.logger.warn(
        `ensureFresh fell back to current token for account ${accountId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return currentAccessToken;
    }
  }

  async refresh(accountId: bigint, refreshToken: string): Promise<string> {
    const clientId = this.config.get<string>('LINKEDIN_CLIENT_ID');
    const clientSecret = this.config.get<string>('LINKEDIN_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new Error(
        'LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET must be set to refresh LinkedIn tokens.',
      );
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const res = await axios.post<LinkedInTokenResponse>(
      LINKEDIN_TOKEN_URL,
      params,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: REFRESH_TIMEOUT_MS,
        validateStatus: () => true,
        proxy: false,
      },
    );
    const body = res.data ?? {};
    if (res.status < 200 || res.status >= 300 || !body.access_token) {
      const errMsg =
        body.error_description ?? body.error ?? `HTTP ${res.status}`;
      this.logger.error(
        `LinkedIn refresh failed for account ${accountId.toString()}: ${errMsg}`,
      );
      await this.lifecycle.tokenRefreshFailed(accountId, { reason: errMsg });
      throw new Error(`LinkedIn token refresh failed: ${errMsg}`);
    }

    const expiresInS = typeof body.expires_in === 'number' ? body.expires_in : 0;
    const expiresAt =
      expiresInS > 0 ? new Date(Date.now() + expiresInS * 1000) : null;
    const newAccessCipher = this.aes.encrypt(body.access_token);
    // LinkedIn MAY return a new refresh_token; persist when present. The
    // refresh-token TTL does not reset — after ~365 days the member must
    // re-authorize via the full OAuth flow.
    const newRefreshCipher = body.refresh_token
      ? this.aes.encrypt(body.refresh_token)
      : undefined;
    const scopes = body.scope ? body.scope.split(/[ ,]/).filter(Boolean) : undefined;

    await this.prisma.oAuthToken.update({
      where: { accountId },
      data: {
        accessTokenCiphertext: newAccessCipher,
        ...(newRefreshCipher ? { refreshTokenCiphertext: newRefreshCipher } : {}),
        expiresAt,
        lastRefreshedAt: new Date(),
        ...(scopes ? { scopes } : {}),
      },
    });
    this.logger.log(
      `LinkedIn token refreshed for account ${accountId.toString()}; expires_in=${expiresInS}s`,
    );
    await this.lifecycle.tokenRefreshed(accountId, { expiresAt });
    return body.access_token;
  }
}
```

- [ ] **Step 3.4: Write `linkedin-api.module.ts` + `index.ts`**

`linkedin-api.module.ts` (mirror `twitch-api.module.ts` — read it first; if it differs from this shape, match the existing file):

```ts
import { Module } from '@nestjs/common';
import { LinkedInClient } from './linkedin-client';
import { LinkedInTokenRefreshService } from './linkedin-token-refresh.service';

@Module({
  providers: [LinkedInClient, LinkedInTokenRefreshService],
  exports: [LinkedInClient, LinkedInTokenRefreshService],
})
export class LinkedInApiModule {}
```

`index.ts`:

```ts
export * from './linkedin-client';
export * from './linkedin-errors';
export * from './linkedin-restli';
export * from './linkedin-token-refresh.service';
export * from './linkedin-types';
export { LinkedInApiModule } from './linkedin-api.module';
```

- [ ] **Step 3.5: Type-check + commit**

Run: `cd poc && npx tsc --noEmit`
Expected: clean.

```bash
git add poc/src/modules/platforms/shared/linkedin-api/
git commit -m "feat(poc): linkedin shared api client + token refresh service"
```

---

### Task 4: Mappers (TDD)

**Files:**
- Create: `poc/src/modules/platforms/linkedin/mapper/linkedin-profile.mapper.ts`
- Create: `poc/src/modules/platforms/linkedin/mapper/linkedin-post.mapper.ts`
- Create: `poc/src/modules/platforms/linkedin/mapper/linkedin-analytics.mapper.ts`
- Test: `poc/src/modules/platforms/linkedin/__tests__/linkedin-profile.mapper.spec.ts`
- Test: `poc/src/modules/platforms/linkedin/__tests__/linkedin-post.mapper.spec.ts`
- Test: `poc/src/modules/platforms/linkedin/__tests__/linkedin-analytics.mapper.spec.ts`

- [ ] **Step 4.1: Write failing profile mapper tests**

`__tests__/linkedin-profile.mapper.spec.ts`:

```ts
import {
  linkedInMemberToProfile,
  linkedInOrganizationToProfile,
} from '../mapper/linkedin-profile.mapper';

describe('linkedInMemberToProfile', () => {
  test('maps the full member shape', () => {
    const profile = linkedInMemberToProfile({
      me: {
        id: 'yrZCpj2Z12',
        localizedFirstName: 'Bob',
        localizedLastName: 'Smith',
        localizedHeadline: 'API Enthusiast',
        vanityName: 'bsmith',
        profilePicture: {
          'displayImage~': {
            elements: [
              { identifiers: [{ identifier: 'https://media.licdn.com/p.jpg' }] },
            ],
          },
        },
      },
      followersCount: 1200,
      connectionsSize: 504,
    });
    expect(profile.username).toBe('bsmith');
    expect(profile.displayName).toBe('Bob Smith');
    expect(profile.biography).toBe('API Enthusiast');
    expect(profile.avatarUrl).toBe('https://media.licdn.com/p.jpg');
    expect(profile.profileUrl).toBe('https://www.linkedin.com/in/bsmith');
    expect(profile.followersCount).toBe(1200);
    expect(profile.connectionsCount).toBe(504);
    expect(profile.accountType).toBe('member');
  });

  test('survives a minimal member shape', () => {
    const profile = linkedInMemberToProfile({
      me: { id: 'abc' },
      followersCount: null,
      connectionsSize: null,
    });
    expect(profile.username).toBeNull();
    expect(profile.displayName).toBeNull();
    expect(profile.profileUrl).toBeNull();
    expect(profile.followersCount).toBeNull();
    expect(profile.connectionsCount).toBeNull();
  });
});

describe('linkedInOrganizationToProfile', () => {
  test('maps the org shape', () => {
    const profile = linkedInOrganizationToProfile({
      org: {
        id: 2414183,
        localizedName: 'Camaleonic',
        vanityName: 'camaleonic',
        localizedDescription: 'Analytics',
        localizedWebsite: 'https://camaleonic.com',
      },
      followerCount: 9000,
    });
    expect(profile.username).toBe('camaleonic');
    expect(profile.displayName).toBe('Camaleonic');
    expect(profile.profileUrl).toBe('https://www.linkedin.com/company/camaleonic');
    expect(profile.followersCount).toBe(9000);
    expect(profile.website).toBe('https://camaleonic.com');
    expect(profile.accountType).toBe('organization');
  });
});
```

Run: `cd poc && npx jest linkedin-profile.mapper --no-coverage`
Expected: FAIL — module not found.

- [ ] **Step 4.2: Implement `linkedin-profile.mapper.ts`**

```ts
// /v2/me (+ memberFollowersCount + connections) → canonical ProfileData,
// and /rest/organizations/{id} (+ networkSizes) → canonical ProfileData.
//
// Mapping decisions:
//  - member `username` is vanityName (the /in/{slug} URL handle).
//  - `connectionsCount` (1st-degree, bidirectional) is platform-specific and
//    distinct from followersCount — both surfaced.
//  - org `username` is the company vanityName (/company/{slug}).
//  - accountType distinguishes 'member' vs 'organization' rows downstream.

import type { ProfileData } from '../../shared/platform-types';
import type {
  LinkedInMe,
  LinkedInOrganization,
} from '../../shared/linkedin-api/linkedin-types';

export interface LinkedInMemberProfileSource {
  me: LinkedInMe;
  followersCount: number | null;
  connectionsSize: number | null;
}

export interface LinkedInOrgProfileSource {
  org: LinkedInOrganization;
  followerCount: number | null;
}

function pictureUrl(me: LinkedInMe): string | null {
  const elements = me.profilePicture?.['displayImage~']?.elements;
  if (!elements?.length) return null;
  // Last element is typically the largest rendition; any works for an avatar.
  const last = elements[elements.length - 1];
  return last?.identifiers?.[0]?.identifier ?? null;
}

export function linkedInMemberToProfile(
  src: LinkedInMemberProfileSource,
): ProfileData {
  const { me, followersCount, connectionsSize } = src;
  const name = [me.localizedFirstName, me.localizedLastName]
    .filter(Boolean)
    .join(' ');
  return {
    username: me.vanityName ?? null,
    displayName: name.length > 0 ? name : null,
    biography: me.localizedHeadline ?? null,
    avatarUrl: pictureUrl(me),
    profileUrl: me.vanityName
      ? `https://www.linkedin.com/in/${me.vanityName}`
      : null,
    followersCount,
    followingCount: null,
    postsCount: null,
    verified: null,
    accountType: 'member',
    connectionsCount: connectionsSize,
    fetchedAt: new Date(),
  };
}

export function linkedInOrganizationToProfile(
  src: LinkedInOrgProfileSource,
): ProfileData {
  const { org, followerCount } = src;
  return {
    username: org.vanityName ?? null,
    displayName: org.localizedName ?? null,
    biography: org.localizedDescription ?? null,
    avatarUrl: null, // logoV2 needs digitalmediaAsset decoration — follow-up
    profileUrl: org.vanityName
      ? `https://www.linkedin.com/company/${org.vanityName}`
      : null,
    followersCount: followerCount,
    followingCount: null,
    postsCount: null,
    verified: null,
    accountType: 'organization',
    website: org.localizedWebsite ?? null,
    fetchedAt: new Date(),
  };
}
```

- [ ] **Step 4.3: Run profile mapper tests**

Run: `cd poc && npx jest linkedin-profile.mapper --no-coverage`
Expected: PASS (3 tests).

- [ ] **Step 4.4: Write failing post mapper tests**

`__tests__/linkedin-post.mapper.spec.ts`:

```ts
import { linkedInPostToContent } from '../mapper/linkedin-post.mapper';

describe('linkedInPostToContent', () => {
  test('maps a share post with stats', () => {
    const content = linkedInPostToContent(
      {
        id: 'urn:li:share:7325786486870552578',
        author: 'urn:li:organization:2414183',
        commentary: 'Hello LinkedIn',
        publishedAt: 1714000000000,
        lifecycleState: 'PUBLISHED',
        visibility: 'PUBLIC',
      },
      {
        impressionCount: 1000,
        uniqueImpressionsCount: 800,
        clickCount: 50,
        likeCount: 20,
        commentCount: 5,
        shareCount: 3,
        engagement: 0.078,
      },
    );
    expect(content.platformContentId).toBe('urn:li:share:7325786486870552578');
    expect(content.permalink).toBe(
      'https://www.linkedin.com/feed/update/urn:li:share:7325786486870552578',
    );
    expect(content.caption).toBe('Hello LinkedIn');
    expect(content.publishedAt).toEqual(new Date(1714000000000));
    expect(content.metrics.views).toBe(1000);
    expect(content.metrics.reach).toBe(800);
    expect(content.metrics.likes).toBe(20);
    expect(content.metrics.comments).toBe(5);
    expect(content.metrics.shares).toBe(3);
    expect(content.metrics.extra?.clicks).toBe(50);
    expect(content.privacyStatus).toBe('PUBLIC');
    expect(content.rawResponse.collection).toBe('raw_platform_responses');
  });

  test('maps a post without stats', () => {
    const content = linkedInPostToContent(
      { id: 'urn:li:ugcPost:99', createdAt: 1714000000000 },
      null,
    );
    expect(content.metrics).toEqual({});
    expect(content.publishedAt).toEqual(new Date(1714000000000));
    expect(content.contentType).toBe('other');
  });
});
```

Run: `cd poc && npx jest linkedin-post.mapper --no-coverage`
Expected: FAIL — module not found.

- [ ] **Step 4.5: Implement `linkedin-post.mapper.ts`**

```ts
// /rest/posts element (+ optional totalShareStatistics) → canonical
// ContentData.
//
// Mapping decisions:
//  - permalink reconstructed as linkedin.com/feed/update/{urn} (works for
//    both share and ugcPost URNs).
//  - metrics.views = impressionCount, metrics.reach = uniqueImpressionsCount,
//    clicks + engagement-rate land in metrics.extra.
//  - contentType: article → 'other', single media id → 'image' (LinkedIn
//    doesn't tell image vs video without decorating the media URN — videos
//    are a follow-up), multiImage → 'carousel'.

import { createHash } from 'node:crypto';
import type {
  ContentData,
  ContentType,
} from '../../shared/platform-types';
import type {
  LinkedInPost,
  LinkedInTotalShareStatistics,
} from '../../shared/linkedin-api/linkedin-types';

function contentTypeOf(post: LinkedInPost): ContentType {
  if (post.content?.multiImage) return 'carousel';
  if (post.content?.media) return 'image';
  return 'other';
}

export function linkedInPostToContent(
  post: LinkedInPost,
  stats: LinkedInTotalShareStatistics | null,
): ContentData {
  const publishedMs = post.publishedAt ?? post.createdAt ?? null;
  const metrics: ContentData['metrics'] = {};
  if (stats) {
    if (typeof stats.impressionCount === 'number')
      metrics.views = stats.impressionCount;
    if (typeof stats.uniqueImpressionsCount === 'number')
      metrics.reach = stats.uniqueImpressionsCount;
    if (typeof stats.likeCount === 'number') metrics.likes = stats.likeCount;
    if (typeof stats.commentCount === 'number')
      metrics.comments = stats.commentCount;
    if (typeof stats.shareCount === 'number') metrics.shares = stats.shareCount;
    const extra: Record<string, number> = {};
    if (typeof stats.clickCount === 'number') extra['clicks'] = stats.clickCount;
    if (typeof stats.engagement === 'number')
      extra['engagementRate'] = stats.engagement;
    if (Object.keys(extra).length > 0) metrics.extra = extra;
  }

  return {
    platformContentId: post.id,
    contentType: contentTypeOf(post),
    caption: post.commentary ?? null,
    permalink: `https://www.linkedin.com/feed/update/${post.id}`,
    mediaUrls: [],
    metrics,
    publishedAt: publishedMs ? new Date(publishedMs) : null,
    fetchedAt: new Date(),
    privacyStatus: post.visibility ?? null,
    uploadStatus: post.lifecycleState ?? null,
    rawResponse: {
      collection: 'raw_platform_responses',
      contentHash: createHash('sha256')
        .update(JSON.stringify(post))
        .digest('hex'),
    },
  };
}
```

NOTE for the implementer: before writing `rawResponse`, check how `twitch-content.mapper.ts` fills `rawResponse` (collection name + hash source) and copy THAT pattern exactly — the test asserts `raw_platform_responses` but the existing convention wins if it differs; update the test to match the convention, not vice versa.

- [ ] **Step 4.6: Run post mapper tests**

Run: `cd poc && npx jest linkedin-post.mapper --no-coverage`
Expected: PASS (2 tests).

- [ ] **Step 4.7: Write failing analytics mapper tests**

`__tests__/linkedin-analytics.mapper.spec.ts`:

```ts
import { buildMemberAudience } from '../mapper/linkedin-analytics.mapper';

describe('buildMemberAudience', () => {
  test('folds follower series + metric series + totals into accountInsights', () => {
    const audience = buildMemberAudience({
      periodDays: 30,
      lifetimeFollowers: 1200,
      followersDaily: [
        { date: '2026-05-04', value: 1190 },
        { date: '2026-05-05', value: 1200 },
      ],
      totals: { IMPRESSION: 5000, REACTION: 100, COMMENT: 20, RESHARE: 10, MEMBERS_REACHED: 3000 },
      daily: {
        IMPRESSION: [{ date: '2026-05-04', value: 200 }],
        REACTION: [{ date: '2026-05-04', value: 4 }],
        COMMENT: [],
        RESHARE: [],
      },
    });
    const insights = audience.accountInsights;
    expect(insights?.periodDays).toBe(30);
    expect(insights?.views).toBe(5000);
    expect(insights?.likes).toBe(100);
    expect(insights?.comments).toBe(20);
    expect(insights?.shares).toBe(10);
    expect(insights?.reach).toBe(3000);
    expect(insights?.followerCountSeries).toEqual([
      { endTime: '2026-05-04', value: 1190 },
      { endTime: '2026-05-05', value: 1200 },
    ]);
    expect(insights?.videoViewsSeries).toEqual([
      { endTime: '2026-05-04', value: 200 },
    ]);
    expect(insights?.likesSeries).toEqual([{ endTime: '2026-05-04', value: 4 }]);
    expect(insights?.commentsSeries).toBeUndefined();
    expect(insights?.extra?.lifetimeFollowers).toBe(1200);
    expect(audience.genderDistribution).toEqual([]);
    expect(audience.fetchedAt).toBeInstanceOf(Date);
  });
});
```

Run: `cd poc && npx jest linkedin-analytics.mapper --no-coverage`
Expected: FAIL — module not found.

- [ ] **Step 4.8: Implement `linkedin-analytics.mapper.ts`**

```ts
// memberFollowersCount + memberCreatorPostAnalytics → canonical AudienceData,
// and organizationalEntityFollowerStatistics → canonical AudienceData.
//
// LinkedIn exposes NO follower demographics for members, so the four
// distribution arrays stay empty and everything lands in accountInsights:
//   - followerCountSeries ← memberFollowersCount?q=dateRange (daily)
//   - views/likes/comments/shares/reach ← per-metric TOTAL calls
//   - likesSeries/commentsSeries/sharesSeries ← per-metric DAILY calls
//   - daily IMPRESSION series → videoViewsSeries. Documented trade-off:
//     AccountInsightsData has no generic daily views series field, and
//     videoViewsSeries is the only "views per day" slot in the canonical
//     shape. The admin UI labels it "views".

import type {
  AudienceData,
  DailySeriesPoint,
} from '../../shared/platform-types';

export interface SimpleSeriesPoint {
  /** YYYY-MM-DD */
  date: string;
  value: number;
}

export interface MemberAudienceSource {
  periodDays: number;
  lifetimeFollowers: number | null;
  followersDaily: SimpleSeriesPoint[];
  totals: Partial<
    Record<'IMPRESSION' | 'REACTION' | 'COMMENT' | 'RESHARE' | 'MEMBERS_REACHED', number>
  >;
  daily: Partial<
    Record<'IMPRESSION' | 'REACTION' | 'COMMENT' | 'RESHARE', SimpleSeriesPoint[]>
  >;
}

function toSeries(
  points: SimpleSeriesPoint[] | undefined,
): DailySeriesPoint[] | undefined {
  if (!points || points.length === 0) return undefined;
  return points.map((p) => ({ endTime: p.date, value: p.value }));
}

export function buildMemberAudience(src: MemberAudienceSource): AudienceData {
  const extra: Record<string, number> = {};
  if (src.lifetimeFollowers != null) {
    extra['lifetimeFollowers'] = src.lifetimeFollowers;
  }

  return {
    genderDistribution: [],
    ageDistribution: [],
    countryDistribution: [],
    cityDistribution: [],
    accountInsights: {
      periodDays: src.periodDays,
      views: src.totals.IMPRESSION,
      likes: src.totals.REACTION,
      comments: src.totals.COMMENT,
      shares: src.totals.RESHARE,
      reach: src.totals.MEMBERS_REACHED,
      followerCountSeries: toSeries(src.followersDaily),
      videoViewsSeries: toSeries(src.daily.IMPRESSION),
      likesSeries: toSeries(src.daily.REACTION),
      commentsSeries: toSeries(src.daily.COMMENT),
      sharesSeries: toSeries(src.daily.RESHARE),
      ...(Object.keys(extra).length > 0 ? { extra } : {}),
    },
    fetchedAt: new Date(),
  };
}

export interface OrgAudienceSource {
  periodDays: number;
  followerGainsDaily: Array<{ date: string; organic: number; paid: number }>;
}

export function buildOrgAudience(src: OrgAudienceSource): AudienceData {
  return {
    genderDistribution: [],
    ageDistribution: [],
    countryDistribution: [],
    cityDistribution: [],
    accountInsights: {
      periodDays: src.periodDays,
      newFollowersSeries: src.followerGainsDaily.length
        ? src.followerGainsDaily.map((p) => ({
            endTime: p.date,
            value: p.organic + p.paid,
          }))
        : undefined,
    },
    fetchedAt: new Date(),
  };
}
```

- [ ] **Step 4.9: Run analytics mapper tests**

Run: `cd poc && npx jest linkedin-analytics.mapper --no-coverage`
Expected: PASS (1 test).

- [ ] **Step 4.10: Commit**

```bash
git add poc/src/modules/platforms/linkedin/
git commit -m "feat(poc): linkedin mappers — profile, post, analytics (TDD)"
```

---

### Task 5: Fetchers + adapter + module + registry

**Files:**
- Create: `poc/src/modules/platforms/linkedin/linkedin.tokens.ts`
- Create: `poc/src/modules/platforms/linkedin/linkedin.constants.ts`
- Create: `poc/src/modules/platforms/linkedin/linkedin.context.ts`
- Create: `poc/src/modules/platforms/linkedin/linkedin.rate-limit.strategy.ts`
- Create: `poc/src/modules/platforms/linkedin/linkedin.support-matrix.ts`
- Create: `poc/src/modules/platforms/linkedin/fetcher/linkedin-profile.fetcher.ts`
- Create: `poc/src/modules/platforms/linkedin/fetcher/linkedin-audience.fetcher.ts`
- Create: `poc/src/modules/platforms/linkedin/fetcher/linkedin-content.fetcher.ts`
- Create: `poc/src/modules/platforms/linkedin/linkedin.adapter.ts`
- Create: `poc/src/modules/platforms/linkedin/linkedin.module.ts`
- Modify: `poc/src/modules/platforms/platforms.module.ts`

- [ ] **Step 5.1: `linkedin.tokens.ts`**

```ts
/** DI token for the per-platform BoundLinkedInClient (factory-bound). */
export const LINKEDIN_API_CLIENT = Symbol('LINKEDIN_API_CLIENT');
```

- [ ] **Step 5.2: `linkedin.constants.ts`**

```ts
// LinkedIn sync tuning. Dev tier: ~500 calls/app/day + 100/member/day.

/** Analytics lookback window for the audience product. */
export const ANALYTICS_PERIOD_DAYS = 30;
/** Posts page size (API max is 100; 50 keeps payloads sane). */
export const POSTS_PAGE_SIZE = 50;
/** Max pages of org posts per engagement sync. */
export const POSTS_MAX_PAGES = 2;
/** Share-statistics List(...) batch size per call. */
export const SHARE_STATS_BATCH = 20;
/** Metrics fetched as TOTAL (lifetime-in-window). */
export const MEMBER_METRICS_TOTAL = [
  'IMPRESSION',
  'REACTION',
  'COMMENT',
  'RESHARE',
  'MEMBERS_REACHED',
] as const;
/** Metrics fetched as DAILY series (DAILY unsupported for MEMBERS_REACHED). */
export const MEMBER_METRICS_DAILY = [
  'IMPRESSION',
  'REACTION',
  'COMMENT',
  'RESHARE',
] as const;
```

- [ ] **Step 5.3: `linkedin.context.ts`**

```ts
// LinkedIn request-context builder. canonicalId is the person id (member
// rows) or org id (organization rows). channelId keys the per-account rate
// bucket dimension, same semantic role as YouTube's channelId.

import type { PlatformAdapterContext } from '../shared/platform-adapter.port';
import { tokenHash } from '../shared/meta-graph';

export function buildLinkedInContext(
  accessToken: string,
  canonicalId: string,
): PlatformAdapterContext {
  return {
    tokenHash: tokenHash(accessToken),
    channelId: canonicalId,
  };
}

/** Account kind discriminator persisted by the connect-tool seed. */
export function linkedInKind(
  metadata: Record<string, unknown> | undefined,
): 'member' | 'organization' {
  return metadata?.['kind'] === 'organization' ? 'organization' : 'member';
}

/** urn:li:organization:{id} — prefer the seeded URN, fall back to canonicalId. */
export function organizationUrn(
  canonicalId: string,
  metadata: Record<string, unknown> | undefined,
): string {
  const fromMeta = metadata?.['organization_urn'];
  return typeof fromMeta === 'string' && fromMeta.length > 0
    ? fromMeta
    : `urn:li:organization:${canonicalId}`;
}
```

- [ ] **Step 5.4: `linkedin.rate-limit.strategy.ts`**

```ts
// LinkedIn rate-limit hints. Quotas are DAILY (reset midnight UTC) and not
// surfaced in headers. Dev tier ≈ 500 calls/app/day + 100/member/day; we
// model both as token buckets refilling continuously across the day, which
// under-uses bursts but can never blow the daily cap.

import { Injectable } from '@nestjs/common';
import type { RateLimitHint } from '@shared/redis/rate-bucket.service';
import type { PlatformAdapterContext } from '../shared/platform-adapter.port';
import type { RateLimitStrategy } from '../shared/meta-graph/rate-limit-strategy.port';

const DAY_MS = 86_400_000;
const APP_DAILY_CAPACITY = 500;
const MEMBER_DAILY_CAPACITY = 100;

@Injectable()
export class LinkedInRateLimitStrategy implements RateLimitStrategy {
  hints(context: PlatformAdapterContext): RateLimitHint[] {
    const hints: RateLimitHint[] = [
      {
        scope: 'linkedin_app',
        keyTemplate: 'rate:linkedin:app',
        capacity: APP_DAILY_CAPACITY,
        refillPerMs: APP_DAILY_CAPACITY / DAY_MS,
        costPerCall: 1,
        strategy: 'token-bucket',
      },
    ];
    if (context?.tokenHash) {
      hints.push({
        scope: 'linkedin_member',
        keyTemplate: 'rate:linkedin:member:{hash}',
        capacity: MEMBER_DAILY_CAPACITY,
        refillPerMs: MEMBER_DAILY_CAPACITY / DAY_MS,
        costPerCall: 1,
        strategy: 'token-bucket',
      });
    }
    return hints;
  }
}
```

- [ ] **Step 5.5: `linkedin.support-matrix.ts`**

```ts
// LinkedIn support matrix.
//
// Three products:
//   - identity: /v2/me (+ connections + memberFollowersCount) for members;
//     /rest/organizations + networkSizes for orgs.
//   - audience: NO demographics on either surface. Member analytics
//     aggregates + follower series land in accountInsights.
//   - engagement_new: ORG posts only. Member posts are not listable —
//     r_member_social is a closed LinkedIn permission ("not accepting
//     access requests"); member accounts return zero content items.

import type { SupportMatrix } from '../shared/platform-types';

export const LINKEDIN_SUPPORT_MATRIX: SupportMatrix = {
  profile: {
    username: 'empty_possible', // vanityName not guaranteed
    displayName: 'supported',
    biography: 'supported',
    avatarUrl: 'empty_possible',
    profileUrl: 'empty_possible',
    followersCount: 'supported',
    followingCount: 'not_supported',
    connectionsCount: 'supported', // member rows only
    postsCount: 'not_supported',
    verified: 'not_supported',
    accountType: 'supported',
    website: 'empty_possible', // org rows only
  },
  engagement_new: {
    caption: 'supported',
    permalink: 'supported',
    mediaUrls: 'not_supported', // media URN decoration is a follow-up
    likes: 'supported',
    comments: 'supported',
    shares: 'supported',
    saves: 'not_supported',
    views: 'supported', // impressionCount
    duration: 'not_supported',
    privacyStatus: 'supported',
  },
  audience: {
    genderDistribution: 'not_supported',
    ageDistribution: 'not_supported',
    countryDistribution: 'not_supported',
    cityDistribution: 'not_supported',
    interests: 'not_supported',
    audienceActivity: 'not_supported',
    audienceActivityWeekly: 'not_supported',
  },
  comments: {
    list: 'not_supported',
    threaded: 'not_supported',
    likes: 'not_supported',
    pinned: 'not_supported',
  },
  engagement_deep: {
    perVideoMetrics: 'not_supported',
    trafficSources: 'not_supported',
    countries: 'not_supported',
    devices: 'not_supported',
    demographics: 'not_supported',
    retentionCurve: 'not_supported',
  },
  ads: {
    accessibleCustomers: 'not_supported',
    videoCampaigns: 'not_supported',
    revenue: 'not_supported',
  },
};
```

- [ ] **Step 5.6: `fetcher/linkedin-profile.fetcher.ts`**

```ts
// LinkedIn profile fetcher — branches on account kind.
//
// Member (3 calls): /v2/me + /v2/connections/{personUrn} +
//   /rest/memberFollowersCount?q=me. Connections + followers are
//   best-effort: a missing scope must not fail identity.
// Organization (2 calls): /rest/organizations/{id} +
//   /rest/networkSizes/{orgUrn}. Follower count best-effort.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ProfileData } from '../../shared/platform-types';
import type {
  BoundLinkedInClient,
  LinkedInCallContext,
} from '../../shared/linkedin-api/linkedin-client';
import { extractAccountId } from '../../shared/meta-graph';
import {
  buildLinkedInContext,
  linkedInKind,
  organizationUrn,
} from '../linkedin.context';
import {
  linkedInMemberToProfile,
  linkedInOrganizationToProfile,
} from '../mapper/linkedin-profile.mapper';
import { LINKEDIN_API_CLIENT } from '../linkedin.tokens';

@Injectable()
export class LinkedInProfileFetcher {
  private readonly logger = new Logger(LinkedInProfileFetcher.name);

  constructor(
    @Inject(LINKEDIN_API_CLIENT)
    private readonly client: BoundLinkedInClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ProfileData> {
    const accountId = extractAccountId(metadata);
    const ctx = buildLinkedInContext(accessToken, canonicalId);
    const callCtx: LinkedInCallContext = { accessToken, context: ctx, accountId };

    if (linkedInKind(metadata) === 'organization') {
      return this.fetchOrganization(callCtx, canonicalId, metadata);
    }
    return this.fetchMember(callCtx, canonicalId);
  }

  private async fetchMember(
    callCtx: LinkedInCallContext,
    canonicalId: string,
  ): Promise<ProfileData> {
    const me = await this.client.getMe(callCtx);

    const connectionsSize = await this.client
      .getConnectionsSize({ ...callCtx, personId: me.id ?? canonicalId })
      .then((r) => (typeof r.firstDegreeSize === 'number' ? r.firstDegreeSize : null))
      .catch((err) => {
        this.logger.warn(
          `getConnectionsSize failed for ${canonicalId}: ${msg(err)} — proceeding without connections`,
        );
        return null;
      });

    const followersCount = await this.client
      .getMemberFollowersCount(callCtx)
      .then((r) => {
        const v = r.elements?.[0]?.memberFollowersCount;
        return typeof v === 'number' ? v : null;
      })
      .catch((err) => {
        this.logger.warn(
          `getMemberFollowersCount failed for ${canonicalId}: ${msg(err)} — proceeding without followers`,
        );
        return null;
      });

    return linkedInMemberToProfile({ me, followersCount, connectionsSize });
  }

  private async fetchOrganization(
    callCtx: LinkedInCallContext,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ProfileData> {
    const org = await this.client.getOrganization({
      ...callCtx,
      orgId: canonicalId,
    });
    const orgUrn = organizationUrn(canonicalId, metadata);
    const followerCount = await this.client
      .getOrganizationFollowerCount({ ...callCtx, orgUrn })
      .then((r) => (typeof r.firstDegreeSize === 'number' ? r.firstDegreeSize : null))
      .catch((err) => {
        this.logger.warn(
          `getOrganizationFollowerCount failed for ${orgUrn}: ${msg(err)} — proceeding without followers`,
        );
        return null;
      });
    return linkedInOrganizationToProfile({ org, followerCount });
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
```

- [ ] **Step 5.7: `fetcher/linkedin-audience.fetcher.ts`**

```ts
// LinkedIn audience fetcher — analytics aggregates, no demographics.
//
// Member (~11 calls): memberFollowersCount q=me + q=dateRange(30d), then
//   memberCreatorPostAnalytics one call PER metric per aggregation:
//   5× TOTAL + 4× DAILY (DAILY unsupported for MEMBERS_REACHED).
//   Every metric is best-effort — partial results beat a failed sync.
// Organization (1 call): organizationalEntityFollowerStatistics
//   timeIntervals daily gains.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AudienceData } from '../../shared/platform-types';
import type {
  BoundLinkedInClient,
  LinkedInCallContext,
} from '../../shared/linkedin-api/linkedin-client';
import type {
  LinkedInDateRange,
  LinkedInMemberAnalyticsElement,
} from '../../shared/linkedin-api/linkedin-types';
import { extractAccountId } from '../../shared/meta-graph';
import {
  buildLinkedInContext,
  linkedInKind,
  organizationUrn,
} from '../linkedin.context';
import {
  ANALYTICS_PERIOD_DAYS,
  MEMBER_METRICS_DAILY,
  MEMBER_METRICS_TOTAL,
} from '../linkedin.constants';
import {
  buildMemberAudience,
  buildOrgAudience,
  type SimpleSeriesPoint,
} from '../mapper/linkedin-analytics.mapper';
import { LINKEDIN_API_CLIENT } from '../linkedin.tokens';

@Injectable()
export class LinkedInAudienceFetcher {
  private readonly logger = new Logger(LinkedInAudienceFetcher.name);

  constructor(
    @Inject(LINKEDIN_API_CLIENT)
    private readonly client: BoundLinkedInClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AudienceData> {
    const accountId = extractAccountId(metadata);
    const ctx = buildLinkedInContext(accessToken, canonicalId);
    const callCtx: LinkedInCallContext = { accessToken, context: ctx, accountId };

    if (linkedInKind(metadata) === 'organization') {
      return this.fetchOrg(callCtx, canonicalId, metadata);
    }
    return this.fetchMember(callCtx, canonicalId);
  }

  private async fetchMember(
    callCtx: LinkedInCallContext,
    canonicalId: string,
  ): Promise<AudienceData> {
    const end = new Date();
    const start = new Date(end.getTime() - ANALYTICS_PERIOD_DAYS * 86_400_000);

    const lifetimeFollowers = await this.client
      .getMemberFollowersCount(callCtx)
      .then((r) => {
        const v = r.elements?.[0]?.memberFollowersCount;
        return typeof v === 'number' ? v : null;
      })
      .catch((err) => {
        this.warn('memberFollowersCount(me)', canonicalId, err);
        return null;
      });

    const followersDaily = await this.client
      .getMemberFollowersDaily({ ...callCtx, start, end })
      .then((r) =>
        (r.elements ?? [])
          .filter((e) => typeof e.memberFollowersCount === 'number')
          .map((e) => ({
            date: dateOf(e.dateRange),
            value: e.memberFollowersCount as number,
          }))
          .filter((p) => p.date !== ''),
      )
      .catch((err) => {
        this.warn('memberFollowersCount(dateRange)', canonicalId, err);
        return [] as SimpleSeriesPoint[];
      });

    const totals: Record<string, number> = {};
    for (const metric of MEMBER_METRICS_TOTAL) {
      const value = await this.client
        .getMemberPostAnalytics({
          ...callCtx,
          queryType: metric,
          aggregation: 'TOTAL',
          start,
          end,
        })
        .then((r) => sumCounts(r.elements))
        .catch((err) => {
          this.warn(`postAnalytics(${metric},TOTAL)`, canonicalId, err);
          return null;
        });
      if (value != null) totals[metric] = value;
    }

    const daily: Record<string, SimpleSeriesPoint[]> = {};
    for (const metric of MEMBER_METRICS_DAILY) {
      const series = await this.client
        .getMemberPostAnalytics({
          ...callCtx,
          queryType: metric,
          aggregation: 'DAILY',
          start,
          end,
        })
        .then((r) =>
          (r.elements ?? [])
            .filter((e) => typeof e.count === 'number')
            .map((e) => ({ date: dateOf(e.dateRange), value: e.count as number }))
            .filter((p) => p.date !== ''),
        )
        .catch((err) => {
          this.warn(`postAnalytics(${metric},DAILY)`, canonicalId, err);
          return [] as SimpleSeriesPoint[];
        });
      daily[metric] = series;
    }

    return buildMemberAudience({
      periodDays: ANALYTICS_PERIOD_DAYS,
      lifetimeFollowers,
      followersDaily,
      totals,
      daily,
    });
  }

  private async fetchOrg(
    callCtx: LinkedInCallContext,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AudienceData> {
    const orgUrn = organizationUrn(canonicalId, metadata);
    const endMs = Date.now();
    const startMs = endMs - ANALYTICS_PERIOD_DAYS * 86_400_000;

    const gains = await this.client
      .getOrganizationFollowerGains({ ...callCtx, orgUrn, startMs, endMs })
      .then((r) =>
        (r.elements ?? [])
          .filter((e) => e.timeRange?.start != null)
          .map((e) => ({
            date: new Date(e.timeRange?.start as number)
              .toISOString()
              .slice(0, 10),
            organic: e.followerGains?.organicFollowerGain ?? 0,
            paid: e.followerGains?.paidFollowerGain ?? 0,
          })),
      )
      .catch((err) => {
        this.warn('orgFollowerGains', orgUrn, err);
        return [];
      });

    return buildOrgAudience({
      periodDays: ANALYTICS_PERIOD_DAYS,
      followerGainsDaily: gains,
    });
  }

  private warn(what: string, id: string, err: unknown): void {
    this.logger.warn(
      `${what} failed for ${id}: ${err instanceof Error ? err.message : String(err)} — partial audience snapshot`,
    );
  }
}

function dateOf(range: LinkedInDateRange | undefined): string {
  const s = range?.start;
  if (!s) return '';
  const mm = String(s.month).padStart(2, '0');
  const dd = String(s.day).padStart(2, '0');
  return `${s.year}-${mm}-${dd}`;
}

function sumCounts(
  elements: LinkedInMemberAnalyticsElement[] | undefined,
): number | null {
  if (!elements || elements.length === 0) return null;
  let sum = 0;
  let any = false;
  for (const e of elements) {
    if (typeof e.count === 'number') {
      sum += e.count;
      any = true;
    }
  }
  return any ? sum : null;
}
```

- [ ] **Step 5.8: `fetcher/linkedin-content.fetcher.ts`**

```ts
// LinkedIn content fetcher — ORGANIZATION posts only.
//
// Member accounts return [] — the person-author Posts finder requires
// r_member_social, a closed LinkedIn permission. See linkedin.support-matrix.
//
// Org pipeline:
//   1. /rest/posts?q=author (offset paging, ≤POSTS_MAX_PAGES pages)
//   2. /rest/organizationalEntityShareStatistics in List() batches of
//      SHARE_STATS_BATCH, split by URN type (shares / ugcPosts). Best-effort.
//   3. Map to ContentData with stats merged by URN.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ContentData, FetchOpts } from '../../shared/platform-types';
import type {
  BoundLinkedInClient,
  LinkedInCallContext,
} from '../../shared/linkedin-api/linkedin-client';
import type {
  LinkedInPost,
  LinkedInTotalShareStatistics,
} from '../../shared/linkedin-api/linkedin-types';
import { extractAccountId } from '../../shared/meta-graph';
import {
  buildLinkedInContext,
  linkedInKind,
  organizationUrn,
} from '../linkedin.context';
import {
  POSTS_MAX_PAGES,
  POSTS_PAGE_SIZE,
  SHARE_STATS_BATCH,
} from '../linkedin.constants';
import { linkedInPostToContent } from '../mapper/linkedin-post.mapper';
import { LINKEDIN_API_CLIENT } from '../linkedin.tokens';

@Injectable()
export class LinkedInContentFetcher {
  private readonly logger = new Logger(LinkedInContentFetcher.name);

  constructor(
    @Inject(LINKEDIN_API_CLIENT)
    private readonly client: BoundLinkedInClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    if (linkedInKind(metadata) !== 'organization') {
      // Member posts are not listable (r_member_social is closed).
      return [];
    }
    const accountId = extractAccountId(metadata);
    const ctx = buildLinkedInContext(accessToken, canonicalId);
    const callCtx: LinkedInCallContext = { accessToken, context: ctx, accountId };
    const orgUrn = organizationUrn(canonicalId, metadata);

    const posts = await this.fetchPosts(callCtx, orgUrn, opts);
    const statsByUrn = await this.fetchStats(callCtx, orgUrn, posts);

    return posts.map((p) =>
      linkedInPostToContent(p, statsByUrn.get(p.id) ?? null),
    );
  }

  private async fetchPosts(
    callCtx: LinkedInCallContext,
    orgUrn: string,
    opts: FetchOpts,
  ): Promise<LinkedInPost[]> {
    const out: LinkedInPost[] = [];
    const sinceMs = opts.since?.getTime();
    const limit = opts.limit ?? POSTS_PAGE_SIZE * POSTS_MAX_PAGES;

    for (let page = 0; page < POSTS_MAX_PAGES; page++) {
      const res = await this.client.getOrganizationPosts({
        ...callCtx,
        orgUrn,
        start: page * POSTS_PAGE_SIZE,
        count: POSTS_PAGE_SIZE,
      });
      const elements = res.elements ?? [];
      for (const post of elements) {
        const publishedMs = post.publishedAt ?? post.createdAt ?? 0;
        if (sinceMs && publishedMs && publishedMs < sinceMs) continue;
        out.push(post);
        if (out.length >= limit) return out;
      }
      if (elements.length < POSTS_PAGE_SIZE) break;
    }
    return out;
  }

  private async fetchStats(
    callCtx: LinkedInCallContext,
    orgUrn: string,
    posts: LinkedInPost[],
  ): Promise<Map<string, LinkedInTotalShareStatistics>> {
    const stats = new Map<string, LinkedInTotalShareStatistics>();
    const shareUrns = posts
      .map((p) => p.id)
      .filter((id) => id.startsWith('urn:li:share:'));
    const ugcUrns = posts
      .map((p) => p.id)
      .filter((id) => id.startsWith('urn:li:ugcPost:'));

    const collect = async (
      kind: 'shares' | 'ugcPosts',
      urns: string[],
    ): Promise<void> => {
      for (let i = 0; i < urns.length; i += SHARE_STATS_BATCH) {
        const batch = urns.slice(i, i + SHARE_STATS_BATCH);
        try {
          const res = await this.client.getShareStatistics({
            ...callCtx,
            orgUrn,
            ...(kind === 'shares'
              ? { shareUrns: batch }
              : { ugcPostUrns: batch }),
          });
          for (const el of res.elements ?? []) {
            const urn = el.share ?? el.ugcPost;
            if (urn && el.totalShareStatistics) {
              stats.set(urn, el.totalShareStatistics);
            }
          }
        } catch (err) {
          this.logger.warn(
            `shareStatistics(${kind}) batch failed for ${orgUrn}: ${
              err instanceof Error ? err.message : String(err)
            } — posts ship without metrics`,
          );
        }
      }
    };

    await collect('shares', shareUrns);
    await collect('ugcPosts', ugcUrns);
    return stats;
  }
}
```

- [ ] **Step 5.9: `linkedin.adapter.ts`**

```ts
// LinkedInAdapter — facade implementing the PlatformAdapter port.
//
// One platform, two account kinds (metadata.kind): 'member' (the OAuth
// user) and 'organization' (company pages the member administers). The
// fetchers branch internally; the adapter stays kind-agnostic.
//
// fetchContents returns [] for member rows — LinkedIn's person-author
// Posts finder needs r_member_social, a closed permission. Aggregate
// member post analytics ship via fetchAudience instead.

import { Inject, Injectable } from '@nestjs/common';
import type { RateLimitHint } from '@shared/redis/rate-bucket.service';
import {
  PlatformAdapter,
  PlatformAdapterContext,
} from '../shared/platform-adapter.port';
import type {
  AudienceData,
  ContentData,
  FetchOpts,
  ProfileData,
  SupportMatrix,
} from '../shared/platform-types';
import type { BoundLinkedInClient } from '../shared/linkedin-api/linkedin-client';
import { LinkedInTokenRefreshService } from '../shared/linkedin-api/linkedin-token-refresh.service';
import { LinkedInRateLimitStrategy } from './linkedin.rate-limit.strategy';
import { LINKEDIN_SUPPORT_MATRIX } from './linkedin.support-matrix';
import { LINKEDIN_API_CLIENT } from './linkedin.tokens';
import { LinkedInProfileFetcher } from './fetcher/linkedin-profile.fetcher';
import { LinkedInAudienceFetcher } from './fetcher/linkedin-audience.fetcher';
import { LinkedInContentFetcher } from './fetcher/linkedin-content.fetcher';

@Injectable()
export class LinkedInAdapter implements PlatformAdapter {
  readonly platform = 'linkedin';

  constructor(
    @Inject(LINKEDIN_API_CLIENT)
    private readonly linkedInClient: BoundLinkedInClient,
    private readonly strategy: LinkedInRateLimitStrategy,
    private readonly tokenRefresh: LinkedInTokenRefreshService,
    private readonly profileFetcher: LinkedInProfileFetcher,
    private readonly audienceFetcher: LinkedInAudienceFetcher,
    private readonly contentFetcher: LinkedInContentFetcher,
  ) {
    void this.linkedInClient;
  }

  rateLimitHints(context?: PlatformAdapterContext): RateLimitHint[] {
    return this.strategy.hints(context ?? {});
  }

  supportMatrix(): SupportMatrix {
    return LINKEDIN_SUPPORT_MATRIX;
  }

  private async freshToken(
    metadata: Record<string, unknown> | undefined,
    accessToken: string,
  ): Promise<string> {
    const accountId =
      typeof metadata?.accountId === 'bigint' ? metadata.accountId : null;
    if (accountId == null) return accessToken;
    return this.tokenRefresh.ensureFresh(accountId, accessToken);
  }

  async fetchProfile(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ProfileData> {
    const token = await this.freshToken(metadata, accessToken);
    return this.profileFetcher.fetch(token, canonicalId, metadata);
  }

  async fetchAudience(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AudienceData> {
    const token = await this.freshToken(metadata, accessToken);
    return this.audienceFetcher.fetch(token, canonicalId, metadata);
  }

  async fetchContents(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    const token = await this.freshToken(metadata, accessToken);
    return this.contentFetcher.fetch(token, canonicalId, opts, metadata);
  }
}
```

- [ ] **Step 5.10: `linkedin.module.ts`**

```ts
// LinkedIn DI wiring. Mirrors twitch.module.ts.

import { Module } from '@nestjs/common';
import { LinkedInApiModule } from '../shared/linkedin-api/linkedin-api.module';
import { LinkedInClient } from '../shared/linkedin-api/linkedin-client';
import { LinkedInAdapter } from './linkedin.adapter';
import { LinkedInRateLimitStrategy } from './linkedin.rate-limit.strategy';
import { LINKEDIN_API_CLIENT } from './linkedin.tokens';
import { LinkedInProfileFetcher } from './fetcher/linkedin-profile.fetcher';
import { LinkedInAudienceFetcher } from './fetcher/linkedin-audience.fetcher';
import { LinkedInContentFetcher } from './fetcher/linkedin-content.fetcher';

@Module({
  imports: [LinkedInApiModule],
  providers: [
    LinkedInAdapter,
    LinkedInRateLimitStrategy,
    LinkedInProfileFetcher,
    LinkedInAudienceFetcher,
    LinkedInContentFetcher,
    {
      provide: LINKEDIN_API_CLIENT,
      useFactory: (client: LinkedInClient, strategy: LinkedInRateLimitStrategy) =>
        client.bind(strategy),
      inject: [LinkedInClient, LinkedInRateLimitStrategy],
    },
  ],
  exports: [LinkedInAdapter, LinkedInApiModule],
})
export class LinkedInModule {}
```

- [ ] **Step 5.11: Register in `platforms.module.ts`**

Add the import, module, factory param + registry line + inject entry:

```ts
import { LinkedInAdapter } from './linkedin/linkedin.adapter';
import { LinkedInModule } from './linkedin/linkedin.module';
```

- `imports`: add `LinkedInModule` after `TwitchModule`.
- factory: add param `li: LinkedInAdapter` and registry entry `linkedin: li`.
- `inject`: add `LinkedInAdapter`.
- `exports`: add `LinkedInModule`.

- [ ] **Step 5.12: Type-check + run all linkedin tests + commit**

Run: `cd poc && npx tsc --noEmit && npx jest linkedin --no-coverage`
Expected: clean + all linkedin specs PASS.

```bash
git add poc/src/modules/platforms/
git commit -m "feat(poc): linkedin adapter — fetchers, rate limits, support matrix, registry"
```

---

### Task 6: Token-refresh cron wiring

**Files:**
- Modify: `poc/src/modules/token-refresh/token-refresh.cron.service.ts`
- Modify: `poc/src/modules/token-refresh/token-refresh.module.ts`

- [ ] **Step 6.1: Wire the LinkedIn branch into the cron**

In `token-refresh.cron.service.ts`:

1. Import:
```ts
import { LinkedInTokenRefreshService } from '@modules/platforms/shared/linkedin-api/linkedin-token-refresh.service';
```
2. Below the `META` set (line ~52):
```ts
// LinkedIn: 60-day access token. refresh_token (365d) only exists when
// LinkedIn enabled programmatic refresh for the app — rows that have one
// refresh with the 7-day lead; rows without behave like Meta (needs_reauth
// once expired).
const LINKEDIN = new Set(['linkedin']);
```
3. Constructor: add `private readonly linkedin: LinkedInTokenRefreshService,` after `igDirect`.
4. In `run()`, insert a branch between the `REFRESHABLE` and `META` blocks:

```ts
        } else if (LINKEDIN.has(platform)) {
          if (row.refreshTokenCiphertext) {
            if (msToExpiry > THREADS_LEAD_MS) {
              result.skipped += 1;
              continue;
            }
            await this.linkedin.refresh(
              accountId,
              this.aes.decrypt(Buffer.from(row.refreshTokenCiphertext)),
            );
            result.refreshed += 1;
            this.metrics.incr('token_refresh_cron_refreshed', { platform });
          } else if (expired) {
            await this.flagNeedsReauth(
              accountId,
              'linkedin token expired and app has no programmatic refresh — re-authentication required',
            );
            result.reauthFlagged += 1;
            this.metrics.incr('token_refresh_cron_reauth', { platform });
          } else {
            result.skipped += 1;
          }
```

- [ ] **Step 6.2: Import LinkedInApiModule in `token-refresh.module.ts`**

Open the file, mirror how the other `*ApiModule`s are imported (path style included), add `LinkedInApiModule` to `imports`:

```ts
import { LinkedInApiModule } from '@modules/platforms/shared/linkedin-api/linkedin-api.module';
```

- [ ] **Step 6.3: Type-check + commit**

Run: `cd poc && npx tsc --noEmit`
Expected: clean.

```bash
git add poc/src/modules/token-refresh/
git commit -m "feat(poc): linkedin token refresh in hourly cron (refresh-or-reauth)"
```

---

### Task 7: connect-tool — types, session, OAuth flow

**Files:**
- Modify: `connect-tool/lib/seed-client.ts`
- Modify: `connect-tool/lib/session.ts`
- Modify: `connect-tool/lib/platforms.ts`
- Modify: `connect-tool/app/api/oauth/[...slug]/route.ts`
- Modify: `connect-tool/app/api/seed-confirm/route.ts`
- Modify: `connect-tool/app/connect/shell-machine.ts`

- [ ] **Step 7.1: Type plumbing**

`seed-client.ts` — `SeedBody.platform` union:
```ts
  platform:
    | 'facebook'
    | 'instagram'
    | 'tiktok'
    | 'threads'
    | 'youtube'
    | 'twitch'
    | 'linkedin';
```

`session.ts` — `SimpleSession`:
```ts
  platform: 'tiktok' | 'threads' | 'youtube' | 'instagram' | 'twitch' | 'linkedin';
```
and add after `seedBody: SeedBody;`:
```ts
  /**
   * LinkedIn: organization accounts discovered via organizationAcls,
   * seeded alongside the member account with the same product selection.
   */
  extraSeedBodies?: SeedBody[];
```

`shell-machine.ts`:
```ts
export type PlatformKey =
  | 'facebook' | 'instagram' | 'youtube' | 'tiktok' | 'threads' | 'twitch' | 'linkedin';

export const PLATFORM_KEYS: readonly PlatformKey[] = [
  'facebook', 'instagram', 'youtube', 'tiktok', 'threads', 'twitch', 'linkedin',
];
```

- [ ] **Step 7.2: Add the LinkedIn PlatformDef in `lib/platforms.ts`**

Constants (next to the other platform hosts):

```ts
const LINKEDIN_AUTHORIZE = 'https://www.linkedin.com/oauth/v2/authorization';
const LINKEDIN_TOKEN = 'https://www.linkedin.com/oauth/v2/accessToken';
const LINKEDIN_API = 'https://api.linkedin.com';
// Versioned-REST header value; supported ≥1y per LinkedIn's sunset policy.
const LINKEDIN_VERSION = '202605';
```

`PlatformKey` union (line ~70): add `| 'linkedin'` after `'twitch'`.

The def (place after the `twitch` const — full code):

```ts
// ─── LinkedIn ──────────────────────────────────────────────────────────
// One OAuth produces 1 member seed + N organization seeds (Pages the
// member administers, via organizationAcls). Same token everywhere; the
// POC adapter branches on metadata.kind.
//
// refresh_token only appears when LinkedIn enabled programmatic refresh
// for the app (MDP partners) — captured when present; the POC cron flags
// needs_reauth at expiry otherwise.

const linkedin: PlatformDef = {
  key: 'linkedin',
  buildAuthorizeUrl(redirectUri, scopes) {
    const clientId = requireEnv('LINKEDIN_CLIENT_ID');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      // LinkedIn wants space-separated scopes.
      scope: [...scopes].join(' '),
      state: cryptoRandomState(),
    });
    return `${LINKEDIN_AUTHORIZE}?${params.toString()}`;
  },
  async handleCallback(code, redirectUri) {
    const clientId = requireEnv('LINKEDIN_CLIENT_ID');
    const clientSecret = requireEnv('LINKEDIN_CLIENT_SECRET');

    // 1. Code → access token (60d) + optional refresh token (365d).
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });
    const tokenRes = await axios.post<{
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      refresh_token_expires_in?: number;
      scope?: string;
      error?: string;
      error_description?: string;
    }>(LINKEDIN_TOKEN, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15_000,
      validateStatus: () => true,
      // Bypass any HTTPS_PROXY env var (OrbStack) — same hardening as Twitch.
      proxy: false,
    });
    const t = tokenRes.data;
    if (tokenRes.status < 200 || tokenRes.status >= 300 || !t.access_token) {
      const msg = t.error_description || t.error || `HTTP ${tokenRes.status}`;
      throw new Error(`LinkedIn exchange failed: ${msg}`);
    }
    const accessToken = t.access_token;
    const expiresAt = t.expires_in
      ? new Date(Date.now() + t.expires_in * 1000).toISOString()
      : undefined;
    const scopes = t.scope ? t.scope.split(/[ ,]/).filter(Boolean) : undefined;

    // 2. Member identity (/v2 surface — NO LinkedIn-Version header).
    const meRes = await axios.get<{
      id?: string;
      localizedFirstName?: string;
      localizedLastName?: string;
      localizedHeadline?: string;
      vanityName?: string;
    }>(`${LINKEDIN_API}/v2/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15_000,
      validateStatus: () => true,
      proxy: false,
    });
    if (meRes.status < 200 || meRes.status >= 300 || !meRes.data.id) {
      throw new Error(
        `LinkedIn /v2/me failed (HTTP ${meRes.status}): ${JSON.stringify(meRes.data)}`,
      );
    }
    const me = meRes.data;
    const personId = me.id as string;
    const personUrn = `urn:li:person:${personId}`;
    const displayName = [me.localizedFirstName, me.localizedLastName]
      .filter(Boolean)
      .join(' ');

    // 3. Organizations the member administers (best-effort — a member with
    //    no org roles, or a workspace without org scopes, still connects).
    type Acl = { organization?: string; role?: string; state?: string };
    let orgs: Array<{ id: string; urn: string; name: string }> = [];
    try {
      const aclRes = await axios.get<{ elements?: Acl[] }>(
        `${LINKEDIN_API}/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=50`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'LinkedIn-Version': LINKEDIN_VERSION,
            'X-Restli-Protocol-Version': '2.0.0',
          },
          timeout: 15_000,
          proxy: false,
        },
      );
      const acls = aclRes.data.elements ?? [];
      orgs = await Promise.all(
        acls
          .map((a) => a.organization)
          .filter((urn): urn is string => typeof urn === 'string')
          .map(async (urn) => {
            const id = urn.split(':').pop() as string;
            let name = `Organization ${id}`;
            try {
              const orgRes = await axios.get<{ localizedName?: string }>(
                `${LINKEDIN_API}/rest/organizations/${id}`,
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'LinkedIn-Version': LINKEDIN_VERSION,
                    'X-Restli-Protocol-Version': '2.0.0',
                  },
                  timeout: 10_000,
                  proxy: false,
                },
              );
              if (orgRes.data.localizedName) name = orgRes.data.localizedName;
            } catch {
              // Best-effort name lookup.
            }
            return { id, urn, name };
          }),
      );
    } catch {
      // Best-effort — org scopes may be absent for this workspace.
    }

    const common = {
      access_token: accessToken,
      refresh_token: t.refresh_token,
      expires_at: expiresAt,
    };
    const seedBody: SeedBody = {
      platform: 'linkedin',
      ...common,
      canonical_user_id: personId,
      handle: me.vanityName ?? displayName,
      metadata: {
        kind: 'member',
        person_urn: personUrn,
        vanity_name: me.vanityName ?? null,
        scopes,
        refresh_token_expires_at: t.refresh_token_expires_in
          ? new Date(Date.now() + t.refresh_token_expires_in * 1000).toISOString()
          : undefined,
      },
    };
    const extraSeedBodies: SeedBody[] = orgs.map((org) => ({
      platform: 'linkedin',
      ...common,
      canonical_user_id: org.id,
      handle: org.name,
      metadata: {
        kind: 'organization',
        organization_urn: org.urn,
        person_urn: personUrn,
        role: 'ADMINISTRATOR',
      },
    }));

    const preview = {
      handle: me.vanityName ?? displayName,
      name: displayName || undefined,
      extras: {
        person_id: personId,
        organizations: orgs.map((o) => o.name),
        refreshable: !!t.refresh_token,
        scopes,
      },
    };
    const sessionId = await putSession({
      kind: 'simple',
      platform: 'linkedin',
      seedBody,
      extraSeedBodies: extraSeedBodies.length > 0 ? extraSeedBodies : undefined,
      preview,
    });
    return { kind: 'confirm', platform: 'linkedin', sessionId, preview };
  },
};
```

Register: add `linkedin,` to the `PLATFORMS` record.

- [ ] **Step 7.3: OAuth route dispatcher**

In `app/api/oauth/[...slug]/route.ts`:
- `VALID_PLATFORMS` (line ~32): add `'linkedin'`.
- `redirectUriFor` (line ~103): add before `default`:
```ts
    case 'linkedin':
      return (
        env('LINKEDIN_REDIRECT_URI') ?? `${baseUrl}/api/oauth/callback/linkedin`
      );
```

- [ ] **Step 7.4: seed-confirm posts the org seeds too**

In `app/api/seed-confirm/route.ts`, replace the success path of the `try` block (keep error handling as-is):

```ts
  try {
    const seeded = await postToPocSeed(seedBody);
    // LinkedIn: organization accounts ride the same confirmation. Failures
    // are collected, not fatal — the member account is already seeded.
    const extraResults: Array<{ account_id: string; handle?: string }> = [];
    const extraErrors: string[] = [];
    for (const extra of session.extraSeedBodies ?? []) {
      try {
        const r = await postToPocSeed({
          ...extra,
          metadata: { ...(extra.metadata ?? {}), products },
          ...(context
            ? {
                workspace_id: context.workspaceId,
                end_user_id: context.endUserId,
                ...(context.environment === 'test' ? { is_test: true } : {}),
              }
            : {}),
        });
        extraResults.push({ account_id: r.account_id, handle: extra.handle });
      } catch (err) {
        extraErrors.push(
          `${extra.handle ?? extra.canonical_user_id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    await dropSession(parsed.data.sessionId);
    const response = NextResponse.json({
      account_id: seeded.account_id,
      sync_jobs_created: seeded.sync_jobs_created,
      products,
      platform: session.platform,
      preview: session.preview,
      opener_origin: context?.openerOrigin ?? null,
      ...(extraResults.length > 0 ? { extra_accounts: extraResults } : {}),
      ...(extraErrors.length > 0 ? { extra_errors: extraErrors } : {}),
    });
    if (contextSessionId) {
      await dropSession(contextSessionId);
      setContextCookie(response, null);
    }
    return response;
  } catch (err) {
```

- [ ] **Step 7.5: Type-check + existing connect-tool tests + commit**

Run: `cd connect-tool && npx tsc --noEmit`
Then run the repo's configured test runner (check `package.json` scripts — `shell-machine.test.ts` and `oauth-scopes.test.ts` exist).
Expected: clean types; existing tests PASS.

```bash
git add connect-tool/lib/ connect-tool/app/api/ connect-tool/app/connect/shell-machine.ts
git commit -m "feat(connect-tool): linkedin oauth flow — member + org discovery, multi-seed confirm"
```

---

### Task 8: connect-tool UI surfaces

**Files:**
- Modify: `connect-tool/app/connect/PlatformIcon.tsx`
- Modify: `connect-tool/app/connect/ConnectShell.tsx`
- Modify: `connect-tool/components/PlatformTile.tsx`
- Modify: `connect-tool/app/page.tsx`

- [ ] **Step 8.1: Brand icon**

In `PlatformIcon.tsx`, add to `BRAND`:

```ts
  linkedin: {
    label: 'LinkedIn', provider: 'LinkedIn', bg: '#0A66C2',
    glyph: f('M6.94 5a2 2 0 1 1-4-.002 2 2 0 0 1 4 .002zM7 8.48H3V21h4V8.48zm6.32 0H9.34V21h3.94v-6.57c0-3.66 4.77-4 4.77 0V21H22v-7.93c0-6.17-7.06-5.94-8.72-2.91l.04-1.68z'),
  },
```

- [ ] **Step 8.2: Chooser order + guidance**

In `ConnectShell.tsx` (line 8):
```ts
const ORDER: PlatformKey[] = ['instagram', 'facebook', 'youtube', 'tiktok', 'twitch', 'threads', 'linkedin'];
```
In `guidance()` (line ~244), before the generic `return`:
```ts
  if (p === 'linkedin') {
    return {
      title: 'Connect with LinkedIn',
      body: 'You’ll be asked to approve read access to your LinkedIn profile and analytics. Company Pages you administer are connected automatically.',
    };
  }
```

- [ ] **Step 8.3: Legacy operator home page tile**

In `components/PlatformTile.tsx`:
```ts
  key: 'facebook' | 'tiktok' | 'threads' | 'youtube' | 'twitch' | 'linkedin';
  ...
  accent: 'blue' | 'red' | 'cyan' | 'mint' | 'purple' | 'linkedin';
```
and in `ACCENT_HEX`:
```ts
  // LinkedIn brand blue.
  linkedin: '#0A66C2',
```

In `app/page.tsx`, append to the platform list (after the twitch entry):
```ts
    {
      key: 'linkedin',
      label: 'LinkedIn',
      subtitle: 'Member analytics + company pages',
      accent: 'linkedin',
      enabled:
        !!process.env.LINKEDIN_CLIENT_ID && !!process.env.LINKEDIN_CLIENT_SECRET,
      missing: !process.env.LINKEDIN_CLIENT_ID
        ? 'LINKEDIN_CLIENT_ID'
        : !process.env.LINKEDIN_CLIENT_SECRET
          ? 'LINKEDIN_CLIENT_SECRET'
          : undefined,
    },
```

- [ ] **Step 8.4: Build + commit**

Run: `cd connect-tool && npx tsc --noEmit && npm run build`
Expected: clean build.

```bash
git add connect-tool/app/ connect-tool/components/
git commit -m "feat(connect-tool): linkedin in connect modal + operator home"
```

---

### Task 9: Environment configuration

**Files:**
- Modify: `poc/.env`, `poc/.env.example`
- Modify: `connect-tool/.env`, `connect-tool/.env.example`

- [ ] **Step 9.1: poc env**

Append to `poc/.env` (real values) AND `poc/.env.example` (placeholders):

```
# LinkedIn (Camaleonic Analytics Connector app — Community Management API)
LINKEDIN_CLIENT_ID=77imsaod02ua2p
LINKEDIN_CLIENT_SECRET=__FILL_ME__
```

- [ ] **Step 9.2: connect-tool env**

Append to `connect-tool/.env` AND `connect-tool/.env.example`:

```
# LinkedIn OAuth. Redirect URI defaults to
# ${PUBLIC_BASE_URL}/api/oauth/callback/linkedin when empty — it must
# EXACTLY match a Redirect URL registered in the LinkedIn app's Auth tab.
LINKEDIN_CLIENT_ID=77imsaod02ua2p
LINKEDIN_CLIENT_SECRET=__FILL_ME__
LINKEDIN_REDIRECT_URI=
```

- [ ] **Step 9.3: Get the real secret from the operator**

The secret is NOT in the repo today (searched all .env files). **Ask Alex to paste the real `LINKEDIN_CLIENT_SECRET` into both `.env` files** before any OAuth test. Docker note (project memory): new env keys need `docker compose up -d --force-recreate`, not `restart`.

- [ ] **Step 9.4: Commit (example files only — never commit real .env)**

```bash
git add poc/.env.example connect-tool/.env.example
git commit -m "docs: linkedin env keys in .env.example"
```

---

### Task 10: Verification

- [ ] **Step 10.1: Full type-checks + targeted tests**

```bash
cd poc && npx tsc --noEmit && npx jest linkedin products.catalog --no-coverage
cd ../connect-tool && npx tsc --noEmit && npm run build
```
Expected: all clean/PASS. (Per project memory: do NOT run poc full `npm test` — it OOMs the machine.)

- [ ] **Step 10.2: Boot the stack and check the catalog propagates**

Run the local poc + connect-tool (existing dev compose / npm scripts). Then:
```bash
curl -s http://localhost:3000/internal/products-catalog | jq '.catalog.linkedin'
```
Expected: the 3 LinkedIn products. Open `http://localhost:3002/` — LinkedIn tile visible and enabled (after secret filled). Open the local /connect preview (project memory: verify pre-connect screens there, not via real OAuth) — LinkedIn button renders with brand blue.

- [ ] **Step 10.3: Live OAuth end-to-end (requires real secret + registered redirect URL)**

1. Confirm with Alex which redirect URLs are registered in the LinkedIn portal; set `LINKEDIN_REDIRECT_URI` if it isn't `${PUBLIC_BASE_URL}/api/oauth/callback/linkedin`.
2. Hit `http://localhost:3002/api/oauth/start/linkedin` → LinkedIn consent → confirm page should show member preview + organizations list.
3. Confirm seed → verify in admin: member account row + one row per org (`metadata.kind`).
4. Watch the first sync: `identity` populates profile (+`connectionsCount`), `audience` lands accountInsights, org `engagement_new` lands posts.
5. Check whether the token response carried `refresh_token` (preview `extras.refreshable`) — record the outcome; it decides whether the 60-day reauth path will be exercised in prod.

- [ ] **Step 10.4: Code review + clean tree**

Run the code-reviewer agent over the full diff; fix CRITICAL/HIGH findings. Verify `git status` shows only intentional changes (real `.env` files stay uncommitted).

---

## Self-review notes

- **Member posts gap** is by LinkedIn policy (`r_member_social` closed) — documented in catalog hint, support matrix, content fetcher, and adapter comment. Aggregates ship via `audience`.
- **Refresh-token uncertainty** handled both ways at every layer (exchange capture → cron branch → ensureFresh no-op without ciphertext).
- **Restli encoding** centralized in `linkedin-restli.ts` with tests; the client never uses axios `params`.
- **Daily IMPRESSION series → `videoViewsSeries`** is a documented canonical-shape trade-off (no generic daily views field exists).
- **`rawResponse` convention**: step 4.5 instructs verifying against the Twitch content mapper before finalizing.
- **Rate limits**: cadences sized so 1 member + 2 orgs ≈ 60 calls/day, well under the 500/day dev tier; the Redis buckets enforce the ceiling.
- Follow-ups intentionally out of scope: org logo/media URN decoration, member video analytics, `ConnectDiscoverSchema` linkedin support, sample-dashboard dedicated button, Standard Tier quota upgrade request.
