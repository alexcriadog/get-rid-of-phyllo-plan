# Per-workspace platform + product configuration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each workspace define, per platform, which data products it offers (platform presence = availability); the connect flow then shows those products as a read-only list and seeds only them, with the POC enforcing the allow-list.

**Architecture:** A new nullable `Workspace.products` JSON column (`Record<platform, string[]>`, `null` = full catalog). The POC resolves + enforces it on `seedAccount`; the admin UI edits it; the internal workspace endpoint exposes it to connect-ui, which filters the chooser and renders a read-only product list. OAuth scopes are unchanged.

**Tech Stack:** NestJS + Prisma (MySQL) + Jest (poc), Next.js App Router (connect-tool + poc/web admin), Vitest (connect-tool unit).

**Spec:** `docs/superpowers/specs/2026-05-27-workspace-product-config-design.md`

**Product catalog (current `PRODUCTS_BY_PLATFORM`)** — the source of truth the config is a subset of:
- instagram: `identity, audience, engagement_new, stories`
- facebook: `identity, audience, engagement_new, stories, mentions, comments, ratings, ads`
- tiktok: `identity, audience, engagement_new, comments`
- threads: `identity, audience, engagement_new, comments, mentions`
- youtube: `identity, audience, engagement_new, engagement_deep` (confirm exact list in `accounts.service.ts` when implementing)
- twitch: `identity, engagement_new`

---

## File structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `poc/prisma/schema.prisma` | Modify | add `Workspace.products Json?` |
| `poc/prisma/migrations/*_add_workspace_products/migration.sql` | Create (via prisma) | column migration |
| `poc/src/modules/workspaces/workspaces.service.ts` | Modify | `WorkspaceView.products`, parse, `resolveProducts()` |
| `poc/src/modules/workspaces/workspace-products.ts` | Create | pure `resolveWorkspaceProducts()` |
| `poc/src/modules/workspaces/workspace-products.spec.ts` | Create | unit tests |
| `poc/src/modules/accounts/products.catalog.ts` | Create | extracted `PRODUCTS_BY_PLATFORM` |
| `poc/src/modules/accounts/accounts.service.ts` | Modify | enforce allow-list in `seedAccount` |
| `poc/src/modules/accounts/seed-products-enforcement.ts` | Create | pure intersection helper |
| `poc/src/modules/accounts/__tests__/seed-products-enforcement.spec.ts` | Create | enforcement unit test |
| `poc/src/modules/admin-saas/admin-saas.controller.ts` | Modify | `PATCH workspaces/:slug/products` + add `products` to detail GET |
| `poc/src/modules/workspaces/workspaces.controller.ts` | Modify | internal branding endpoint also returns `products` |
| `connect-tool/lib/session.ts` | Modify | `SessionContext.workspaceSlug` |
| `connect-tool/app/api/oauth/[...slug]/route.ts` | Modify | attach `workspaceSlug` to session ctx |
| `connect-tool/lib/workspace-config.ts` | Create | fetch config + resolve display products |
| `connect-tool/lib/workspace-config.test.ts` | Create | unit test for resolve |
| `connect-tool/app/connect/page.tsx` + `ConnectShell.tsx` | Modify | chooser filtered to offered platforms |
| `connect-tool/app/confirm/[platform]/page.tsx` + `client.tsx` | Modify | read-only product list |
| `connect-tool/app/facebook/pages/page.tsx` + `client.tsx` | Modify | read-only product list |
| `poc/web/pages/admin/workspaces/[slug].tsx` | Modify | Products editor card |

---

## Task 1: Add `Workspace.products` column + parse it

**Files:**
- Modify: `poc/prisma/schema.prisma`
- Modify: `poc/src/modules/workspaces/workspaces.service.ts`

- [ ] **Step 1: Add the column to the schema**

In `poc/prisma/schema.prisma`, in `model Workspace`, add after the `branding Json?` line:

```prisma
  // Per-workspace platform + product allow-list. Shape: Record<platform,string[]>.
  // null → all env-enabled platforms + full catalog (default). See spec.
  products  Json?
```

- [ ] **Step 2: Generate the migration**

