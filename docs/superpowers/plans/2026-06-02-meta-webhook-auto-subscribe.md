# Meta Webhook Auto-Subscribe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically subscribe a connected Meta Page (and its linked Instagram business account) to the app's webhooks during the connect/seed flow, so end-users get real-time events after connecting once — no manual Graph API steps.

**Architecture:** Add `pages_manage_metadata` to the relevant products in the POC catalog so it enters the OAuth consent automatically. Centralize the webhook field mapping in a new `meta-webhook-fields.ts` module (single source of truth for both inbound field→product routing and outbound product→Page-field subscription). A new `meta-webhook-subscribe.ts` module performs the non-blocking `POST /{page-id}/subscribed_apps` call. Wire it into `AdminService.seedConnection` after the account is persisted.

**Tech Stack:** NestJS, Prisma, Jest (`ts-jest`), axios (Graph calls), prom-style in-memory `MetricsService`.

---

## File Structure

- `poc/src/modules/webhooks/meta-webhook-fields.ts` — **new.** `FIELD_TO_PRODUCT` (moved here from the controller, with `ratings` added) + `PRODUCT_TO_PAGE_FIELDS` + `pageFieldsForProducts()`.
- `poc/src/modules/webhooks/__tests__/meta-webhook-fields.spec.ts` — **new.** Unit tests for the mapping.
- `poc/src/modules/webhooks/meta-webhook-subscribe.ts` — **new.** `subscribePageToApp()` (non-blocking subscribe).
- `poc/src/modules/webhooks/__tests__/meta-webhook-subscribe.spec.ts` — **new.** Unit tests for success/failure/skip.
- `poc/src/modules/webhooks/webhooks-ingest.controller.ts` — **modify.** Import `FIELD_TO_PRODUCT` from the new module; remove the local const.
- `poc/src/modules/accounts/products.catalog.ts` — **modify.** Add `pages_manage_metadata` to fb/ig webhook products.
- `poc/src/modules/accounts/__tests__/products.catalog.spec.ts` — **modify.** Update `LEGACY_FULL_SCOPES` + add scope assertion.
- `poc/src/modules/admin/admin.service.ts` — **modify.** Call `subscribePageToApp` in `seedConnection`; add `SUBSCRIBE_TIMEOUT_MS`.

All commands assume CWD `poc/` unless noted. Run a single test file with:
`npx jest <path> --runInBand`

---

## Task 1: Centralize webhook field mapping (`meta-webhook-fields.ts`)

**Files:**
- Create: `poc/src/modules/webhooks/meta-webhook-fields.ts`
- Test: `poc/src/modules/webhooks/__tests__/meta-webhook-fields.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `poc/src/modules/webhooks/__tests__/meta-webhook-fields.spec.ts`:

```ts
import {
  FIELD_TO_PRODUCT,
  pageFieldsForProducts,
} from '../meta-webhook-fields';

describe('FIELD_TO_PRODUCT', () => {
  it('routes engagement-style fields to engagement_new', () => {
    expect(FIELD_TO_PRODUCT['feed']).toBe('engagement_new');
    expect(FIELD_TO_PRODUCT['comments']).toBe('engagement_new');
    expect(FIELD_TO_PRODUCT['mentions']).toBe('engagement_new');
  });

  it('routes story fields to stories', () => {
    expect(FIELD_TO_PRODUCT['story_insights']).toBe('stories');
    expect(FIELD_TO_PRODUCT['stories']).toBe('stories');
  });

  it('routes ratings to the ratings product (not the default)', () => {
    expect(FIELD_TO_PRODUCT['ratings']).toBe('ratings');
  });
});

