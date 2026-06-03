# Per-Connection Product Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an integrating client (e.g. "Camaleonic Analytics") choose, per individual account connection, which subset of its workspace's enabled products to activate — so a "basic" connection requests fewer OAuth scopes and enrols fewer sync jobs than the workspace ceiling allows.

**Architecture:** Add an optional, signed `products` claim (shape `Record<platform, string[]>`) to the SDK token. The client's backend sets it at mint time (`POST /v1/sdk-tokens`), where it is validated to be a subset of the workspace allow-list (the ceiling). `connect-tool` reads the claim, **merges it over** the workspace `products` config to produce an _effective config_, and feeds that effective config into the existing consumers (`computeOAuthScopes`, `displayProducts`) — so OAuth scopes and the confirm/page-picker screens narrow automatically. The seed handlers clamp the final enrolment to the connection scope. The workspace ceiling is still independently enforced by POC `seedAccount()`, giving defence in depth.

**Why this shape:** the entire `connect-tool` flow already consumes a `ProductsConfig` (`Record<platform,string[]>`). Modelling the per-connection scope as "a narrower products config" reuses every existing code path instead of inventing a parallel one. Backward compatible: a token with no `products` claim behaves exactly as today.

**Tech Stack:** NestJS + Zod + ts-jest (POC backend); Next.js App Router + Vitest (connect-tool). HS256 JWT (hand-rolled, in `sdk-tokens.service.ts`).

**Trust model (decided):** the scope lives in the **signed JWT**, set by the client's backend via their API key. Self-service for the client, tamper-proof for the end user. The end user does not pick products in the UI; the confirm/page-picker screens show the scoped set read-only.

**Data-flow summary:**

```
client backend ──POST /v1/sdk-tokens {products:{facebook:['identity','audience']}}──▶ POC
   POC mint: buildConnectionProductScope(requested, ws.products)  // ⊆ ceiling or 400
   POC: sign JWT with claim  products:{facebook:['identity','audience']}
        │
        ▼  sdkToken (browser → CamaleonicConnect.init)
connect-tool /api/oauth/start:
   verify token → claims.products
   effective = intersectConnectionProducts(workspaceConfig, claims.products)
   scopes = computeOAuthScopes(catalog, effective, platform)   // fewer scopes
   putSession({..., connectionProducts: claims.products})
        │  OAuth round-trip
        ▼
callback: attachContext(session, {..., connectionProducts})
confirm / fb-pages page: displayProducts(effective, platform)  // scoped, read-only
seed-confirm / seed-pages: clampProductsToScope(productIds, scope[platform])
        │
        ▼  POST /admin/connect/seed {metadata.products}
POC seedAccount: enforceWorkspaceProducts(requested, ws.allowed)  // ceiling re-check
   → sync_jobs created only for the scoped products
```

---

## File Structure

**POC (backend) — new + modified:**
- Create: `poc/src/modules/sdk-tokens/connection-products.ts` — pure validator `buildConnectionProductScope`.
- Create: `poc/src/modules/sdk-tokens/__tests__/connection-products.spec.ts` — its unit tests.
- Modify: `poc/src/modules/sdk-tokens/sdk-tokens.service.ts` — `MintSdkTokenInput.connectionProducts`, `SdkTokenClaims.products`, emit claim in `mint()`.
- Modify: `poc/src/modules/sdk-tokens/sdk-tokens.controller.ts` — `MintBodySchema.products`, pass through.
- Modify: `poc/src/modules/sdk-tokens/__tests__/sdk-tokens.spec.ts` — claim round-trip + validation tests.

**connect-tool — modified:**
- Modify: `connect-tool/lib/workspace-config.ts` — pure helpers `intersectConnectionProducts`, `clampProductsToScope`.
- Modify: `connect-tool/lib/workspace-config.test.ts` — their unit tests.
- Modify: `connect-tool/lib/oauth-context.ts` — `SdkTokenClaims.products`.
- Modify: `connect-tool/lib/session.ts` — `OAuthContextSession.connectionProducts`, `SessionContext.connectionProducts`.
- Modify: `connect-tool/app/api/oauth/[...slug]/route.ts` — store scope + compute effective config for scopes; pass scope at `attachContext`.
- Modify: `connect-tool/app/confirm/[platform]/page.tsx` — effective config for `lockedProducts`.
- Modify: `connect-tool/app/facebook/pages/page.tsx` — effective config for `lockedFb`/`lockedIg`.
- Modify: `connect-tool/app/api/seed-confirm/route.ts` — clamp to scope.
- Modify: `connect-tool/app/api/seed-pages/route.ts` — clamp to scope.

**Docs:**
- Modify: `connect-tool/sdk/README.md` — document the `products` mint field.

