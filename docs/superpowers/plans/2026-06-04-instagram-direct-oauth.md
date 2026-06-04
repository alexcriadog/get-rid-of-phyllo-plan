# Instagram Direct OAuth (Instagram Business Login) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Instagram API with Instagram Login" (IG Direct) as a second, feature-flagged connection flow so IG professional accounts can connect WITHOUT a Facebook Page, alongside the existing FB-Login flow.

**Architecture:** connect-tool gets an internal OAuth surface `instagram_direct` (own PlatformDef, host `instagram.com` / `graph.instagram.com`) that is NOT exposed in the SDK — its callback seeds `platform: 'instagram'` + `metadata.oauth_flow: 'ig_direct'`. The POC keeps one `instagram` platform and branches only in two local places: the Graph base URL (per-call override through `PlatformAdapterContext.graphBaseUrl`) and token lifecycle (IG-direct tokens ARE refreshable via `ig_refresh_token`; FB-login Meta tokens are not). Rollout is opt-in via `IG_DIRECT_ENABLED=1` on connect-tool (doc §8 "Opción C").

**Tech Stack:** Next.js App Router (connect-tool), vitest; NestJS + Prisma + axios (poc), jest (targeted single-spec runs only — full `npm test` OOMs, see memory), `tsc --noEmit` for type validation.

**Reference:** `docs/instagram-direct-oauth.md` (strategy doc). Meta endpoints:
- Authorize: `https://www.instagram.com/oauth/authorize` (comma-separated `instagram_business_*` scopes)
- Code→token: `POST https://api.instagram.com/oauth/access_token` (form-urlencoded; payload may arrive nested under `data[0]` — handle both shapes)
- Long-lived: `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token`
- Refresh: `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token` (token must be ≥24h old and unexpired)
- API base: `https://graph.instagram.com/v22.0`

**New env (connect-tool/.env):** `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_REDIRECT_URI` (optional override), `IG_DIRECT_ENABLED=1`. The Instagram product inside the existing Meta app has its OWN app id/secret (≠ `META_APP_ID`).

**Things that do NOT change (verified in code):**
- Prisma schema — `Account.metadata Json?` carries `oauth_flow`; unique `(workspaceId, platform, canonicalUserId)` dedupes an IG connected via both flows.
- Webhook auto-subscribe — already gated on `input.platform === 'facebook'` (`admin.service.ts:2768`); IG-direct seeds never hit it. IG-object webhooks are app-level (App Dashboard config).
- `instagram.support-matrix.ts` — both flows hit the same IG endpoints/field sets.
- SDK public surface (`connect-tool/sdk/`) — embedders keep using `platform: 'instagram'`.

---

## Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd /Users/alexcriadogonzalez/Camaleonic/get-rid-of-phyllo
git checkout main && git pull && git checkout -b feat/ig-direct-oauth
```

---

## Task 1: IG-direct scope mapping (connect-tool lib)

The products catalog (`poc products.catalog.ts`, served over the wire) keys Instagram products by FB-Login scope names. The direct flow needs `instagram_business_*` names. Mapping lives in connect-tool next to `computeOAuthScopes` (catalog stays single-source-of-truth keyed by `instagram` — adding an `instagram_direct` catalog key would leak into workspace products config, which must stay per-platform, not per-flow).

**Files:**
- Modify: `connect-tool/lib/workspace-config.ts`
- Test: `connect-tool/lib/ig-direct-scopes.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `connect-tool/lib/ig-direct-scopes.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  computeOAuthScopes,
  platformReachableAtOAuthStart,
  toIgDirectScopes,
  type ProductsCatalog,
} from './workspace-config';

const CATALOG: ProductsCatalog = {
  platforms: ['facebook', 'instagram'],
  products: ['identity', 'audience', 'engagement_new', 'stories'],
  catalog: {
    instagram: [
      { id: 'identity', label: 'Profile', required: true, default: true, scopes: ['instagram_basic'] },
      { id: 'audience', label: 'Audience', default: true, scopes: ['instagram_manage_insights'] },
      { id: 'engagement_new', label: 'Posts + metrics', default: true, scopes: ['instagram_manage_insights', 'pages_manage_metadata'] },
      { id: 'stories', label: 'Stories', default: true, scopes: ['instagram_manage_insights', 'pages_manage_metadata'] },
    ],
  },
};

describe('toIgDirectScopes', () => {
  test('maps FB-login IG scope names to instagram_business_* equivalents', () => {
    expect(toIgDirectScopes(['instagram_basic', 'instagram_manage_insights'])).toEqual([
      'instagram_business_basic',
      'instagram_business_manage_insights',
    ]);
  });

  test('drops Page-scoped permissions that have no direct-flow counterpart', () => {
    expect(toIgDirectScopes(['instagram_basic', 'pages_manage_metadata', 'pages_show_list'])).toEqual([
      'instagram_business_basic',
    ]);
  });

  test('de-dupes after mapping', () => {
    expect(
      toIgDirectScopes(['instagram_manage_insights', 'instagram_manage_insights']),
    ).toEqual(['instagram_business_manage_insights']);
  });
});

describe('computeOAuthScopes for instagram_direct', () => {
  test('unrestricted workspace gets the full mapped IG scope set', () => {
    expect(computeOAuthScopes(CATALOG, null, 'instagram_direct').sort()).toEqual([
      'instagram_business_basic',
      'instagram_business_manage_insights',
    ]);
  });

  test('restricted workspace maps only the enabled instagram products', () => {
    const config = { instagram: ['identity'] };
    expect(computeOAuthScopes(CATALOG, config, 'instagram_direct')).toEqual([
      'instagram_business_basic',
    ]);
  });

  test('workspace without instagram yields only required-product scopes', () => {
    const config = { facebook: ['identity'] };
    // instagram key absent → products [], but `identity` is required → its scopes stay.
    expect(computeOAuthScopes(CATALOG, config, 'instagram_direct')).toEqual([
      'instagram_business_basic',
    ]);
  });
});

describe('platformReachableAtOAuthStart for instagram_direct', () => {
  test('reachable when workspace offers instagram', () => {
    expect(platformReachableAtOAuthStart({ instagram: ['identity'] }, 'instagram_direct')).toBe(true);
  });
  test('not reachable when workspace omits instagram', () => {
    expect(platformReachableAtOAuthStart({ facebook: ['identity'] }, 'instagram_direct')).toBe(false);
  });
  test('reachable when unrestricted (null config)', () => {
    expect(platformReachableAtOAuthStart(null, 'instagram_direct')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd connect-tool && npx vitest run lib/ig-direct-scopes.test.ts
```
Expected: FAIL — `toIgDirectScopes` is not exported.