describe('pageFieldsForProducts', () => {
  it('maps engagement_new to feed/videos/live_videos', () => {
    expect(pageFieldsForProducts(['engagement_new']).sort()).toEqual(
      ['feed', 'live_videos', 'videos'].sort(),
    );
  });

  it('unions and dedupes across products (comments shares feed)', () => {
    const fields = pageFieldsForProducts([
      'engagement_new',
      'comments',
      'mentions',
      'ratings',
    ]);
    expect(fields.sort()).toEqual(
      ['feed', 'videos', 'live_videos', 'mentions', 'ratings'].sort(),
    );
  });

  it('returns [] for products with no Page webhook coverage', () => {
    expect(pageFieldsForProducts(['identity', 'audience', 'stories'])).toEqual(
      [],
    );
  });

  it('ignores unknown products', () => {
    expect(pageFieldsForProducts(['bogus'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/webhooks/__tests__/meta-webhook-fields.spec.ts --runInBand`
Expected: FAIL — `Cannot find module '../meta-webhook-fields'`.

- [ ] **Step 3: Write the module**

Create `poc/src/modules/webhooks/meta-webhook-fields.ts`:

```ts
// Single source of truth for the Meta webhook field <-> product mapping.
//
// Two directions, two distinct concerns:
//   - FIELD_TO_PRODUCT (inbound): a received webhook's `field` (Page OR
//     Instagram object) -> the internal product whose sync we enqueue.
//     Consumed by webhooks-ingest.controller.ts.
//   - PRODUCT_TO_PAGE_FIELDS (outbound): the products a user selected at
//     connect time -> the Page-object fields we subscribe via
//     POST /{page-id}/subscribed_apps. Page fields only; Instagram object
//     fields are configured app-level in the App Dashboard, not per-Page.

/**
 * Map Meta field names to internal product identifiers. `media`, `comments`,
 * `mentions`, `feed`, `videos`, `live_videos` resolve to `engagement_new`;
 * `story_insights`/`stories` to `stories`; `ratings` to `ratings`.
 */
export const FIELD_TO_PRODUCT: Readonly<Record<string, string>> = {
  media: 'engagement_new',
  comments: 'engagement_new',
  mentions: 'engagement_new',
  feed: 'engagement_new',
  videos: 'engagement_new',
  live_videos: 'engagement_new',
  story_insights: 'stories',
  stories: 'stories',
  ratings: 'ratings',
};

// Product -> Page webhook fields. Only products with Page-object coverage
// appear. `stories` has no Page story webhook field (IG-only, app-level), so
// it is intentionally absent.
const PRODUCT_TO_PAGE_FIELDS: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  engagement_new: ['feed', 'videos', 'live_videos'],
  mentions: ['mentions'],
  comments: ['feed'],
  ratings: ['ratings'],
};

/**
 * Deduplicated union of Page webhook fields for the given selected products.
 * Unknown products are ignored. Returns [] when nothing maps (the caller
 * skips the Meta subscribe call entirely).
 */
export function pageFieldsForProducts(
  products: ReadonlyArray<string>,
): string[] {
  const set = new Set<string>();
  for (const product of products) {
    const fields = PRODUCT_TO_PAGE_FIELDS[product];
    if (fields) {
      for (const field of fields) set.add(field);
    }
  }
  return [...set];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/modules/webhooks/__tests__/meta-webhook-fields.spec.ts --runInBand`
Expected: PASS (all assertions).

- [ ] **Step 5: Point the controller at the shared map**

In `poc/src/modules/webhooks/webhooks-ingest.controller.ts`, delete the local `FIELD_TO_PRODUCT` const (the block starting with the `/** Map Meta field names ... */` comment through the closing `};`, currently around lines 25-39) and import it instead. Add to the existing import group near the top (after the `MetricsService` import line):

```ts
import { FIELD_TO_PRODUCT } from './meta-webhook-fields';
```

Leave every usage of `FIELD_TO_PRODUCT` in the controller unchanged.

- [ ] **Step 6: Verify the controller still compiles + nothing else broke**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/webhooks/meta-webhook-fields.ts \
        src/modules/webhooks/__tests__/meta-webhook-fields.spec.ts \
        src/modules/webhooks/webhooks-ingest.controller.ts
git commit -m "feat(webhooks): centralize Meta field<->product map, route ratings"
```

---

## Task 2: Add `pages_manage_metadata` to the catalog

**Files:**
- Modify: `poc/src/modules/accounts/products.catalog.ts`
- Test: `poc/src/modules/accounts/__tests__/products.catalog.spec.ts`

- [ ] **Step 1: Update the test expectations (RED)**

In `poc/src/modules/accounts/__tests__/products.catalog.spec.ts`, update `LEGACY_FULL_SCOPES` so `facebook` and `instagram` include the new scope. Change the `facebook` array to add `'pages_manage_metadata'` and the `instagram` array likewise:

```ts
  facebook: [
    'pages_show_list',
    'pages_read_engagement',
    'pages_read_user_content',
    'ads_read',
    'business_management',
    'instagram_basic',
    'instagram_manage_insights',
    'read_insights',
    'pages_manage_metadata',
  ],
  instagram: ['instagram_basic', 'instagram_manage_insights', 'pages_manage_metadata'],
```

Then add a new test as a standalone `describe` at the end of the file (it references `PLATFORM_CATALOG` and `scopesForProducts`, both already imported at the top of the spec):

```ts
describe('pages_manage_metadata (webhook subscribe scope)', () => {
  const WEBHOOK_PRODUCTS = ['engagement_new', 'mentions', 'comments', 'stories'];

  it.each(['facebook', 'instagram'] as const)(
    'is present on every webhook-capable %s product',
    (platform) => {
      for (const def of PLATFORM_CATALOG[platform]) {
        if (WEBHOOK_PRODUCTS.includes(def.id)) {
          expect(def.scopes).toContain('pages_manage_metadata');
        }
      }
    },
  );

  it('is requested when a webhook product is selected', () => {
    expect(scopesForProducts('facebook', ['engagement_new'])).toContain(
      'pages_manage_metadata',
    );
  });

  it('is NOT requested for identity-only connections', () => {
    expect(scopesForProducts('facebook', [])).not.toContain(
      'pages_manage_metadata',
    );
  });
});
```

Note on `LEGACY_FULL_SCOPES`: the existing assertion in this spec compares `fullScopesForPlatform(platform)` against this array. `fullScopesForPlatform` returns scopes in catalog declaration order, deduped. After Step 3, `pages_manage_metadata` first appears on `engagement_new` (declared before `stories`/`mentions`/`comments`), so for `facebook` it lands at the position shown above only if the existing assertion sorts both sides. Check the existing assertion: if it is `expect([...actual].sort()).toEqual([...expected].sort())`, ordering is irrelevant — just add the element anywhere. If it is a strict ordered `toEqual`, place `pages_manage_metadata` to match declaration order (right after `pages_read_engagement` for facebook). Adjust in Step 4 if it fails.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/accounts/__tests__/products.catalog.spec.ts --runInBand`
Expected: FAIL — the new `pages_manage_metadata` assertions fail (scope not in catalog yet), and/or the `LEGACY_FULL_SCOPES` equality fails.

- [ ] **Step 3: Add the scope to the catalog**

In `poc/src/modules/accounts/products.catalog.ts`, add `'pages_manage_metadata'` to the `scopes` array of these four products under `facebook`:
- `engagement_new`: `scopes: ['pages_read_engagement', 'pages_manage_metadata']`
- `stories`: `scopes: ['pages_read_user_content', 'pages_manage_metadata']`
- `mentions`: `scopes: ['pages_read_user_content', 'pages_manage_metadata']`
- `comments`: `scopes: ['pages_read_user_content', 'pages_manage_metadata']`

And under `instagram`, add it to:
- `engagement_new`: `scopes: ['instagram_manage_insights', 'pages_manage_metadata']`
- `stories`: `scopes: ['instagram_manage_insights', 'pages_manage_metadata']`

(Instagram has no `mentions`/`comments` product entries, so only the two above.)

Do not touch `ratings` or `audience` (no webhook coverage).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/modules/accounts/__tests__/products.catalog.spec.ts --runInBand`
Expected: PASS.

If `LEGACY_FULL_SCOPES` strict-equality fails due to element ordering, wrap the expected and actual arrays in that one assertion with `[...arr].sort()` (or switch it to `expect.arrayContaining`). Re-run until green.

- [ ] **Step 5: Commit**

```bash
git add src/modules/accounts/products.catalog.ts \
        src/modules/accounts/__tests__/products.catalog.spec.ts
git commit -m "feat(catalog): request pages_manage_metadata for webhook products"
```

---

## Task 3: Non-blocking subscribe helper (`meta-webhook-subscribe.ts`)

**Files:**
- Create: `poc/src/modules/webhooks/meta-webhook-subscribe.ts`
- Test: `poc/src/modules/webhooks/__tests__/meta-webhook-subscribe.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `poc/src/modules/webhooks/__tests__/meta-webhook-subscribe.spec.ts`:

```ts
import { Logger } from '@nestjs/common';
import { subscribePageToApp } from '../meta-webhook-subscribe';

function makeDeps(post: jest.Mock) {
  const incr = jest.fn();
  const logger = new Logger('test');
  jest.spyOn(logger, 'log').mockImplementation(() => undefined);
  jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  return { deps: { post, metrics: { incr }, logger }, incr };
}

describe('subscribePageToApp', () => {
  const base = {
    platform: 'facebook',
    pageId: '104574205378123',
    fields: ['feed', 'mentions'],
    accessToken: 'PAGE_TOKEN',
  };

  it('POSTs to subscribed_apps and counts success', async () => {
    const post = jest
      .fn()
      .mockResolvedValue({ status: 200, data: { success: true } });
    const { deps, incr } = makeDeps(post);

    const result = await subscribePageToApp(deps, base);

    expect(result).toEqual({ subscribed: true });
    expect(post).toHaveBeenCalledTimes(1);
    const [url, params] = post.mock.calls[0];
    expect(url).toContain('/104574205378123/subscribed_apps');
    expect(params.subscribed_fields).toBe('feed,mentions');
    expect(params.access_token).toBe('PAGE_TOKEN');
    expect(incr).toHaveBeenCalledWith('webhook_subscribe_ok', {
      platform: 'facebook',
    });
  });

  it('never throws on a Graph error; counts failure', async () => {
    const post = jest.fn().mockRejectedValue(new Error('boom'));
    const { deps, incr } = makeDeps(post);

    const result = await subscribePageToApp(deps, base);

    expect(result.subscribed).toBe(false);
    expect(result.error).toContain('boom');
    expect(incr).toHaveBeenCalledWith('webhook_subscribe_failed', {
      platform: 'facebook',
    });
  });

  it('treats a non-2xx status as failure (no throw)', async () => {
    const post = jest
      .fn()
      .mockResolvedValue({ status: 400, data: { error: { message: 'bad' } } });
    const { deps, incr } = makeDeps(post);

    const result = await subscribePageToApp(deps, base);

    expect(result.subscribed).toBe(false);
    expect(incr).toHaveBeenCalledWith('webhook_subscribe_failed', {
      platform: 'facebook',
    });
  });

  it('skips the call entirely when there are no fields', async () => {
    const post = jest.fn();
    const { deps, incr } = makeDeps(post);

    const result = await subscribePageToApp(deps, { ...base, fields: [] });

    expect(result).toEqual({ subscribed: false });
    expect(post).not.toHaveBeenCalled();
    expect(incr).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/webhooks/__tests__/meta-webhook-subscribe.spec.ts --runInBand`
Expected: FAIL — `Cannot find module '../meta-webhook-subscribe'`.

- [ ] **Step 3: Write the module**

Create `poc/src/modules/webhooks/meta-webhook-subscribe.ts`:

```ts
import type { Logger } from '@nestjs/common';

// Graph version pinned to match the rest of the POC's Meta calls
// (admin.service.ts GRAPH_VERSION).
const GRAPH_VERSION = 'v22.0';

export interface SubscribePoster {
  (
    url: string,
    params: Record<string, string>,
  ): Promise<{ status: number; data: unknown }>;
}

export interface SubscribeMetrics {
  incr(name: string, labels?: Record<string, string>): void;
}

export interface SubscribeDeps {
  post: SubscribePoster;
  metrics: SubscribeMetrics;
  logger: Logger;
}

export interface SubscribeArgs {
  platform: string;
  pageId: string;
  fields: ReadonlyArray<string>;
  accessToken: string;
}

export interface SubscribeResult {
  subscribed: boolean;
  error?: string;
}

/**
 * Subscribe a Page to the app's webhooks via POST /{page-id}/subscribed_apps.
 *
 * Non-blocking by contract: NEVER throws. Failures (timeout, missing
 * permission, #200, rate limit, non-2xx) are logged + counted and returned as
 * { subscribed: false, error }. Subscribing the Page also activates delivery
 * for its linked Instagram business account (IG object fields are configured
 * app-level, not per-Page).
 */
export async function subscribePageToApp(
  deps: SubscribeDeps,
  args: SubscribeArgs,
): Promise<SubscribeResult> {
  if (args.fields.length === 0) {
    return { subscribed: false };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${args.pageId}/subscribed_apps`;
  try {
    const res = await deps.post(url, {
      subscribed_fields: [...args.fields].join(','),
      access_token: args.accessToken,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.data)}`);
    }
    deps.metrics.incr('webhook_subscribe_ok', { platform: args.platform });
    deps.logger.log(
      `Subscribed page ${args.pageId} to webhooks (${args.fields.join(',')})`,
    );
    return { subscribed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.metrics.incr('webhook_subscribe_failed', { platform: args.platform });
    deps.logger.warn(
      `Webhook subscribe failed for page ${args.pageId}: ${message}`,
    );
    return { subscribed: false, error: message };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/modules/webhooks/__tests__/meta-webhook-subscribe.spec.ts --runInBand`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add src/modules/webhooks/meta-webhook-subscribe.ts \
        src/modules/webhooks/__tests__/meta-webhook-subscribe.spec.ts
git commit -m "feat(webhooks): non-blocking Page subscribe helper"
```

---

## Task 4: Wire auto-subscribe into `seedConnection`

**Files:**
- Modify: `poc/src/modules/admin/admin.service.ts`

- [ ] **Step 1: Add the timeout constant**

In `poc/src/modules/admin/admin.service.ts`, next to the existing `const DISCOVER_TIMEOUT_MS = 15_000;` (around line 39), add:

```ts
const SUBSCRIBE_TIMEOUT_MS = 10_000;
```

- [ ] **Step 2: Import the helpers**

Add with the other `@modules/...` imports at the top of the file (the file already imports from `@modules/platforms/...`, so the alias resolves):

```ts
import { pageFieldsForProducts } from '@modules/webhooks/meta-webhook-fields';
import { subscribePageToApp } from '@modules/webhooks/meta-webhook-subscribe';
```

If `tsc` later reports the alias cannot resolve for these paths, switch to relative imports: `../webhooks/meta-webhook-fields` and `../webhooks/meta-webhook-subscribe`.

- [ ] **Step 3: Update the `seedConnection` return type**

Change the method's return type annotation from:

```ts
  ): Promise<{ account_id: string; sync_jobs_created: string[] }> {
```

to:

```ts
  ): Promise<{
    account_id: string;
    sync_jobs_created: string[];
    webhook_subscribed?: boolean;
  }> {
```

- [ ] **Step 4: Replace the final `return this.accountsService.seedAccount({...})`**

The method currently ends with `return this.accountsService.seedAccount({ ... });`. Replace that single `return` statement with the block below. It uses the local `accessToken` variable already in scope (it holds the Page token for facebook/instagram) and `this.metrics` / `this.logger` (both available on `AdminService`):

```ts
    const seeded = await this.accountsService.seedAccount({
      platform: input.platform,
      accessToken,
      refreshToken: input.refreshToken,
      expiresAt,
      canonicalUserId: input.canonicalUserId,
      handle: input.handle,
      metadata: input.metadata,
      workspaceId: resolvedWorkspaceId,
      endUserId: input.endUserId,
      isTest: input.isTest,
    });

    // Auto-subscribe the Page to the app's webhooks (non-blocking). This is
    // what makes real-time events flow after a one-time connect. Subscribing
    // the Page also activates delivery for its linked IG business account.
    let webhookSubscribed = false;
    if (input.platform === 'facebook' || input.platform === 'instagram') {
      const md = input.metadata ?? {};
      const pageId = typeof md.page_id === 'string' ? md.page_id : null;
      const products = Array.isArray(md.products)
        ? (md.products as unknown[]).filter(
            (p): p is string => typeof p === 'string',
          )
        : [];
      const fields = pageFieldsForProducts(products);
      if (pageId && fields.length > 0) {
        const result = await subscribePageToApp(
          {
            post: (url, params) =>
              axios
                .post(url, null, {
                  params,
                  timeout: SUBSCRIBE_TIMEOUT_MS,
                  validateStatus: () => true,
                })
                .then((r) => ({ status: r.status, data: r.data })),
            metrics: this.metrics,
            logger: this.logger,
          },
          {
            platform: input.platform,
            pageId,
            fields,
            accessToken,
          },
        );
        webhookSubscribed = result.subscribed;
      }
    }

    return { ...seeded, webhook_subscribed: webhookSubscribed };
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors. (If the `@modules/webhooks/...` alias fails to resolve, switch those two imports to the relative form from Step 2 and re-run.)

- [ ] **Step 6: Run the webhooks + accounts test scope**

Run: `npx jest src/modules/webhooks src/modules/accounts --runInBand`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/admin/admin.service.ts
git commit -m "feat(connect): auto-subscribe Meta Page webhooks on seed (non-blocking)"
```

---

## Task 5: Full build + test gate

**Files:** none (verification only).

- [ ] **Step 1: Full type check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all suites pass (no regressions in catalog, webhooks, or elsewhere).

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds, emits `dist/`.

- [ ] **Step 4: Commit (only if the build produced tracked changes, e.g. tsbuildinfo)**

```bash
git add -A
git commit -m "chore: build after webhook auto-subscribe" || echo "nothing to commit"
```

---

## Task 6: Deploy + manual verification (no code)

**Files:** none.

- [ ] **Step 1: Merge/deploy**

Push the branch and deploy with `./tools/deploy.sh` (SSHes to EC2, runs `redeploy.sh`). Both the POC `api` and `connect-tool` must be rebuilt/redeployed: the catalog change affects the consent scope served to connect-tool; the seed change affects the api.

- [ ] **Step 2: Reconnect one Meta account**

Existing accounts (ids 1, 2, 5, 7) were connected without `pages_manage_metadata`, so they have no subscription. Reconnect one Page through the connect flow to (a) re-consent with the new scope and (b) trigger the auto-subscribe.

- [ ] **Step 3: Confirm the subscription on Meta's side**

With a Page token that has `pages_manage_metadata`:
`GET https://graph.facebook.com/v22.0/{page-id}/subscribed_apps`
Expected: the app appears in the subscription list.

- [ ] **Step 4: Confirm real events land**

Trigger activity (or use the App Dashboard "Test" button for a field), then query prod:

```bash
docker compose -f poc/docker-compose.yml -f tools/docker-compose.prod.yml \
  exec -T mysql mysql -uconnector_user -pconnector_pw connector -e \
  "SELECT id, received_at, signature_valid, account_resolved, processed \
   FROM inbound_webhook_log WHERE platform='meta' ORDER BY received_at DESC LIMIT 10;"
```

Expected: a real event with `account_resolved=1` (proving `entry.id` matched `canonical_user_id`) and `processed=1`.

- [ ] **Step 5: Check the metrics**

Confirm `webhook_subscribe_ok` incremented on the api `/metrics` (private ops port 9464, scraped by the observability agent). A `webhook_subscribe_failed` with a `#200`/permission message means the reconnect did not actually grant `pages_manage_metadata` — re-check the consent.

---

## Self-Review

**Spec coverage:**
- Scope in catalog → Task 2. ✓
- Auto-subscribe in POC seed handler → Task 4. ✓
- Product→field mapping (derive from selected) → Task 1 (`pageFieldsForProducts`). ✓
- `ratings` added to `FIELD_TO_PRODUCT` → Task 1. ✓
- Non-blocking + metrics (`webhook_subscribe_ok`/`failed`) → Task 3, wired in Task 4. ✓
- Existing accounts must reconnect → Task 6 Step 2. ✓
- IG covered via Page subscription (app-level IG fields) → encoded in module comments + Page-only mapping. ✓
- Rate-limit non-issue → no code; documented in spec. ✓

**Placeholder scan:** none — every code step has full code; every command has expected output.

**Type consistency:** `subscribePageToApp(deps, args)` signature matches between Task 3 definition and Task 4 call site (`post`/`metrics`/`logger` deps; `platform`/`pageId`/`fields`/`accessToken` args). `pageFieldsForProducts(products: ReadonlyArray<string>): string[]` consistent between Task 1 and Task 4. Metric names `webhook_subscribe_ok`/`webhook_subscribe_failed` identical across Task 3 and Task 6. `FIELD_TO_PRODUCT` created in Task 1 and imported by the controller in the same task.