Run: `cd poc && npx prisma migrate dev --name add_workspace_products`
Expected: creates `prisma/migrations/<ts>_add_workspace_products/migration.sql` containing `ALTER TABLE \`workspaces\` ADD COLUMN \`products\` JSON NULL;` and regenerates the Prisma client. (Requires the local dev DB: `docker compose up -d mysql`.)

- [ ] **Step 3: Surface `products` on `WorkspaceView`**

In `workspaces.service.ts`, add to `interface WorkspaceView` (after `branding`):

```ts
  products: Record<string, string[]> | null;
```

In `toView`, extend the row param type with `products: unknown;` and add to the returned object:

```ts
      products: this.parseProducts(row.products),
```

Add a parser next to `parseBranding`:

```ts
  private parseProducts(raw: unknown): Record<string, string[]> | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string');
    }
    return out;
  }
```

- [ ] **Step 4: Typecheck**

Run: `cd poc && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add poc/prisma/schema.prisma poc/prisma/migrations poc/src/modules/workspaces/workspaces.service.ts
git commit -m "feat(poc): add Workspace.products column + parse"
```

---

## Task 2: Pure product-resolution helper

**Files:**
- Create: `poc/src/modules/workspaces/workspace-products.ts`
- Create: `poc/src/modules/workspaces/workspace-products.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `poc/src/modules/workspaces/workspace-products.spec.ts`:

```ts
import { resolveWorkspaceProducts } from './workspace-products';

const CATALOG = {
  instagram: ['identity', 'audience', 'engagement_new', 'stories'],
  facebook: ['identity', 'audience', 'ads'],
} as Record<string, readonly string[]>;