- [ ] **Step 3: Implement in `connect-tool/lib/workspace-config.ts`**

Add after `fullScopesForPlatform` (around line 271):

```ts
// Scope-name mapping for the IG-direct OAuth surface ("Instagram API with
// Instagram Login"). The catalog's `instagram` entries carry FB-Login scope
// names; the direct flow uses the `instagram_business_*` equivalents.
// Page-scoped permissions have no Page in the direct flow and are dropped.
const IG_DIRECT_SCOPE_MAP: Record<string, string | null> = {
  instagram_basic: 'instagram_business_basic',
  instagram_manage_insights: 'instagram_business_manage_insights',
  instagram_manage_comments: 'instagram_business_manage_comments',
  pages_manage_metadata: null,
  pages_show_list: null,
  pages_read_engagement: null,
};

export function toIgDirectScopes(fbScopes: ReadonlyArray<string>): string[] {
  const out = new Set<string>();
  for (const s of fbScopes) {
    const mapped = Object.prototype.hasOwnProperty.call(IG_DIRECT_SCOPE_MAP, s)
      ? IG_DIRECT_SCOPE_MAP[s]
      : s;
    if (mapped) out.add(mapped);
  }
  return [...out];
}
```

In `computeOAuthScopes` (line 283), add a branch FIRST (before the `config === null` check):

```ts
  // IG-direct: same `instagram` product bucket as FB-login, different scope
  // names on the consent screen. Workspace config stays keyed by platform
  // ('instagram'), never by flow.
  if (platform === 'instagram_direct') {
    const fbNamed =
      config === null
        ? fullScopesForPlatform(catalog, 'instagram')
        : scopesForProducts(catalog, 'instagram', config.instagram ?? []);
    return toIgDirectScopes(fbNamed);
  }
```

In `platformReachableAtOAuthStart` (line 121), before the `facebook` branch:

```ts
  if (oauthPlatform === 'instagram_direct') {
    return Object.prototype.hasOwnProperty.call(config, 'instagram');
  }
```

- [ ] **Step 4: Run tests + typecheck**

```bash
cd connect-tool && npx vitest run lib/ig-direct-scopes.test.ts && npx tsc --noEmit
```
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add connect-tool/lib/workspace-config.ts connect-tool/lib/ig-direct-scopes.test.ts
git commit -m "feat(connect): IG-direct scope mapping + reachability for instagram_direct surface"
```

---

## Task 2: `instagram_direct` PlatformDef (connect-tool)

**Files:**
- Modify: `connect-tool/lib/platforms.ts`

Notes for the implementer:
- `PlatformKey` here (line 63) is the connect-tool INTERNAL union — widening it does NOT touch the SDK's own `PlatformKey` (`sdk/src/index.ts`) nor the UI's (`app/connect/shell-machine.ts`). Those stay unchanged.
- `SeedBody.platform` (lib/seed-client.ts) stays `'instagram'` — do NOT add `instagram_direct` there.
- The old `instagram` stub (lines 504-516, throws "use facebook") stays as-is; FB-login remains the default path.

- [ ] **Step 1: Add the host constants** (next to `META_AUTHORIZE`, ~line 36):

```ts
// Instagram API with Instagram Login ("Business Login"). Professional
// accounts connect with IG credentials — no Facebook account/Page needed.
// Separate product config inside the same Meta app, with its OWN app id.
const IG_DIRECT_AUTHORIZE = 'https://www.instagram.com/oauth/authorize';
const IG_DIRECT_TOKEN = 'https://api.instagram.com/oauth/access_token';
const IG_DIRECT_GRAPH = 'https://graph.instagram.com';
const IG_DIRECT_GRAPH_V = 'https://graph.instagram.com/v22.0';
```

- [ ] **Step 2: Widen the internal union** (line 63):

```ts
export type PlatformKey =
  | 'facebook'
  | 'instagram'
  | 'instagram_direct'
  | 'tiktok'
  | 'threads'
  | 'youtube'
  | 'twitch';