**Explicitly NOT changed:**
- The SDK client code (`connect-tool/sdk/src/index.ts`, `connect-tool/public/connect-sdk.js`) — the scope rides inside `sdkToken`; no new browser-facing option.
- POC `seedAccount()` / `enforceWorkspaceProducts()` — already enforces the workspace ceiling; connect-tool clamping handles the per-connection layer.
- Prisma schema — no new tables; `sync_jobs` rows remain the enrolment record.

---

## Task 1: POC — `buildConnectionProductScope` pure validator

**Files:**
- Create: `poc/src/modules/sdk-tokens/connection-products.ts`
- Test: `poc/src/modules/sdk-tokens/__tests__/connection-products.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `poc/src/modules/sdk-tokens/__tests__/connection-products.spec.ts`:

```typescript
import { BadRequestException } from '@nestjs/common';
import { buildConnectionProductScope } from '../connection-products';

// Workspace ceiling used across cases.
const WS = {
  facebook: ['identity', 'audience', 'engagement_new', 'ads'],
  instagram: ['identity', 'audience'],
  tiktok: ['identity', 'audience'],
};

describe('buildConnectionProductScope', () => {
  it('returns the requested subset with identity injected first', () => {
    const out = buildConnectionProductScope(
      { facebook: ['audience'] },
      WS,
    );
    expect(out).toEqual({ facebook: ['identity', 'audience'] });
  });

  it('treats an empty product list as identity-only (the "basic" case)', () => {
    const out = buildConnectionProductScope({ facebook: [] }, WS);
    expect(out).toEqual({ facebook: ['identity'] });
  });

  it('drops a duplicate identity in the request and de-dupes products', () => {
    const out = buildConnectionProductScope(
      { facebook: ['identity', 'audience', 'audience'] },
      WS,
    );
    expect(out).toEqual({ facebook: ['identity', 'audience'] });
  });

  it('keeps multiple platforms independently', () => {
    const out = buildConnectionProductScope(
      { facebook: ['audience'], tiktok: [] },
      WS,
    );
    expect(out).toEqual({
      facebook: ['identity', 'audience'],
      tiktok: ['identity'],
    });
  });

  it('throws when a requested product exceeds the workspace ceiling', () => {
    expect(() =>
      buildConnectionProductScope({ facebook: ['ads', 'audience'] }, {
        facebook: ['identity', 'audience'], // no ads in ceiling
      }),
    ).toThrow(BadRequestException);
  });

  it('throws when a platform is not offered by the workspace', () => {
    expect(() =>
      buildConnectionProductScope({ youtube: ['audience'] }, WS),
    ).toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd poc && npx jest src/modules/sdk-tokens/__tests__/connection-products.spec.ts`
Expected: FAIL — `Cannot find module '../connection-products'`.

> NOTE (per project memory): the full `npm test` suite is heavy (ts-jest full type-check OOMs the machine). Always run a **single targeted spec file** as above. If even one file OOMs, append an isolatedModules transform override:
> `cd poc && npx jest --config '{"preset":"ts-jest","rootDir":"src","testEnvironment":"node","testMatch":["**/__tests__/**/*.spec.ts"],"moduleNameMapper":{"^@/(.*)$":"<rootDir>/$1","^@shared/(.*)$":"<rootDir>/shared/$1","^@modules/(.*)$":"<rootDir>/modules/$1"},"transform":{"^.+\\\\.ts$":["ts-jest",{"tsconfig":"<rootDir>/../tsconfig.json","isolatedModules":true}]}}' src/modules/sdk-tokens/__tests__/connection-products.spec.ts`

- [ ] **Step 3: Write the minimal implementation**

Create `poc/src/modules/sdk-tokens/connection-products.ts`:

```typescript
import { BadRequestException } from '@nestjs/common';

const IDENTITY = 'identity';

/**
 * Validate + normalise a client-requested per-connection product scope against
 * the workspace's allow-list (the ceiling). Used at SDK-token mint time so the
 * scope baked into the signed JWT can never exceed what the workspace permits.
 *
 * For each platform key in `requested`:
 *   - the platform MUST be offered by the workspace (a key in
 *     `workspaceProducts`) — else 400.
 *   - every requested product MUST be within the workspace allow-list for that
 *     platform — else 400 (the client is trying to widen past the ceiling).
 *   - `identity` is always injected first (it is required on every platform and
 *     the workspace allow-list always contains it post-Phase-C). An empty list
 *     therefore yields `['identity']` — the "basic, nothing else" connection.
 *
 * Returns the normalised map (identity-first, de-duped, request key order).
 * Platforms the client did NOT list are absent from the result — the connection
 * inherits the full workspace allow-list for those (the connect-tool consumer
 * merges this scope over the workspace config).
 */
export function buildConnectionProductScope(
  requested: Record<string, string[]>,
  workspaceProducts: Record<string, string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [platform, products] of Object.entries(requested)) {
    const allowed = workspaceProducts[platform];
    if (!allowed) {
      throw new BadRequestException(
        `Product scope references platform "${platform}" which is not enabled for this workspace`,
      );
    }
    const allowSet = new Set(allowed);
    const picked: string[] = [];
    for (const p of products) {
      if (p === IDENTITY) continue;
      if (!allowSet.has(p)) {
        throw new BadRequestException(
          `Product "${p}" is not enabled for platform "${platform}" in this workspace`,
        );
      }
      if (!picked.includes(p)) picked.push(p);
    }
    out[platform] = [IDENTITY, ...picked];
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd poc && npx jest src/modules/sdk-tokens/__tests__/connection-products.spec.ts`
Expected: PASS (6 passing).

- [ ] **Step 5: Commit**

```bash
git add poc/src/modules/sdk-tokens/connection-products.ts poc/src/modules/sdk-tokens/__tests__/connection-products.spec.ts
git commit -m "feat(sdk-tokens): add per-connection product scope validator"
```

---

## Task 2: POC — wire the `products` claim into mint + verify

**Files:**
- Modify: `poc/src/modules/sdk-tokens/sdk-tokens.service.ts`
- Test: `poc/src/modules/sdk-tokens/__tests__/sdk-tokens.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `poc/src/modules/sdk-tokens/__tests__/sdk-tokens.spec.ts` (the helper `makeService`, `baseInput`, `SECRET` already exist at the top of the file; reuse `SECRET`, `baseInput`, and the imported `WorkspaceView`/`WorkspacesService` types — the existing `makeService` sets `products: { tiktok: ['identity'] }`, so add a richer factory). Add this block at the end of the file:

```typescript
describe('SdkTokensService — per-connection products claim', () => {
  function makeRichService(): SdkTokensService {
    const view: WorkspaceView = {
      id: 'wkspc_demo',
      slug: 'demo',
      name: 'Demo',
      branding: null,
      products: {
        facebook: ['identity', 'audience', 'engagement_new', 'ads'],
        instagram: ['identity', 'audience'],
      },
      webhookCadence: null,
      allowedOrigins: undefined,
      planTier: 'standard',
    };
    const workspaces = {
      findById: jest.fn().mockResolvedValue(view),
      getSecret: jest.fn().mockResolvedValue(SECRET),
    } as unknown as WorkspacesService;
    return new SdkTokensService(workspaces);
  }

  it('embeds a validated products scope as a signed claim', async () => {
    const svc = makeRichService();
    const { token } = await svc.mint({
      ...baseInput,
      connectionProducts: { facebook: ['audience'] },
    });
    const claims = await svc.verify(token);
    expect(claims.products).toEqual({ facebook: ['identity', 'audience'] });
  });

  it('omits the products claim when none is requested', async () => {
    const svc = makeRichService();
    const { token } = await svc.mint(baseInput);
    const claims = await svc.verify(token);
    expect(claims.products).toBeUndefined();
  });

  it('rejects a scope that exceeds the workspace ceiling', async () => {
    const svc = makeRichService();
    await expect(
      svc.mint({
        ...baseInput,
        connectionProducts: { instagram: ['ads'] }, // ads not in IG ceiling
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd poc && npx jest src/modules/sdk-tokens/__tests__/sdk-tokens.spec.ts -t "per-connection products claim"`
Expected: FAIL — `connectionProducts` not accepted / `claims.products` undefined when it should be set.

- [ ] **Step 3: Write the minimal implementation**

In `poc/src/modules/sdk-tokens/sdk-tokens.service.ts`:

(a) Add the import near the top (after the `WorkspacesService` import on line 8):

```typescript
import { buildConnectionProductScope } from './connection-products';
```

(b) Extend `MintSdkTokenInput` — add this field after `allowedPlatforms?` (currently line 40):

```typescript
  /**
   * Optional per-connection product scope (Record<platform, string[]>), set by
   * the client at mint time. Validated ⊆ the workspace allow-list and embedded
   * as the signed `products` claim. Absent → connection inherits the full
   * workspace allow-list (legacy behaviour).
   */
  connectionProducts?: Record<string, string[]>;
```

(c) Extend `SdkTokenClaims` — add this field after `platforms?` (currently line 53):

```typescript
  /**
   * Per-connection product scope. Subset of the workspace allow-list, validated
   * at mint. connect-tool merges it over workspace.products to narrow OAuth
   * scopes and the products enrolled for THIS connection. Absent → full
   * workspace allow-list.
   */
  products?: Record<string, ReadonlyArray<string>>;
```

(d) In `mint()`, build the scope after the existing platform Gate #1 block (after line 136, before `const secret = ...`). The workspace view `ws` is already loaded above (line 113):

```typescript
    // Per-connection product scope (optional). Validate ⊆ workspace ceiling so
    // the signed claim can never widen past what the workspace allows.
    const connectionProducts =
      input.connectionProducts &&
      Object.keys(input.connectionProducts).length > 0
        ? buildConnectionProductScope(
            input.connectionProducts,
            ws.products as Record<string, string[]>,
          )
        : undefined;
```

(e) Add the claim to the `payload` object (after the `platforms` spread, currently lines 147-149):

```typescript
      ...(connectionProducts ? { products: connectionProducts } : {}),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd poc && npx jest src/modules/sdk-tokens/__tests__/sdk-tokens.spec.ts`
Expected: PASS (the new 3 + all pre-existing Sec-4 / platform tests).

- [ ] **Step 5: Commit**

```bash
git add poc/src/modules/sdk-tokens/sdk-tokens.service.ts poc/src/modules/sdk-tokens/__tests__/sdk-tokens.spec.ts
git commit -m "feat(sdk-tokens): embed per-connection products scope as a signed claim"
```

---

## Task 3: POC — accept `products` in the mint request body

**Files:**
- Modify: `poc/src/modules/sdk-tokens/sdk-tokens.controller.ts`

- [ ] **Step 1: Extend the request schema**

In `poc/src/modules/sdk-tokens/sdk-tokens.controller.ts`, replace `MintBodySchema` (lines 19-25) with:

```typescript
const MintBodySchema = z
  .object({
    user_id: z.string().min(1).max(256),
    ttl: z.number().int().min(60).max(1800).optional(),
    allowed_platforms: z.array(z.string().min(1)).max(6).optional(),
    // Per-connection product scope, Record<platform, productId[]>. Keys/values
    // are validated semantically against the workspace allow-list in the
    // service (buildConnectionProductScope); the schema only enforces shape.
    products: z
      .record(z.string().min(1), z.array(z.string().min(1)))
      .optional(),
  })
  .strict();
```

- [ ] **Step 2: Pass it through to the service**

In the same file, in the `mint()` handler, add `connectionProducts` to the `this.sdkTokens.mint({...})` call (after `allowedPlatforms: parsed.data.allowed_platforms,` — currently line 56):

```typescript
      connectionProducts: parsed.data.products,
```

- [ ] **Step 3: Type-check**

Run: `cd poc && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add poc/src/modules/sdk-tokens/sdk-tokens.controller.ts
git commit -m "feat(sdk-tokens): accept optional products scope in POST /v1/sdk-tokens"
```

---

## Task 4: connect-tool — `intersectConnectionProducts` + `clampProductsToScope`

**Files:**
- Modify: `connect-tool/lib/workspace-config.ts`
- Test: `connect-tool/lib/workspace-config.test.ts`

- [ ] **Step 1: Write the failing tests**

In `connect-tool/lib/workspace-config.test.ts`, extend the import at the top of the file:

```typescript
import {
  offeredPlatforms,
  displayProducts,
  platformReachableAtOAuthStart,
  intersectConnectionProducts,
  clampProductsToScope,
} from './workspace-config';
```

Then add at the end of the file:

```typescript
describe('intersectConnectionProducts', () => {
  const WS = {
    facebook: ['identity', 'audience', 'engagement_new', 'ads'],
    instagram: ['identity', 'audience'],
  };

  it('returns the workspace config unchanged when no scope is given', () => {
    expect(intersectConnectionProducts(WS, undefined)).toBe(WS);
    expect(intersectConnectionProducts(WS, {})).toBe(WS);
  });

  it('narrows only the platforms the scope lists, keeping the rest', () => {
    const eff = intersectConnectionProducts(WS, { facebook: ['audience'] });
    expect(eff).toEqual({
      facebook: ['identity', 'audience'],
      instagram: ['identity', 'audience'], // untouched
    });
  });

  it('drops scope products the workspace has since removed (defensive)', () => {
    const eff = intersectConnectionProducts(
      { facebook: ['identity', 'audience'] }, // ads tightened away after mint
      { facebook: ['audience', 'ads'] },
    );
    expect(eff).toEqual({ facebook: ['identity', 'audience'] });
  });

  it('uses the scope directly when workspace config is null (legacy)', () => {
    const eff = intersectConnectionProducts(null, { tiktok: ['audience'] });
    expect(eff).toEqual({ tiktok: ['identity', 'audience'] });
  });

  it('an empty scope list yields identity-only for that platform', () => {
    const eff = intersectConnectionProducts(WS, { facebook: [] });
    expect(eff && eff.facebook).toEqual(['identity']);
  });
});

describe('clampProductsToScope', () => {
  it('returns products unchanged when scope is undefined', () => {
    expect(clampProductsToScope(['identity', 'ads'], undefined)).toEqual([
      'identity',
      'ads',
    ]);
  });

  it('intersects products with the scope', () => {
    expect(
      clampProductsToScope(['identity', 'audience', 'ads'], [
        'identity',
        'audience',
      ]),
    ).toEqual(['identity', 'audience']);
  });

  it('guarantees identity even if the input omitted it', () => {
    expect(clampProductsToScope(['audience'], ['identity', 'audience'])).toEqual(
      ['identity', 'audience'],
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd connect-tool && npx vitest run lib/workspace-config.test.ts`
Expected: FAIL — `intersectConnectionProducts is not a function` / `clampProductsToScope is not a function`.

- [ ] **Step 3: Write the minimal implementation**

In `connect-tool/lib/workspace-config.ts`, add these two exported functions immediately after `displayProducts` (after its closing brace on line 50):

```typescript
/**
 * Merge a per-connection product scope (from the signed SDK token's `products`
 * claim) OVER the workspace config, narrowing ONLY the platforms the scope
 * lists. Platforms the scope omits keep the workspace allow-list unchanged.
 *
 * The scope was already validated ⊆ the workspace ceiling at mint time, but the
 * workspace may have been tightened since, so we intersect defensively here too
 * (a product dropped from the workspace after mint is removed from the effective
 * scope). identity is always kept first.
 *
 * - scope absent/empty → return `workspaceConfig` unchanged (same reference).
 * - workspaceConfig null (legacy unrestricted) → the scope becomes the effective
 *   config for the listed platforms (already ⊆ catalog by mint).
 *
 * The result is a normal `ProductsConfig`, so every existing consumer
 * (computeOAuthScopes, displayProducts, platformReachableAtOAuthStart) works
 * on it unchanged.
 */
export function intersectConnectionProducts(
  workspaceConfig: ProductsConfig,
  connectionProducts: Record<string, ReadonlyArray<string>> | undefined,
): ProductsConfig {
  if (!connectionProducts || Object.keys(connectionProducts).length === 0) {
    return workspaceConfig;
  }
  const base: Record<string, string[]> = { ...(workspaceConfig ?? {}) };
  for (const [platform, requested] of Object.entries(connectionProducts)) {
    const ceiling = workspaceConfig?.[platform];
    const allowSet = ceiling ? new Set(ceiling) : null;
    const picked: string[] = [];
    for (const p of requested) {
      if (p === 'identity') continue;
      if (allowSet && !allowSet.has(p)) continue; // workspace tightened since mint
      if (!picked.includes(p)) picked.push(p);
    }
    base[platform] = ['identity', ...picked];
  }
  return base;
}

/**
 * Clamp a product list to a per-connection scope. Used by the seed handlers so
 * a tampered productIds POST can never enrol a product the signed connection
 * scope didn't grant. identity is always preserved.
 *
 * - scope undefined → products returned unchanged (no per-connection scope).
 * - else → products ∩ scope, identity-first.
 */
export function clampProductsToScope(
  products: ReadonlyArray<string>,
  scope: ReadonlyArray<string> | undefined,
): string[] {
  if (!scope) return [...products];
  const allow = new Set(scope);
  const trimmed = products.filter((p) => allow.has(p));
  if (!trimmed.includes('identity') && allow.has('identity')) {
    trimmed.unshift('identity');
  }
  return trimmed;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd connect-tool && npx vitest run lib/workspace-config.test.ts`
Expected: PASS (all new + pre-existing resolver tests).

- [ ] **Step 5: Commit**

```bash
git add connect-tool/lib/workspace-config.ts connect-tool/lib/workspace-config.test.ts
git commit -m "feat(connect): add connection-scope merge + clamp helpers"
```

---

## Task 5: connect-tool — thread the scope through the type layer

**Files:**
- Modify: `connect-tool/lib/oauth-context.ts`
- Modify: `connect-tool/lib/session.ts`

- [ ] **Step 1: Add the claim to the connect-tool view of the token**

In `connect-tool/lib/oauth-context.ts`, in `SdkTokenClaims`, add after `platforms?` (currently line 22):

```typescript
  /**
   * Per-connection product scope (Record<platform, productId[]>), signed into
   * the SDK token by the client at mint time. Merged over workspace.products to
   * narrow OAuth scopes + enrolled products. Absent → full workspace allow-list.
   */
  products?: Record<string, ReadonlyArray<string>>;
```

- [ ] **Step 2: Add the scope to both session shapes**

In `connect-tool/lib/session.ts`:

(a) In `SessionContext` (the bag copied onto the result session at the callback), add after `workspaceSlug?` (currently line 43):

```typescript
  /** Per-connection product scope from the SDK token; clamps the seed enrol. */
  connectionProducts?: Record<string, ReadonlyArray<string>>;
```

(b) In `OAuthContextSession`, add after `allowedPlatforms?` (currently line 92):

```typescript
  /** Per-connection product scope (SDK token `products` claim). */
  connectionProducts?: Record<string, ReadonlyArray<string>>;
```

- [ ] **Step 3: Type-check**

Run: `cd connect-tool && npx tsc --noEmit`
Expected: no errors (fields are optional; nothing references them yet).

- [ ] **Step 4: Commit**

```bash
git add connect-tool/lib/oauth-context.ts connect-tool/lib/session.ts
git commit -m "feat(connect): carry per-connection product scope through token + session types"
```

---

## Task 6: connect-tool — apply the scope at `/api/oauth/start`

**Files:**
- Modify: `connect-tool/app/api/oauth/[...slug]/route.ts`

This is the key wiring step: store the scope on the context session, and feed the _effective_ config into `computeOAuthScopes` so the OAuth consent screen only asks for the scoped products' scopes.

- [ ] **Step 1: Import the merge helper**

In `connect-tool/app/api/oauth/[...slug]/route.ts`, add `intersectConnectionProducts` to the existing import from `workspace-config` (currently lines 23-29):

```typescript
import {
  computeOAuthScopes,
  fetchProductsCatalog,
  fetchWorkspaceProducts,
  intersectConnectionProducts,
  platformReachableAtOAuthStart,
  type ProductsConfig,
} from '../../../../lib/workspace-config';
```

- [ ] **Step 2: Capture the scope from the verified claims and store it on the session**

In the `action === 'start'` block, declare a scope variable alongside `productsConfig` (currently line 202 reads `let productsConfig: ProductsConfig = null;`). Add right after it:

```typescript
    let connectionProducts: Record<string, ReadonlyArray<string>> | undefined;
```

Then, inside the `if (ws && token)` try-block, set it from the verified claims. Add immediately after the `productsConfig = await fetchWorkspaceProducts(ws);` line (currently line 221):

```typescript
        connectionProducts = claims.products;
```

And add `connectionProducts` to the `putSession({ kind: 'oauth-context', ... })` call (after `allowedPlatforms: claims.platforms,` — currently line 245):

```typescript
          connectionProducts: claims.products,
```

- [ ] **Step 3: Compute the effective config for scope reduction**

Replace the scope computation line (currently line 264):

```typescript
    const scopes = computeOAuthScopes(catalog, productsConfig, platform);
```

with:

```typescript
    // Narrow to the per-connection scope (if the SDK token carried one) before
    // computing OAuth scopes — a "basic" connection then only asks the provider
    // for the scopes its scoped products need.
    const effectiveConfig = intersectConnectionProducts(
      productsConfig,
      connectionProducts,
    );
    const scopes = computeOAuthScopes(catalog, effectiveConfig, platform);
```

- [ ] **Step 4: Pass the scope onto the result session at the callback**

In the `action === 'callback'` block, the `attachContext(result.sessionId, {...})` call (currently lines 341-347) copies the tenant context onto the result session. Add `connectionProducts` to it (after `workspaceSlug: ctx.workspaceSlug,`):

```typescript
          connectionProducts: ctx.connectionProducts,
```

- [ ] **Step 5: Type-check**

Run: `cd connect-tool && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "connect-tool/app/api/oauth/[...slug]/route.ts"
git commit -m "feat(connect): scope OAuth consent to per-connection products + persist scope on session"
```

---

## Task 7: connect-tool — show the scoped products on the confirm + page-picker screens

**Files:**
- Modify: `connect-tool/app/confirm/[platform]/page.tsx`
- Modify: `connect-tool/app/facebook/pages/page.tsx`

Both server components currently compute `lockedProducts` from the workspace config. Switch them to the effective config (workspace ∩ connection scope) so the read-only "Included" list reflects exactly what this connection will enrol.

- [ ] **Step 1: Confirm page — use the effective config**

In `connect-tool/app/confirm/[platform]/page.tsx`:

(a) Add `intersectConnectionProducts` to the import from `workspace-config` (currently lines 9-14):

```typescript
import {
  fetchProductsCatalog,
  fetchWorkspaceProducts,
  displayProducts,
  defaultSelectedProducts,
  intersectConnectionProducts,
} from '../../../lib/workspace-config';
```

(b) Replace the three lines computing `lockedProducts` (currently lines 65-67):

```typescript
  const wsSlug = session?.ctx?.workspaceSlug ?? null;
  const cfg = wsSlug ? await fetchWorkspaceProducts(wsSlug) : null;
  const lockedProducts = displayProducts(cfg, platform); // string[] | null
```

with:

```typescript
  const wsSlug = session?.ctx?.workspaceSlug ?? null;
  const cfg = wsSlug ? await fetchWorkspaceProducts(wsSlug) : null;
  // Narrow to this connection's signed product scope (if any) so the picker
  // shows exactly what will be enrolled, not the full workspace ceiling.
  const effectiveCfg = intersectConnectionProducts(
    cfg,
    session?.ctx?.connectionProducts,
  );
  const lockedProducts = displayProducts(effectiveCfg, platform); // string[] | null
```

- [ ] **Step 2: Facebook page-picker — use the effective config**

In `connect-tool/app/facebook/pages/page.tsx`:

(a) Add `intersectConnectionProducts` to the import from `workspace-config` (currently lines 8-13):

```typescript
import {
  fetchProductsCatalog,
  fetchWorkspaceProducts,
  displayProducts,
  defaultSelectedProducts,
  intersectConnectionProducts,
} from '../../../lib/workspace-config';
```

(b) Replace the `lockedFb` / `lockedIg` computation (currently lines 61-62):

```typescript
  const lockedFb = displayProducts(cfg, 'facebook');   // string[] | null
  const lockedIg = displayProducts(cfg, 'instagram');  // string[] | null
```

with:

```typescript
  const effectiveCfg = intersectConnectionProducts(
    cfg,
    session?.ctx?.connectionProducts,
  );
  const lockedFb = displayProducts(effectiveCfg, 'facebook');   // string[] | null
  const lockedIg = displayProducts(effectiveCfg, 'instagram');  // string[] | null
```

- [ ] **Step 3: Type-check**

Run: `cd connect-tool && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "connect-tool/app/confirm/[platform]/page.tsx" connect-tool/app/facebook/pages/page.tsx
git commit -m "feat(connect): show per-connection scoped products on confirm + page picker"
```

---

## Task 8: connect-tool — clamp the seed enrolment to the scope

**Files:**
- Modify: `connect-tool/app/api/seed-confirm/route.ts`
- Modify: `connect-tool/app/api/seed-pages/route.ts`

Defence in depth: even though the UI submits the scoped set, clamp server-side so a tampered POST body can't enrol products outside the signed connection scope.

- [ ] **Step 1: seed-confirm — clamp `productIds` to the scope**

In `connect-tool/app/api/seed-confirm/route.ts`:

(a) Add `clampProductsToScope` to the import from `workspace-config` (currently lines 13-16):

```typescript
import {
  fetchProductsCatalog,
  requiredProducts,
  clampProductsToScope,
} from '../../../lib/workspace-config';
```

(b) Replace the `products` computation (currently lines 59-62):

```typescript
  const required = requiredProducts(catalog, session.platform);
  const products = Array.from(
    new Set([...required, ...parsed.data.productIds]),
  );
```

with (`session` is already loaded above and carries `ctx`):

```typescript
  const required = requiredProducts(catalog, session.platform);
  // Clamp to this connection's signed product scope (if any). A tampered
  // productIds body can never widen past it; the POC seedAccount() still
  // re-enforces the workspace ceiling on top of this.
  const scope = session.ctx?.connectionProducts?.[session.platform];
  const products = clampProductsToScope(
    Array.from(new Set([...required, ...parsed.data.productIds])),
    scope,
  );
```

- [ ] **Step 2: seed-pages — clamp FB + IG product lists to the scope**

In `connect-tool/app/api/seed-pages/route.ts`:

(a) Add `clampProductsToScope` to the import from `workspace-config` (currently lines 19-22):

```typescript
import {
  fetchProductsCatalog,
  defaultSelectedProducts,
  clampProductsToScope,
} from '../../../lib/workspace-config';
```

(b) Replace the `productsFb` / `productsIg` computation (currently lines 76-81):

```typescript
  const productsFb = parsed.data.productsFb?.length
    ? parsed.data.productsFb
    : defaultSelectedProducts(catalog, 'facebook');
  const productsIg = parsed.data.productsIg?.length
    ? parsed.data.productsIg
    : defaultSelectedProducts(catalog, 'instagram');
```

with:

```typescript
  const scopeFb = session.ctx?.connectionProducts?.facebook;
  const scopeIg = session.ctx?.connectionProducts?.instagram;
  const productsFb = clampProductsToScope(
    parsed.data.productsFb?.length
      ? parsed.data.productsFb
      : defaultSelectedProducts(catalog, 'facebook'),
    scopeFb,
  );
  const productsIg = clampProductsToScope(
    parsed.data.productsIg?.length
      ? parsed.data.productsIg
      : defaultSelectedProducts(catalog, 'instagram'),
    scopeIg,
  );
```

- [ ] **Step 3: Type-check**

Run: `cd connect-tool && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add connect-tool/app/api/seed-confirm/route.ts connect-tool/app/api/seed-pages/route.ts
git commit -m "feat(connect): clamp seed enrolment to the signed per-connection scope"
```

---

## Task 9: Docs — document the `products` mint field

**Files:**
- Modify: `connect-tool/sdk/README.md`

- [ ] **Step 1: Update the Quickstart mint example**

In `connect-tool/sdk/README.md`, replace the mint request body in Quickstart step 1:

```http
   { "user_id": "your-end-user-id", "ttl": 1800 }
```

with:

```http
   {
     "user_id": "your-end-user-id",
     "ttl": 1800,
     "allowed_platforms": ["facebook", "instagram"],
     "products": { "facebook": ["identity", "audience"], "instagram": ["identity"] }
   }
```

- [ ] **Step 2: Add a "Per-connection product scope" section**

Insert this section immediately before the `## Security` heading:

```markdown
## Per-connection product scope

By default a connection enrols every product your workspace has enabled for the
chosen platform. To scope an individual connection to a subset — e.g. a "basic"
account that needs no Ads data — pass `products` when minting the token:

​```http
POST /v1/sdk-tokens
Authorization: Bearer cmlk_live_xxx

{
  "user_id": "end-user-42",
  "products": { "facebook": ["identity", "audience"] }
}
​```

- Shape: `Record<platform, productId[]>`. `identity` is always included
  automatically — `{ "facebook": [] }` connects a profile-only account.
- The scope must be a **subset of your workspace's enabled products**; anything
  outside the workspace allow-list is rejected at mint with `400`.
- Only the platforms you list are narrowed. Platforms you omit keep the full
  workspace allow-list, so scope every platform you want to restrict.
- The scope is signed into the token — the end user cannot widen it. The OAuth
  consent screen then requests only the scopes those products need.
```

> NOTE: in the actual README the inner fenced block above uses normal triple
> backticks (the `​`-prefixed fences here are only to keep this plan's code block
> from terminating early). Write a normal ```` ```http ```` fence.

- [ ] **Step 3: Commit**

```bash
git add connect-tool/sdk/README.md
git commit -m "docs(sdk): document per-connection products scope on POST /v1/sdk-tokens"
```

---

## Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: POC targeted tests**

Run: `cd poc && npx jest src/modules/sdk-tokens/__tests__/connection-products.spec.ts src/modules/sdk-tokens/__tests__/sdk-tokens.spec.ts`
Expected: all PASS.

- [ ] **Step 2: POC type-check**

Run: `cd poc && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: connect-tool tests**

Run: `cd connect-tool && npx vitest run`
Expected: all PASS (existing + new workspace-config cases).

- [ ] **Step 4: connect-tool type-check + build**

Run: `cd connect-tool && npx tsc --noEmit && npm run build`
Expected: type-check clean; Next.js build succeeds.

- [ ] **Step 5: Manual smoke (local /connect preview — no real OAuth)**

Per project convention, verify the pre-connect / confirm screens via the local
`/connect` preview rather than a full OAuth round-trip:

1. Mint a test token locally with a narrow scope (e.g. `products: {"tiktok":["identity"]}`)
   against a workspace whose ceiling includes more tiktok products.
2. Open the connect modal and drive to the TikTok confirm screen (or use the
   preview harness used for the connect-iframe-modal work).
3. Confirm the "Included" list shows only `Profile` (identity) — not the full
   workspace set — and that the OAuth-start redirect URL's `scope` param is the
   reduced set (inspect via the network panel / start route).

Document the observed scoped behaviour in the PR description.

- [ ] **Step 6: Final commit / branch wrap-up**

If any verification step required a fix, commit it. Then use
`superpowers:finishing-a-development-branch` to decide merge/PR.

---

## Self-Review Notes

- **Spec coverage:** client-configurable per-connection subset (Tasks 1-3 mint + claim); secure/signed (Task 2 — JWT claim, validated ⊆ ceiling); fewer OAuth scopes for basic accounts (Task 6 — `computeOAuthScopes(effectiveConfig)`); enrolment narrowed (Task 8 — clamp → fewer `sync_jobs`); no involvement from the platform owner (self-service via the client's own API key — auth path unchanged). ✅
- **Backward compatibility:** every new field is optional; `intersectConnectionProducts(cfg, undefined)` returns `cfg` by reference; `clampProductsToScope(p, undefined)` returns `p`. Tokens without `products` behave exactly as today. ✅
- **Type consistency:** scope shape is `Record<string, string[]>` at mint input/validation (POC) and `Record<string, ReadonlyArray<string>>` as the read-only claim/session field (both repos). `buildConnectionProductScope` (POC) validates+throws; `intersectConnectionProducts` (connect-tool) merges; `clampProductsToScope` (connect-tool) intersects. Names match across all tasks. ✅
- **Defence in depth:** mint validates ⊆ ceiling → signed; connect-tool clamps seed to scope; POC `seedAccount` independently re-enforces the workspace ceiling. Three layers, no single point of trust. ✅
```