describe('resolveWorkspaceProducts', () => {
  it('returns null (no restriction) when the workspace has no products config', () => {
    expect(resolveWorkspaceProducts(null, 'instagram', CATALOG)).toBeNull();
  });

  it('returns [] when the platform is not offered by the workspace', () => {
    expect(resolveWorkspaceProducts({ facebook: ['ads'] }, 'instagram', CATALOG)).toEqual([]);
  });

  it('always includes identity and filters to the platform catalog', () => {
    expect(
      resolveWorkspaceProducts(
        { instagram: ['audience', 'bogus', 'ads'] },
        'instagram',
        CATALOG,
      ),
    ).toEqual(['identity', 'audience']); // 'bogus'/'ads' not in IG catalog; identity prepended
  });

  it('identity-only when the platform is offered with an empty list', () => {
    expect(resolveWorkspaceProducts({ tiktok: [] }, 'tiktok', { tiktok: ['identity', 'audience'] })).toEqual(['identity']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd poc && npx jest src/modules/workspaces/workspace-products.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `poc/src/modules/workspaces/workspace-products.ts`:

```ts
/**
 * Resolve a workspace's product allow-list for one platform.
 *
 * @returns
 *   - `null`  → no restriction; caller uses the full platform catalog.
 *   - `[]`    → platform NOT offered by this workspace.
 *   - else    → ['identity', ...allowed-and-valid], identity always first.
 */
export function resolveWorkspaceProducts(
  config: Record<string, string[]> | null | undefined,
  platform: string,
  catalog: Record<string, readonly string[]>,
): string[] | null {
  if (config == null) return null;
  if (!Object.prototype.hasOwnProperty.call(config, platform)) return [];
  const valid = new Set(catalog[platform] ?? []);
  const picked = (config[platform] ?? []).filter((p) => valid.has(p) && p !== 'identity');
  return ['identity', ...picked];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd poc && npx jest src/modules/workspaces/workspace-products.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Extract the catalog + add `WorkspacesService.resolveProducts`**

`PRODUCTS_BY_PLATFORM` currently lives as a `const` inside `accounts.service.ts`. Extract it (pure move, no behavior change) into `poc/src/modules/accounts/products.catalog.ts`:

```ts
// Moved verbatim from accounts.service.ts — single source of truth for the
// per-platform product catalog. Import it back into accounts.service.ts.
export type Platform = 'facebook' | 'instagram' | 'youtube' | 'tiktok' | 'threads' | 'twitch';
export const PRODUCTS_BY_PLATFORM: Record<Platform, ReadonlyArray<string>> = {
  // ← paste the exact existing object from accounts.service.ts
};
```

In `accounts.service.ts`, replace the inline `const PRODUCTS_BY_PLATFORM = {...}` with `import { PRODUCTS_BY_PLATFORM, type Platform } from './products.catalog';`.

Then in `workspaces.service.ts` add (imports at top):

```ts
import { resolveWorkspaceProducts } from './workspace-products';
import { PRODUCTS_BY_PLATFORM } from '../accounts/products.catalog';
```

and a method:

```ts
  /** Resolve this workspace's allowed products for a platform (see helper). */
  async resolveProducts(workspaceId: string, platform: string): Promise<string[] | null> {
    const ws = await this.findById(workspaceId);
    return resolveWorkspaceProducts(ws.products, platform, PRODUCTS_BY_PLATFORM);
  }
```

- [ ] **Step 6: Typecheck**

Run: `cd poc && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add poc/src/modules/workspaces/workspace-products.ts poc/src/modules/workspaces/workspace-products.spec.ts poc/src/modules/workspaces/workspaces.service.ts poc/src/modules/accounts/products.catalog.ts poc/src/modules/accounts/accounts.service.ts
git commit -m "feat(poc): resolveWorkspaceProducts helper + WorkspacesService.resolveProducts"
```

---

## Task 3: Enforce the allow-list in `seedAccount`

**Files:**
- Create: `poc/src/modules/accounts/seed-products-enforcement.ts`
- Create: `poc/src/modules/accounts/__tests__/seed-products-enforcement.spec.ts`
- Modify: `poc/src/modules/accounts/accounts.service.ts`

- [ ] **Step 1: Write the failing test**

Create `poc/src/modules/accounts/__tests__/seed-products-enforcement.spec.ts`:

```ts
import { enforceWorkspaceProducts } from '../seed-products-enforcement';

describe('enforceWorkspaceProducts', () => {
  it('passes products through unchanged when there is no workspace restriction (null)', () => {
    expect(enforceWorkspaceProducts(['identity', 'audience', 'ads'], null)).toEqual(['identity', 'audience', 'ads']);
  });

  it('trims requested products to the allow-list', () => {
    expect(enforceWorkspaceProducts(['identity', 'audience', 'ads'], ['identity', 'audience'])).toEqual(['identity', 'audience']);
  });

  it('falls back to identity-only when the intersection is empty but identity is allowed', () => {
    expect(enforceWorkspaceProducts(['audience'], ['identity'])).toEqual(['identity']);
  });

  it('throws when the platform is not offered (allow-list is empty array)', () => {
    expect(() => enforceWorkspaceProducts(['identity'], [])).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd poc && npx jest src/modules/accounts/__tests__/seed-products-enforcement.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure helper**

Create `poc/src/modules/accounts/seed-products-enforcement.ts`:

```ts
import { BadRequestException } from '@nestjs/common';

/**
 * Intersect the products a caller requested with the workspace's allow-list.
 * - allowed === null → no restriction, return requested unchanged.
 * - allowed === []   → platform not offered → 400.
 * - else → requested ∩ allowed, guaranteeing identity is present.
 */
export function enforceWorkspaceProducts(
  requested: string[],
  allowed: string[] | null,
): string[] {
  if (allowed === null) return requested;
  if (allowed.length === 0) {
    throw new BadRequestException('This platform is not enabled for this workspace.');
  }
  const allowSet = new Set(allowed);
  const trimmed = requested.filter((p) => allowSet.has(p));
  if (!trimmed.includes('identity') && allowSet.has('identity')) trimmed.unshift('identity');
  return trimmed.length > 0 ? trimmed : ['identity'];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd poc && npx jest src/modules/accounts/__tests__/seed-products-enforcement.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire it into `seedAccount`**

In `accounts.service.ts`:
1. Inject `WorkspacesService` into the constructor (`AccountsModule` already imports `WorkspacesModule`; confirm `WorkspacesModule` exports `WorkspacesService`).
2. `import { enforceWorkspaceProducts } from './seed-products-enforcement';`
3. The method computes `products` then `const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;` lower down. Move the `workspaceId` line up to just after the `products` block, then add:

```ts
    // Per-workspace enforcement: a workspace may offer only a subset of the
    // platform catalog. Trim to its allow-list (defense in depth — the UI
    // already shows only these, but never trust the caller).
    const allowed = await this.workspaces.resolveProducts(workspaceId, input.platform);
    const enforcedProducts = enforceWorkspaceProducts(products, allowed);
```

Then in the SyncJob upsert loop, iterate `enforcedProducts` instead of `products` (`for (const product of enforcedProducts) { ... }`).

- [ ] **Step 6: Run the accounts suite**

Run: `cd poc && npx jest src/modules/accounts`
Expected: PASS. If an existing seed test constructs `AccountsService` without `WorkspacesService`, add a stub provider `{ provide: WorkspacesService, useValue: { resolveProducts: jest.fn().mockResolvedValue(null) } }` to that test module.

- [ ] **Step 7: Commit**

```bash
git add poc/src/modules/accounts/seed-products-enforcement.ts poc/src/modules/accounts/__tests__/seed-products-enforcement.spec.ts poc/src/modules/accounts/accounts.service.ts
git commit -m "feat(poc): enforce per-workspace product allow-list on seed"
```

---

## Task 4: Admin endpoint to set products + expose in detail GET

**Files:**
- Modify: `poc/src/modules/admin-saas/admin-saas.controller.ts`

- [ ] **Step 1: Add a Zod schema + PATCH handler (mirror branding)**

Near `BrandingSchema`, add:

```ts
const ProductsSchema = z.record(z.string(), z.array(z.string())).default({});
```

Add next to `updateBranding`:

```ts
  @Patch('workspaces/:slug/products')
  async updateProducts(
    @Param('slug') slug: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = ProductsSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid products payload',
        issues: parsed.error.issues,
      });
    }
    const ws = await this.workspaces.findBySlug(slug);
    const isClear = Object.keys(parsed.data).length === 0;
    await this.prisma.workspace.update({
      where: { id: ws.id },
      data: {
        products: isClear ? Prisma.JsonNull : (parsed.data as Prisma.InputJsonValue),
      },
    });
    return { slug, products: isClear ? null : parsed.data };
  }
```

- [ ] **Step 2: Add `products` to the workspace detail GET**

Find `@Get('workspaces/:slug')` in the same controller. Its response object includes `branding: ws.branding`. Add `products: ws.products,` alongside it (`ws` is the `WorkspaceView`, which carries `products` after Task 1).

- [ ] **Step 3: Typecheck**

Run: `cd poc && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add poc/src/modules/admin-saas/admin-saas.controller.ts
git commit -m "feat(poc): admin PATCH workspaces/:slug/products + products in detail"
```

---

## Task 5: Return `products` from the internal workspace endpoint

**Files:**
- Modify: `poc/src/modules/workspaces/workspaces.controller.ts`

- [ ] **Step 1: Extend the response**

Change `getBranding` to also return products (additive):

```ts
  @Get(':slug/branding')
  async getBranding(
    @Param('slug') slug: string,
  ): Promise<{ slug: string; branding: WorkspaceBranding | null; products: Record<string, string[]> | null }> {
    const ws = await this.workspaces.findBySlug(slug);
    return { slug: ws.slug, branding: ws.branding, products: ws.products };
  }
```

- [ ] **Step 2: Typecheck**

Run: `cd poc && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add poc/src/modules/workspaces/workspaces.controller.ts
git commit -m "feat(poc): internal branding endpoint also returns products"
```

---

## Task 6: Thread `workspaceSlug` onto the connect session context

**Files:**
- Modify: `connect-tool/lib/session.ts`
- Modify: `connect-tool/app/api/oauth/[...slug]/route.ts`

- [ ] **Step 1: Add `workspaceSlug` to `SessionContext`**

In `connect-tool/lib/session.ts`, in `interface SessionContext`, add:

```ts
  workspaceSlug?: string;
```

- [ ] **Step 2: Populate it at the callback**

In `connect-tool/app/api/oauth/[...slug]/route.ts`, the callback calls `attachContext(result.sessionId, { workspaceId: ctx.workspaceId, endUserId: ctx.endUserId, environment: ctx.environment, openerOrigin: ctx.openerOrigin })`. Add `workspaceSlug: ctx.workspaceSlug,` to that object (`ctx` is the `OAuthContextSession`, which already has `workspaceSlug`).

- [ ] **Step 3: Typecheck**

Run: `cd connect-tool && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add connect-tool/lib/session.ts "connect-tool/app/api/oauth/[...slug]/route.ts"
git commit -m "feat(connect-tool): carry workspaceSlug on the session context"
```

---

## Task 7: connect-ui workspace-config fetch + display resolver

**Files:**
- Create: `connect-tool/lib/workspace-config.ts`
- Create: `connect-tool/lib/workspace-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `connect-tool/lib/workspace-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { offeredPlatforms, displayProducts } from './workspace-config';

describe('workspace-config resolvers', () => {
  it('offeredPlatforms returns null (=all) when config is null', () => {
    expect(offeredPlatforms(null)).toBeNull();
  });
  it('offeredPlatforms returns the configured platform keys', () => {
    expect(offeredPlatforms({ instagram: ['audience'], tiktok: [] })).toEqual(['instagram', 'tiktok']);
  });
  it('displayProducts returns null (=full catalog) when config is null', () => {
    expect(displayProducts(null, 'instagram')).toBeNull();
  });
  it('displayProducts includes identity + the configured keys for the platform', () => {
    expect(displayProducts({ instagram: ['audience'] }, 'instagram')).toEqual(['identity', 'audience']);
  });
  it('displayProducts returns [] when platform is not offered', () => {
    expect(displayProducts({ facebook: ['ads'] }, 'instagram')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd connect-tool && npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `connect-tool/lib/workspace-config.ts`:

```ts
import axios from 'axios';

export type ProductsConfig = Record<string, string[]> | null;

/** Platforms a workspace offers, or null = all (no restriction). */
export function offeredPlatforms(config: ProductsConfig): string[] | null {
  if (config == null) return null;
  return Object.keys(config);
}

/**
 * Product keys to show (read-only) for a platform.
 * - null  → no restriction (caller uses the full catalog)
 * - []    → platform not offered
 * - else  → ['identity', ...configured] (identity always first, de-duped)
 */
export function displayProducts(config: ProductsConfig, platform: string): string[] | null {
  if (config == null) return null;
  if (!Object.prototype.hasOwnProperty.call(config, platform)) return [];
  const picked = (config[platform] ?? []).filter((p) => p !== 'identity');
  return ['identity', ...picked];
}

/** Server-only: fetch a workspace's products config from POC (null on any failure). */
export async function fetchWorkspaceProducts(slug: string): Promise<ProductsConfig> {
  const baseUrl = process.env.POC_API_URL;
  if (!baseUrl) return null;
  try {
    const res = await axios.get<{ products: ProductsConfig }>(
      `${baseUrl}/internal/workspaces/${encodeURIComponent(slug)}/branding`,
      { timeout: 5_000, proxy: false, validateStatus: () => true },
    );
    return res.status === 200 ? (res.data.products ?? null) : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd connect-tool && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add connect-tool/lib/workspace-config.ts connect-tool/lib/workspace-config.test.ts
git commit -m "feat(connect-tool): workspace product config fetch + resolvers"
```

---

## Task 8: Filter the chooser to offered platforms

**Files:**
- Modify: `connect-tool/app/connect/page.tsx`
- Modify: `connect-tool/app/connect/ConnectShell.tsx`

- [ ] **Step 1: Fetch config in the server page and pass offered platforms**

In `connect-tool/app/connect/page.tsx`:
- Import `{ fetchWorkspaceProducts, offeredPlatforms }` from `../../lib/workspace-config`.
- After the existing branding fetch, add:

```ts
  const productsConfig = await fetchWorkspaceProducts(ws);
  const platforms = offeredPlatforms(productsConfig); // string[] | null
```

- Pass `offeredPlatforms={platforms}` as a new prop to `<ConnectShell />`.

- [ ] **Step 2: Use it in the chooser**

In `connect-tool/app/connect/ConnectShell.tsx`:
- Add `offeredPlatforms: string[] | null;` to `Props`.
- The chooser maps over `ORDER`. Filter it:

```tsx
{ORDER.filter((p) => !props.offeredPlatforms || props.offeredPlatforms.includes(p)).map((p) => (
  // existing tile markup unchanged
))}
```

(When `offeredPlatforms` is null → all shown, as today.)

- [ ] **Step 3: Typecheck + tests**

Run: `cd connect-tool && npm run typecheck && npm test`
Expected: no type errors; tests pass.

- [ ] **Step 4: Commit**

```bash
git add connect-tool/app/connect/page.tsx connect-tool/app/connect/ConnectShell.tsx
git commit -m "feat(connect-tool): chooser shows only workspace-offered platforms"
```

---

## Task 9: Read-only product list in confirm + page-picker

**Files:**
- Modify: `connect-tool/app/confirm/[platform]/page.tsx`, `client.tsx`
- Modify: `connect-tool/app/facebook/pages/page.tsx`, `client.tsx`

The server page resolves the workspace's display products (via the session ctx's `workspaceSlug`) and passes a read-only list; the client renders it and seeds exactly those. `null` → keep the existing editable picker (unconfigured workspaces unchanged).

- [ ] **Step 1: Resolve the read-only list in the confirm server page**

In `connect-tool/app/confirm/[platform]/page.tsx`:
- Import `{ fetchWorkspaceProducts, displayProducts }` from `../../../lib/workspace-config`.
- After loading `session = getSimpleSession(sessionId)` (used by the redirect gate), add:

```ts
  const wsSlug = session.ctx?.workspaceSlug ?? null;
  const cfg = wsSlug ? await fetchWorkspaceProducts(wsSlug) : null;
  const lockedProducts = displayProducts(cfg, platform); // string[] | null
```

- Pass `lockedProducts={lockedProducts}` to `<ConfirmClient />`.

- [ ] **Step 2: Render read-only in ConfirmClient when locked**

In `connect-tool/app/confirm/[platform]/client.tsx`:
- Add `lockedProducts: string[] | null;` to `Props`; destructure it.
- Compute the submit set:

```ts
  const submitIds = lockedProducts ?? Array.from(picked);
```

and send `productIds: submitIds` in the `/api/seed-confirm` body.
- Render: when `lockedProducts` is non-null, replace the editable checkbox list with a read-only list (labels from `lib/products` `PRODUCT_CATALOG` via `products.find`):

```tsx
{lockedProducts ? (
  <div className="cml-list">
    {lockedProducts.map((id) => {
      const def = products.find((p) => p.id === id);
      return (
        <div key={id} className="cml-row">
          <div className="cml-row__meta">
            <div className="cml-row__name">{def?.label ?? id}</div>
            {def?.hint && <div className="cml-row__sub">{def.hint}</div>}
          </div>
          <span className="cml-status">Included</span>
        </div>
      );
    })}
  </div>
) : (
  /* existing editable checkbox list */
)}
```

The submit button label when locked: `Connect` (no count). Keep the existing button when not locked.

- [ ] **Step 3: Same for the Facebook page-picker**

In `connect-tool/app/facebook/pages/page.tsx`: resolve `const lockedFb = displayProducts(cfg, 'facebook')` and `const lockedIg = displayProducts(cfg, 'instagram')` (cfg from `getFbSession(sessionId).ctx?.workspaceSlug`), and pass both as props. In `client.tsx`: add `lockedFb`/`lockedIg: string[] | null`; when non-null render the FB/IG product panels read-only (same read-only list pattern) and submit `productsFb = lockedFb ?? Array.from(productsFb)`, `productsIg = lockedIg ?? Array.from(productsIg)`. Pages stay user-selectable.

- [ ] **Step 4: Typecheck**

Run: `cd connect-tool && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add connect-tool/app/confirm connect-tool/app/facebook
git commit -m "feat(connect-tool): read-only workspace product list at confirm + page picker"
```

---

## Task 10: Admin Products editor

**Files:**
- Modify: `poc/web/pages/admin/workspaces/[slug].tsx`

- [ ] **Step 1: Add a Products card (mirror BrandingSection)**

In `[slug].tsx`:
- Add `products?: Record<string, string[]> | null;` to the `WorkspaceDetail` type.
- Add a `ProductsSection` component and render it in the grid after `<BrandingSection />`. It reads `ws.products`, renders one row per platform with an **enable toggle** + product checkboxes (`identity` shown disabled+checked), and on Save calls `await adminPatch(\`/admin/workspaces/${slug}/products\`, payload)` where `payload: Record<platform, string[]>` includes only enabled platforms (arrays exclude `identity`). A "Clear" button sends `{}` (revert to defaults), then `onSaved()`.

Use this catalog constant inside the component:

```ts
const PRODUCT_CATALOG: Record<string, { id: string; label: string }[]> = {
  facebook: [{ id: 'identity', label: 'Profile' }, { id: 'audience', label: 'Audience' }, { id: 'engagement_new', label: 'Posts + metrics' }, { id: 'stories', label: 'Stories' }, { id: 'mentions', label: 'Tagged posts' }, { id: 'comments', label: 'Comments' }, { id: 'ratings', label: 'Page reviews' }, { id: 'ads', label: 'Ad insights' }],
  instagram: [{ id: 'identity', label: 'Profile' }, { id: 'audience', label: 'Audience' }, { id: 'engagement_new', label: 'Posts + metrics' }, { id: 'stories', label: 'Stories' }],
  youtube: [{ id: 'identity', label: 'Profile' }, { id: 'audience', label: 'Audience' }, { id: 'engagement_new', label: 'Videos + metrics' }, { id: 'engagement_deep', label: 'Per-video analytics' }],
  tiktok: [{ id: 'identity', label: 'Profile' }, { id: 'audience', label: 'Audience' }, { id: 'engagement_new', label: 'Posts + metrics' }, { id: 'comments', label: 'Comments' }],
  threads: [{ id: 'identity', label: 'Profile' }, { id: 'audience', label: 'Audience' }, { id: 'engagement_new', label: 'Posts + metrics' }, { id: 'comments', label: 'Comments' }, { id: 'mentions', label: 'Mentions' }],
  twitch: [{ id: 'identity', label: 'Profile' }, { id: 'engagement_new', label: 'Streams + metrics' }],
};
```

(Confirm the youtube ids against `accounts.service.ts` `PRODUCTS_BY_PLATFORM` when implementing.)

- [ ] **Step 2: Build the admin web**

Run: `cd poc/web && npm run build`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add poc/web/pages/admin/workspaces/\[slug\].tsx
git commit -m "feat(admin): per-workspace platform + product editor"
```

---

## Task 11: End-to-end verification

**Files:** none (verification)

- [ ] **Step 1:** Migrate + run POC locally (or rely on the prod deploy's `migrate deploy`). Confirm the `workspaces.products` column exists.

- [ ] **Step 2:** In the admin (`/admin/workspaces/demo`): offer Instagram with `audience` only (no `engagement_new`/`stories`) and disable some platforms. Save.

- [ ] **Step 3:** Open the host app's Connect:
  - Chooser shows only the offered platforms.
  - After OAuth, the confirm step shows a **read-only** list = `Profile, Audience` (no checkboxes).
  - Complete → verify (DB or `/v1/accounts/:id`) the account has only `identity` + `audience` sync jobs.

- [ ] **Step 4:** Enforcement — POST a seed with `metadata.products: ['identity','audience','ads']` for the configured workspace/platform → confirm `ads` is trimmed.

- [ ] **Step 5:** Backwards compat — a workspace with no products config → all platforms in the chooser, full editable picker, all catalog products available (unchanged).

- [ ] **Step 6:** Commit any fixes, then open a PR:

```bash
git push -u origin feat/workspace-product-config
gh pr create --fill --base main
```