```

- [ ] **Step 3: Add the PlatformDef** (after the `instagram` stub, ~line 517):

```ts
// ─── Instagram direct (Instagram API with Instagram Login) ──────────────
// Internal OAuth surface only — the SDK/UI keep exposing 'instagram'. The
// seed this flow produces is platform 'instagram' + metadata.oauth_flow
// 'ig_direct', which tells the POC to route Graph calls to
// graph.instagram.com and to auto-refresh the token (ig_refresh_token).
const instagramDirect: PlatformDef = {
  key: 'instagram_direct',
  buildAuthorizeUrl(redirectUri, scopes) {
    const appId = requireEnv('INSTAGRAM_APP_ID');
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      // IG wants comma-separated scopes.
      scope: [...scopes].join(','),
      state: cryptoRandomState(),
    });
    return `${IG_DIRECT_AUTHORIZE}?${params.toString()}`;
  },
  async handleCallback(code, redirectUri) {
    const appId = requireEnv('INSTAGRAM_APP_ID');
    const appSecret = requireEnv('INSTAGRAM_APP_SECRET');

    // 1. Code → short-lived token. Business Login may nest the payload
    //    under data[0]; older shapes return it at the root. Accept both.
    type IgTokenPayload = {
      access_token?: string;
      user_id?: number | string;
      permissions?: string | string[];
    };
    const body = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    });
    const slRes = await axios.post<IgTokenPayload & { data?: IgTokenPayload[] }>(
      IG_DIRECT_TOKEN,
      body.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15_000,
      },
    );
    const sl = slRes.data?.data?.[0] ?? slRes.data;
    if (!sl?.access_token) {
      throw new Error('Instagram token exchange returned no access_token');
    }

    // 2. Short-lived → long-lived (60d). Unlike FB-login Meta tokens this
    //    one is then refreshable forever via ig_refresh_token (POC cron).
    const llRes = await axios.get<{ access_token: string; expires_in?: number }>(
      `${IG_DIRECT_GRAPH}/access_token`,
      {
        params: {
          grant_type: 'ig_exchange_token',
          client_secret: appSecret,
          access_token: sl.access_token,
        },
        timeout: 15_000,
      },
    );
    const accessToken = llRes.data.access_token;
    const expiresAt = llRes.data.expires_in
      ? new Date(Date.now() + llRes.data.expires_in * 1000).toISOString()
      : undefined;

    // 3. Discovery — one call, no Page picker. `user_id` is the IG
    //    professional account id (Graph node id); `id` is app-scoped.
    const meRes = await axios.get<{
      id?: string;
      user_id?: number | string;
      username?: string;
      name?: string;
      profile_picture_url?: string;
    }>(`${IG_DIRECT_GRAPH_V}/me`, {
      params: {
        fields: 'id,user_id,username,name,profile_picture_url',
        access_token: accessToken,
      },
      timeout: 15_000,
    });
    const me = meRes.data;
    const canonicalId = me.user_id != null ? String(me.user_id) : me.id;
    if (!canonicalId) {
      throw new Error('Instagram /me returned no user id');
    }

    const seedBody: SeedBody = {
      platform: 'instagram',
      access_token: accessToken,
      expires_at: expiresAt,
      canonical_user_id: canonicalId,
      handle: me.username,
      metadata: {
        oauth_flow: 'ig_direct',
        ig_business_account_id: canonicalId,
        ig_app_scoped_id: me.id,
        granted_permissions:
          typeof sl.permissions === 'string'
            ? sl.permissions.split(',')
            : sl.permissions,
      },
    };
    const sessionId = await putSession({
      kind: 'simple',
      platform: 'instagram',
      seedBody,
      preview: {
        handle: me.username,
        name: me.name,
        extras: { ig_user_id: canonicalId, flow: 'instagram_direct' },
      },
    });
    return {
      kind: 'confirm',
      platform: 'instagram',
      sessionId,
      preview: {
        handle: me.username,
        name: me.name,
        extras: { ig_user_id: canonicalId, flow: 'instagram_direct' },
      },
    };
  },
};
```

- [ ] **Step 4: Register it** in `PLATFORMS` (line 667):

```ts
export const PLATFORMS: Record<PlatformKey, PlatformDef> = {
  facebook,
  instagram,
  instagram_direct: instagramDirect,
  tiktok,
  threads,
  youtube,
  twitch,
};
```

- [ ] **Step 5: Typecheck + full connect-tool test suite** (widening `PlatformKey` can break `Record<PlatformKey, …>` consumers — fix any the compiler flags by adding an `instagram_direct` entry or excluding it explicitly):

```bash
cd connect-tool && npx tsc --noEmit && npx vitest run
```
Expected: PASS / no errors.

- [ ] **Step 6: Commit**

```bash
git add connect-tool/lib/platforms.ts
git commit -m "feat(connect): instagram_direct PlatformDef — IG Business Login OAuth flow"
```

---

## Task 3: OAuth dispatcher wiring (connect-tool)

**Files:**
- Modify: `connect-tool/app/api/oauth/[...slug]/route.ts`

- [ ] **Step 1: Allow the surface + feature flag.** Edit `VALID_PLATFORMS` (line 32):

```ts
const VALID_PLATFORMS = new Set<PlatformKey>([
  'facebook',
  'instagram_direct',
  'tiktok',
  'threads',
  'youtube',
  'twitch',
]);

// IG-direct is rolled out opt-in (doc §8 "Opción C"). Until the flag is on,
// the surface 404s exactly like an unknown platform.
function igDirectEnabled(): boolean {
  return process.env.IG_DIRECT_ENABLED === '1';
}
```

And right after the `VALID_PLATFORMS.has(platform)` check (line 184-186) add:

```ts
  if (platform === 'instagram_direct' && !igDirectEnabled()) {
    return new NextResponse(`Unknown platform: ${rawPlatform}`, { status: 404 });
  }
```

- [ ] **Step 2: redirect URI.** In `redirectUriFor` (line 100), add a case:

```ts
    case 'instagram_direct':
      return (
        env('INSTAGRAM_REDIRECT_URI') ??
        `${baseUrl}/api/oauth/callback/instagram_direct`
      );
```

- [ ] **Step 3: SDK-token claim check.** The token's `platforms` claim says `instagram`, not `instagram_direct`. Replace the check at line 213:

```ts
        // The SDK token speaks product platforms ('instagram'); map internal
        // OAuth surfaces back before checking the claim.
        const claimPlatform = platform === 'instagram_direct' ? 'instagram' : platform;
        if (claims.platforms && !claims.platforms.includes(claimPlatform)) {
          throw new Error(
            `Platform ${claimPlatform} not allowed by SDK token (allowed=${claims.platforms.join(',')})`,
          );
        }
```

`platformReachableAtOAuthStart` and `computeOAuthScopes` already handle `instagram_direct` (Task 1) — no further edits.

- [ ] **Step 4: Typecheck**

```bash
cd connect-tool && npx tsc --noEmit
```

- [ ] **Step 5: Manual smoke (no real OAuth).** Start the dev server and check gating:

```bash
cd connect-tool && npm run dev &
sleep 5
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/api/oauth/start/instagram_direct'   # expect 404 (flag off)
# restart with IG_DIRECT_ENABLED=1, then:
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/api/oauth/start/instagram_direct'   # expect 302 (to instagram.com, or error redirect if INSTAGRAM_APP_ID unset — also fine, proves routing)
```

- [ ] **Step 6: Commit**

```bash
git add 'connect-tool/app/api/oauth/[...slug]/route.ts'
git commit -m "feat(connect): route instagram_direct OAuth surface behind IG_DIRECT_ENABLED flag"
```

---

## Task 4: Connect UI — secondary "connect directly" action

UX decision: ONE Instagram tile; the direct flow appears as a secondary ghost button on the Instagram guidance step, only when the flag is on. No SDK change.

**Files:**
- Modify: `connect-tool/app/connect/ConnectShell.tsx`
- Modify: `connect-tool/app/connect/page.tsx`

- [ ] **Step 1: Thread the flag.** In `connect-tool/app/connect/page.tsx`, add the prop to the JSX (line 105):

```tsx
    <ConnectShell
      ws={ws}
      token={token}
      origin={validatedOrigin ?? ''}
      fixedPlatform={platform}
      theme={theme}
      accent={accent}
      brandTitle={branding?.title ?? 'Camaleonic'}
      brandLogo={brandLogo}
      initialConnections={connections}
      tokenError={error}
      offeredPlatforms={offered}
      platformUnavailable={platformUnavailable}
      igDirectEnabled={process.env.IG_DIRECT_ENABLED === '1'}
    />
```

- [ ] **Step 2: ConnectShell.** Add to `Props` (line 31):

```ts
  /** IG-direct (Instagram Business Login) rollout flag — shows the
   *  "connect without a Facebook Page" secondary action. */
  igDirectEnabled: boolean;
```

Change `login` (line 97) to accept the surface:

```ts
  function login(p: PlatformKey, direct = false) {
    const sp: string = direct && p === 'instagram' ? 'instagram_direct' : startPlatform(p);
    const qs = new URLSearchParams({ ws: props.ws, token: props.token, origin: props.origin, embed: '1' });
    const popup = window.open(`/api/oauth/start/${sp}?${qs.toString()}`, 'camaleonic-oauth', 'popup=yes,width=560,height=720');
```
(the rest of the function body is unchanged).

In the `guidance` step JSX (after the `cml-btn__row` div closing tag, line 225), add:

```tsx
            {platform === 'instagram' && props.igDirectEnabled && (
              <div className="cml-link-row">
                <button className="cml-ghost" disabled={connecting} onClick={() => login(platform, true)}>
                  No Facebook Page? Connect with Instagram directly
                </button>
              </div>
            )}
```

- [ ] **Step 3: Typecheck + visual check.** Per the connect-modal memory: verify via the local `/connect` preview (NOT real OAuth), both themes:

```bash
cd connect-tool && npx tsc --noEmit && IG_DIRECT_ENABLED=1 npm run dev
```
Open the local connect preview, navigate to Instagram → guidance step; the ghost button shows under "Continue with Facebook" in light and dark theme. With the flag off it must not render.

- [ ] **Step 4: Commit**

```bash
git add connect-tool/app/connect/ConnectShell.tsx connect-tool/app/connect/page.tsx
git commit -m "feat(connect): IG-direct secondary action on Instagram guidance step (flagged)"
```

---

## Task 5: POC — Graph host routing for IG-direct accounts

One branching point: `buildInstagramContext` sets `graphBaseUrl`; the chokepoint applies it per-request. Fetchers don't change.

**Files:**
- Create: `poc/src/modules/platforms/shared/meta-graph/ig-direct.ts`
- Modify: `poc/src/modules/platforms/shared/platform-adapter.port.ts:26-36`
- Modify: `poc/src/modules/platforms/shared/meta-graph/graph-client.ts:158-161`
- Modify: `poc/src/modules/platforms/instagram/instagram.context.ts`
- Test: `poc/src/modules/platforms/instagram/__tests__/ig-direct-context.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `poc/src/modules/platforms/instagram/__tests__/ig-direct-context.spec.ts`:

```ts
import { buildInstagramContext } from '../instagram.context';
import {
  IG_DIRECT_GRAPH_BASE,
  isIgDirect,
} from '../../shared/meta-graph/ig-direct';

describe('isIgDirect', () => {
  it('is true only for metadata.oauth_flow === "ig_direct"', () => {
    expect(isIgDirect({ oauth_flow: 'ig_direct' })).toBe(true);
    expect(isIgDirect({ oauth_flow: 'fb_login' })).toBe(false);
    expect(isIgDirect({})).toBe(false);
    expect(isIgDirect(undefined)).toBe(false);
    expect(isIgDirect(null)).toBe(false);
  });
});

describe('buildInstagramContext graph host routing', () => {
  it('FB-login accounts keep the default host (no graphBaseUrl)', () => {
    const ctx = buildInstagramContext('tok', '17841400000000000', {
      page_id: '123',
    });
    expect(ctx.graphBaseUrl).toBeUndefined();
    expect(ctx.pageId).toBe('123');
  });

  it('IG-direct accounts route to graph.instagram.com', () => {
    const ctx = buildInstagramContext('tok', '17841400000000000', {
      oauth_flow: 'ig_direct',
    });
    expect(ctx.graphBaseUrl).toBe(IG_DIRECT_GRAPH_BASE);
    expect(ctx.pageId).toBeUndefined();
    expect(ctx.igAccountId).toBe('17841400000000000');
  });
});
```

- [ ] **Step 2: Run it — must fail** (module doesn't exist):

```bash
cd poc && npx jest src/modules/platforms/instagram/__tests__/ig-direct-context.spec.ts
```
Expected: FAIL — cannot find `../../shared/meta-graph/ig-direct`.

- [ ] **Step 3: Implement.** Create `poc/src/modules/platforms/shared/meta-graph/ig-direct.ts`:

```ts
// IG-direct ("Instagram API with Instagram Login") helpers.
//
// Accounts connected through the direct flow carry metadata.oauth_flow =
// 'ig_direct' (set by connect-tool's instagram_direct PlatformDef). Their
// tokens only work against graph.instagram.com — graph.facebook.com rejects
// them — and, unlike FB-login Meta tokens, they ARE refreshable
// (grant_type=ig_refresh_token, see InstagramDirectTokenRefreshService).

export const IG_DIRECT_GRAPH_BASE = 'https://graph.instagram.com/v22.0';

export function isIgDirect(
  metadata?: Record<string, unknown> | null,
): boolean {
  return !!metadata && metadata['oauth_flow'] === 'ig_direct';
}
```

In `poc/src/modules/platforms/shared/platform-adapter.port.ts`, extend the context interface (line 26):

```ts
export interface PlatformAdapterContext {
  tokenHash?: string;
  pageId?: string;
  channelId?: string;
  /**
   * IG Business Account id when the call is operating against an IG asset.
   * Used by RateLimitStrategy.bucKeys to build the `asset:{id}` Redis key
   * the BUC mirror checks before admitting the call.
   */
  igAccountId?: string;
  /**
   * Per-call Graph base URL override. Set for IG-direct accounts
   * (metadata.oauth_flow === 'ig_direct') whose tokens only work against
   * graph.instagram.com. Absent → the client's default (graph.facebook.com).
   */
  graphBaseUrl?: string;
}
```

In `poc/src/modules/platforms/shared/meta-graph/graph-client.ts`, change the request (line 160):

```ts
      response = await this.http.get(opts.endpoint, {
        params,
        // IG-direct tokens live on a different Graph host (see ig-direct.ts).
        ...(opts.context.graphBaseUrl
          ? { baseURL: opts.context.graphBaseUrl }
          : {}),
      });
```

Replace `poc/src/modules/platforms/instagram/instagram.context.ts` with:

```ts
// Instagram-specific context builder. Phase E.
// Lifted from InstagramAdapter.context(). For IG the canonical id is the
// IG Business user id, NOT a page id; pageId comes via metadata.page_id
// only when the operator linked an IG account to a Page in seed data.
// IG-direct accounts (metadata.oauth_flow === 'ig_direct') have no Page and
// route every Graph call to graph.instagram.com via graphBaseUrl.

import type { PlatformAdapterContext } from '../shared/platform-adapter.port';
import { tokenHash } from '../shared/meta-graph';
import { IG_DIRECT_GRAPH_BASE, isIgDirect } from '../shared/meta-graph/ig-direct';

export function buildInstagramContext(
  accessToken: string,
  canonicalId: string,
  metadata?: Record<string, unknown>,
): PlatformAdapterContext {
  return {
    tokenHash: tokenHash(accessToken),
    pageId:
      metadata && typeof metadata['page_id'] === 'string'
        ? (metadata['page_id'] as string)
        : undefined,
    igAccountId: canonicalId,
    graphBaseUrl: isIgDirect(metadata) ? IG_DIRECT_GRAPH_BASE : undefined,
  };
}
```

- [ ] **Step 4: Run test + typecheck**

```bash
cd poc && npx jest src/modules/platforms/instagram/__tests__/ig-direct-context.spec.ts && npx tsc --noEmit
```
Expected: PASS, no type errors. (Do NOT run the full `npm test` — it OOMs; `tsc --noEmit` covers type safety.)

- [ ] **Step 5: Commit**

```bash
git add poc/src/modules/platforms/shared/meta-graph/ig-direct.ts \
  poc/src/modules/platforms/shared/platform-adapter.port.ts \
  poc/src/modules/platforms/shared/meta-graph/graph-client.ts \
  poc/src/modules/platforms/instagram/instagram.context.ts \
  poc/src/modules/platforms/instagram/__tests__/ig-direct-context.spec.ts
git commit -m "feat(poc): route IG-direct accounts to graph.instagram.com via per-call baseURL"
```

---

## Task 6: POC — skip Meta token normalization for IG-direct seeds

`seedAccount` runs `normalizeMetaToken` for every facebook/instagram seed; it calls `graph.facebook.com/me/accounts` (`accounts.service.ts:343`), which an IG-direct token cannot answer. Skip it — the direct token IS the final token (no page/user split).

**Files:**
- Modify: `poc/src/modules/accounts/accounts.service.ts:133-137`

- [ ] **Step 1: Edit.** Add the import at the top of the file:

```ts
import { isIgDirect } from '@modules/platforms/shared/meta-graph/ig-direct';
```

Replace the `isMeta` computation (line 133):

```ts
    // IG-direct seeds carry a graph.instagram.com user token — there is no
    // Page token to normalize to and /me/accounts would reject the token.
    // The seed's access token is already the final long-lived credential.
    const igDirect = input.platform === 'instagram' && isIgDirect(input.metadata);
    const isMeta =
      !igDirect &&
      (input.platform === 'facebook' || input.platform === 'instagram');
```

(`metadataUserToken` below also keys off `isMeta`, which is correct — IG-direct has no user token.)

- [ ] **Step 2: Typecheck**

```bash
cd poc && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add poc/src/modules/accounts/accounts.service.ts
git commit -m "fix(poc): skip Page-token normalization for IG-direct seeds"
```

---

## Task 7: POC — IG-direct token refresh service

Mirror of `ThreadsTokenRefreshService` (same Meta long-lived-refresh shape: no separate refresh token; refresh the access token itself while still valid and ≥24h old).

**Files:**
- Create: `poc/src/modules/platforms/shared/instagram-api/instagram-direct-token-refresh.service.ts`
- Create: `poc/src/modules/platforms/shared/instagram-api/instagram-api.module.ts`

- [ ] **Step 1: Create the service:**

```ts
// IG-direct long-lived token refresh ("Instagram API with Instagram Login").
//
// IG-direct issues 60-day long-lived user tokens that — unlike FB-login Meta
// tokens — CAN be refreshed: `GET graph.instagram.com/refresh_access_token
// ?grant_type=ig_refresh_token&access_token=<long>` returns a NEW 60-day
// token. Constraints (same family as Threads):
//   - token must be long-lived already (connect-tool exchanges at seed time)
//   - older than 24h (non-issue: the cron refreshes with a 7-day lead on a
//     60-day token, so it's ~53 days old by then)
//   - not yet expired
//
// Invoked by TokenRefreshCronService for accounts where platform =
// 'instagram' AND metadata.oauth_flow = 'ig_direct'. FB-login IG accounts
// keep the legacy needs_reauth-on-expiry behaviour.

import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '@shared/database/prisma.service';
import { AesLocalService } from '@shared/crypto/aes-local.service';
import { TokenLifecycleEmitter } from '@modules/outbound-webhooks/token-lifecycle-emitter.service';

const IG_DIRECT_REFRESH_URL = 'https://graph.instagram.com/refresh_access_token';
const REFRESH_TIMEOUT_MS = 15_000;

interface IgDirectTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; code?: number; error_subcode?: number };
}

@Injectable()
export class InstagramDirectTokenRefreshService {
  private readonly logger = new Logger(InstagramDirectTokenRefreshService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aes: AesLocalService,
    private readonly lifecycle: TokenLifecycleEmitter,
  ) {}

  /**
   * Force-refresh the long-lived IG-direct token and persist the rotation.
   * Returns the new plaintext token. Throws on upstream rejection (the cron
   * logs + counts the failure and retries next hour).
   */
  async refresh(accountId: bigint, currentAccessToken: string): Promise<string> {
    const res = await axios.get<IgDirectTokenResponse>(IG_DIRECT_REFRESH_URL, {
      params: {
        grant_type: 'ig_refresh_token',
        access_token: currentAccessToken,
      },
      timeout: REFRESH_TIMEOUT_MS,
      validateStatus: () => true,
    });
    const body = res.data ?? {};
    if (res.status < 200 || res.status >= 300 || !body.access_token) {
      const errMsg = body.error?.message ?? `HTTP ${res.status}`;
      this.logger.error(
        `IG-direct refresh failed for account ${accountId.toString()}: ${errMsg}`,
      );
      await this.lifecycle.tokenRefreshFailed(accountId, { reason: errMsg });
      throw new Error(`IG-direct token refresh failed: ${errMsg}`);
    }
    const expiresInS = typeof body.expires_in === 'number' ? body.expires_in : 0;
    const expiresAt =
      expiresInS > 0 ? new Date(Date.now() + expiresInS * 1000) : null;
    const newAccessCipher = this.aes.encrypt(body.access_token);

    await this.prisma.oAuthToken.update({
      where: { accountId },
      data: {
        accessTokenCiphertext: newAccessCipher,
        expiresAt,
        lastRefreshedAt: new Date(),
      },
    });
    this.logger.log(
      `IG-direct token refreshed for account ${accountId.toString()}; expires_in=${expiresInS}s`,
    );
    await this.lifecycle.tokenRefreshed(accountId, { expiresAt });
    return body.access_token;
  }
}
```

- [ ] **Step 2: Create the module:**

```ts
import { Module } from '@nestjs/common';
import { OutboundWebhooksModule } from '@modules/outbound-webhooks/outbound-webhooks.module';
import { InstagramDirectTokenRefreshService } from './instagram-direct-token-refresh.service';

@Module({
  imports: [OutboundWebhooksModule],
  providers: [InstagramDirectTokenRefreshService],
  exports: [InstagramDirectTokenRefreshService],
})
export class InstagramApiModule {}
```

- [ ] **Step 3: Typecheck** — `cd poc && npx tsc --noEmit`. Expected: clean. (If `OutboundWebhooksModule` import style differs from threads-api's module, mirror `poc/src/modules/platforms/shared/threads-api/threads-api.module.ts` exactly.)

- [ ] **Step 4: Commit**

```bash
git add poc/src/modules/platforms/shared/instagram-api/
git commit -m "feat(poc): IG-direct token refresh service (ig_refresh_token)"
```

---

## Task 8: POC — wire IG-direct into the token-refresh cron

**Files:**
- Modify: `poc/src/modules/token-refresh/token-refresh.module.ts`
- Modify: `poc/src/modules/token-refresh/token-refresh.cron.service.ts`

- [ ] **Step 1: Module import.** In `token-refresh.module.ts` add to the imports array (and the ES import at the top):

```ts
import { InstagramApiModule } from '@modules/platforms/shared/instagram-api/instagram-api.module';
// …
  imports: [
    OutboundWebhooksModule,
    TikTokApiModule,
    TwitchApiModule,
    YoutubeApiModule,
    ThreadsApiModule,
    InstagramApiModule,
  ],
```

- [ ] **Step 2: Cron service.** In `token-refresh.cron.service.ts`:

Add imports:

```ts
import { InstagramDirectTokenRefreshService } from '@modules/platforms/shared/instagram-api/instagram-direct-token-refresh.service';
import { isIgDirect } from '@modules/platforms/shared/meta-graph/ig-direct';
```

Add the constructor dependency (after `threads`, line 85):

```ts
    private readonly igDirect: InstagramDirectTokenRefreshService,
```

Extend the scan query select (line 130) so the dispatcher can see the flow flag:

```ts
        account: { select: { platform: true, metadata: true } },
```

In the per-row loop, IG-direct must be classified BEFORE the `META` branch. Replace the `try` block's branching (lines 145-173) with:

```ts
      // IG-direct accounts are platform 'instagram' but behave like Threads:
      // long-lived token, refreshable while alive, 7-day lead.
      const igDirectRow =
        platform === 'instagram' &&
        isIgDirect(row.account.metadata as Record<string, unknown> | null);

      try {
        if (igDirectRow) {
          if (msToExpiry > THREADS_LEAD_MS) {
            result.skipped += 1;
            continue;
          }
          await this.igDirect.refresh(
            accountId,
            this.aes.decrypt(Buffer.from(row.accessTokenCiphertext)),
          );
          result.refreshed += 1;
          this.metrics.incr('token_refresh_cron_refreshed', {
            platform: 'instagram_direct',
          });
        } else if (REFRESHABLE.has(platform)) {
          const lead = platform === 'threads' ? THREADS_LEAD_MS : SHORT_LEAD_MS;
          if (msToExpiry > lead) {
            result.skipped += 1; // not due yet for this platform's window
            continue;
          }
          const did = await this.dispatchRefresh(platform, accountId, row);
          if (did) {
            result.refreshed += 1;
            this.metrics.incr('token_refresh_cron_refreshed', { platform });
          } else {
            result.skipped += 1;
          }
        } else if (META.has(platform)) {
          // Meta (FB-login) can't be refreshed; only act once the token is dead.
          if (expired) {
            await this.flagNeedsReauth(
              accountId,
              `${platform} token expired (proactive sweep) — re-authentication required`,
            );
            result.reauthFlagged += 1;
            this.metrics.incr('token_refresh_cron_reauth', { platform });
          } else {
            result.skipped += 1;
          }
        } else {
          result.skipped += 1;
        }
      } catch (err) {
```
(the `catch` block and everything after it are unchanged).

Also update the file-header comment block (lines 16-21) — replace the `facebook / instagram (Meta)` bullet with:

```
//   - facebook / instagram via FB-login (Meta): NOT refreshable — once
//     expired we flip the account to needs_reauth + fire token.expired.
//   - instagram via IG-direct (metadata.oauth_flow='ig_direct'): 60-day
//     long-lived token refreshable like Threads — 7-day lead, hourly retries.
```

- [ ] **Step 3: Typecheck**

```bash
cd poc && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add poc/src/modules/token-refresh/
git commit -m "feat(poc): auto-refresh IG-direct tokens in the hourly cron"
```

---

## Task 9: Docs

**Files:**
- Modify: `docs/instagram-direct-oauth.md` (status header)
- Modify: `docs/07-platforms/instagram.md`

- [ ] **Step 1:** In `docs/instagram-direct-oauth.md`, replace the `> **Estado**` block (lines 3-7) with:

```markdown
> **Estado**: IMPLEMENTADO tras decisión 2026-06-04 (rollout Opción C:
> feature flag `IG_DIRECT_ENABLED`, opt-in). Plan de implementación:
> `docs/superpowers/plans/2026-06-04-instagram-direct-oauth.md`.
> Lo de abajo se mantiene como análisis de contexto/decisión.
```

- [ ] **Step 2:** In `docs/07-platforms/instagram.md`, update the "Two distinct OAuth flows" intro (lines 6-7) to state that IG Direct is now a live, flagged flow: connect-tool surface `instagram_direct`, seeds `platform: 'instagram'` + `metadata.oauth_flow: 'ig_direct'`, Graph host `graph.instagram.com/v22.0`, auto-refresh via cron, no Page webhook subscription (IG-object webhooks are app-level). Keep wording consistent with that file's existing style.

- [ ] **Step 3: Commit**

```bash
git add docs/instagram-direct-oauth.md docs/07-platforms/instagram.md
git commit -m "docs: mark IG-direct OAuth as implemented (flagged rollout)"
```

---

## Task 10: Meta App config + sandbox validation (manual, blocking before flag-on)

No code. This gates enabling `IG_DIRECT_ENABLED=1` anywhere.

- [ ] **Step 1: App Dashboard.** In the existing Meta app: add/open the **Instagram** product → "API setup with Instagram login" → copy the **Instagram App ID** and **Instagram App Secret** (≠ the FB app id). Add the OAuth redirect URI: `<connect-tool public base>/api/oauth/callback/instagram_direct` (and the localhost equivalent for dev).
- [ ] **Step 2: Env.** Add to `connect-tool/.env` (dev first): `INSTAGRAM_APP_ID=…`, `INSTAGRAM_APP_SECRET=…`, `IG_DIRECT_ENABLED=1`. Production: same keys; remember the docker-compose env-reload gotcha — new keys need `up -d --force-recreate`, not `restart`.
- [ ] **Step 3: Sandbox validation checklist** (use a test IG professional account):
  1. Full flow: `/connect` → Instagram → "Connect with Instagram directly" → consent → confirm products → seeded account visible in admin with `metadata.oauth_flow = 'ig_direct'`.
  2. **Canonical-ID parity (critical):** connect the SAME IG account via FB-login in a scratch workspace and compare `canonical_user_id` with the IG-direct seed. If they match, the unique constraint dedupes cross-flow duplicates as designed. If they DON'T match, stop and revisit (the `/me` `user_id` vs `id` choice in Task 2 step 3 is the knob).
  3. Sync: trigger a profile + content sync for the IG-direct account; confirm calls hit `graph.instagram.com` (check `api_call_log` / raw archive) and data lands.
  4. Audience product: verify `/insights` demographics respond on the IG-direct token; if Meta gates any metric, mark the product off for that account rather than shipping silent failures.
  5. Refresh: manually set the token row's `expiresAt` to now+6d and run the cron once; confirm `token_refresh_cron_refreshed{platform="instagram_direct"}` increments and `expiresAt` moves ~60d out.
- [ ] **Step 4:** Record validation results (esp. #2 and #4) in `docs/instagram-direct-oauth.md` under a new "Validación sandbox 2026-06" heading.

---

## Self-review notes (already applied)

- **Cron ordering bug avoided:** IG-direct must be checked BEFORE the `META.has(platform)` branch — platform is `'instagram'` for both flows (Task 8 step 2 does this).
- **`normalizeMetaToken` would break IG-direct seeds** — Task 6 gates it; without that, every IG-direct seed dies calling `/me/accounts` on the wrong host.
- **Type ripple from widening `PlatformKey`** (connect-tool lib): the UI and SDK each have their OWN `PlatformKey` unions (`shell-machine.ts`, `sdk/src/index.ts`) — untouched. Task 2 step 5 catches any `Record<PlatformKey, …>` consumer the grep missed.
- **Token-response shape uncertainty** (`data[0]` vs root) handled defensively in Task 2; sandbox step 3.1 confirms.
- **Open question parked deliberately:** fetch-time `ensureFresh` for IG-direct (like Threads does in-adapter) is YAGNI for v1 — the hourly cron with a 7-day lead covers 60-day tokens with huge margin.
