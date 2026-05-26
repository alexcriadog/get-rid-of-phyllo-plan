# Phyllo-style in-page Connect modal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Connect SDK's `window.open` new-tab launch with an in-page iframe modal that hosts the full Phyllo-style flow (consent → chooser → connections → guidance → confirm → success), breaking out to a separate window only for the real provider login.

**Architecture:** The SDK injects a dimmed overlay + iframe pointing at a new `/connect` route. A client shell drives the pre-OAuth steps; "Login with X" opens the provider in a popup via `window.open`. The provider callback (when launched embedded) redirects the popup to a thin `/oauth/complete` relay page that `postMessage`s the sessionId back to the iframe and closes. The shell then **navigates the iframe** to the existing `/confirm` or `/facebook/pages` page in compact "embed" mode; `/success` posts the result up to the host SDK via `window.parent`. The OAuth engine, pickers, branding, and SDK-token verify are reused unchanged.

**Tech Stack:** Next.js App Router (connect-tool), NestJS + Prisma + Jest (poc), esbuild (SDK bundle), Vitest + jsdom (new connect-tool unit tests), Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-05-26-connect-iframe-modal-design.md`

---

## Message protocol (single source of truth)

All `postMessage` payloads are `{ type, ...}`. Strings must match exactly across SDK, shell, relay, and success page:

- `camaleonic.connect.resize` `{ height: number }` — shell → host (parent)
- `camaleonic.connect.exit` — shell → host (parent)
- `camaleonic.connect.success` `{ accountIds: string[], platform: string|null }` — shell/success → host (parent)
- `camaleonic.connect.error` `{ code: string, message: string }` — shell → host (parent)
- `camaleonic.oauth.complete` `{ sessionId: string, kind: 'confirm'|'fb-picker', platform: string }` — relay popup → shell (opener)

## File structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `poc/src/modules/accounts/internal-accounts.controller.ts` | Create | `GET /internal/accounts` for the connections screen |
| `poc/src/modules/accounts/internal-accounts.controller.spec.ts` | Create | Jest test for the endpoint |
| `poc/src/modules/accounts/accounts.module.ts` | Modify | Register the new controller |
| `connect-tool/vitest.config.ts` | Create | Vitest + jsdom harness |
| `connect-tool/sdk/src/index.ts` | Modify (rewrite) | iframe overlay, message routing, `platform` option |
| `connect-tool/sdk/src/index.test.ts` | Create | SDK unit tests (jsdom) |
| `connect-tool/lib/session.ts` | Modify | add `embedded` to `OAuthContextSession` |
| `connect-tool/app/api/oauth/[...slug]/route.ts` | Modify | read `embed`, store it, route callback to relay |
| `connect-tool/app/oauth/complete/page.tsx` + `client.tsx` | Create | relay page |
| `connect-tool/app/success/client.tsx` | Modify | embed mode → post to `window.parent` |
| `connect-tool/app/confirm/[platform]/page.tsx` + `client.tsx` | Modify | pass + forward `embed`/`origin` |
| `connect-tool/app/facebook/pages/page.tsx` + `client.tsx` | Modify | pass + forward `embed`/`origin` |
| `connect-tool/app/connect/page.tsx` + `ConnectShell.tsx` + `shell-machine.ts` | Create | embedded shell |
| `connect-tool/lib/connections.ts` | Create | server helper: fetch connections from POC |
| `connect-tool/middleware.ts` | Create | `frame-ancestors` CSP for embedded routes |
| `connect-tool/app/layout.tsx` + global stylesheet | Modify | `.v-canvas--embed` compact styling |
| `social_media_dashboard/public/app.js` | Modify (optional) | demo init-level `platform` opt |
| `connect-tool/e2e/connect-modal.spec.ts` | Create | Playwright E2E |

---

## Task 1: POC internal accounts endpoint

**Files:**
- Create: `poc/src/modules/accounts/internal-accounts.controller.ts`
- Create: `poc/src/modules/accounts/internal-accounts.controller.spec.ts`
- Modify: `poc/src/modules/accounts/accounts.module.ts`

- [ ] **Step 1: Write the failing test**

Create `poc/src/modules/accounts/internal-accounts.controller.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { InternalAccountsController } from './internal-accounts.controller';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('InternalAccountsController', () => {
  const workspaces = { findBySlug: jest.fn() };
  const prisma = { account: { findMany: jest.fn() } };
  let controller: InternalAccountsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      controllers: [InternalAccountsController],
      providers: [
        { provide: WorkspacesService, useValue: workspaces },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    controller = mod.get(InternalAccountsController);
  });

  it('lists accounts for a workspace slug + end_user_id, scoped by platform', async () => {
    workspaces.findBySlug.mockResolvedValue({ id: 'ws_1', slug: 'demo' });
    prisma.account.findMany.mockResolvedValue([
      {
        id: 14n,
        platform: 'tiktok',
        handle: 'camaleonicanalytics',
        displayName: null,
        status: 'ready',
        profileImageUrl: 'https://x/y.png',
      },
    ]);

    const res = await controller.list('demo', 'alexcrilez@gmail.com', 'tiktok');

    expect(workspaces.findBySlug).toHaveBeenCalledWith('demo');
    expect(prisma.account.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws_1', endUserId: 'alexcrilez@gmail.com', platform: 'tiktok' },
      orderBy: { connectedAt: 'desc' },
      take: 100,
    });
    expect(res.data).toEqual([
      {
        id: '14',
        platform: 'tiktok',
        handle: 'camaleonicanalytics',
        display_name: null,
        status: 'ready',
        profile_image_url: 'https://x/y.png',
      },
    ]);
  });

  it('omits the platform filter when platform is absent', async () => {
    workspaces.findBySlug.mockResolvedValue({ id: 'ws_1', slug: 'demo' });
    prisma.account.findMany.mockResolvedValue([]);
    await controller.list('demo', 'alexcrilez@gmail.com', undefined);
    expect(prisma.account.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws_1', endUserId: 'alexcrilez@gmail.com' },
      orderBy: { connectedAt: 'desc' },
      take: 100,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd poc && npx jest src/modules/accounts/internal-accounts.controller.spec.ts`
Expected: FAIL — `Cannot find module './internal-accounts.controller'`.

- [ ] **Step 3: Write the controller**

Create `poc/src/modules/accounts/internal-accounts.controller.ts`:

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

/**
 * Internal endpoint used by connect-ui's embedded "Connections" screen to
 * list the end-user's existing accounts for a platform. Lives on /internal
 * so it's never exposed at the public ingress — same trust model as
 * /internal/workspaces/:slug/branding and /internal/sdk-tokens/verify.
 */
@Controller('internal/accounts')
export class InternalAccountsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  @Get()
  async list(
    @Query('ws_slug') wsSlug: string,
    @Query('end_user_id') endUserId: string,
    @Query('platform') platform: string | undefined,
  ): Promise<{
    data: Array<{
      id: string;
      platform: string;
      handle: string | null;
      display_name: string | null;
      status: string;
      profile_image_url: string | null;
    }>;
  }> {
    const ws = await this.workspaces.findBySlug(wsSlug);
    const rows = await this.prisma.account.findMany({
      where: {
        workspaceId: ws.id,
        endUserId,
        ...(platform ? { platform } : {}),
      },
      orderBy: { connectedAt: 'desc' },
      take: 100,
    });
    return {
      data: rows.map((r) => ({
        id: String(r.id),
        platform: r.platform,
        handle: r.handle ?? null,
        display_name: r.displayName ?? null,
        status: r.status,
        profile_image_url: r.profileImageUrl ?? null,
      })),
    };
  }
}
```

If a field name above does not match the Prisma `Account` model (e.g. `profileImageUrl`/`displayName`/`connectedAt`), open `poc/prisma/schema.prisma`, confirm the exact field names, and adjust the mapping and the test's mock rows + `orderBy` to match.

- [ ] **Step 4: Register the controller**

In `poc/src/modules/accounts/accounts.module.ts`, add `InternalAccountsController` to the `controllers` array (import it at the top). Confirm `WorkspacesService` is injectable here — if `WorkspacesModule` isn't already imported, add it to `imports`, and ensure `WorkspacesModule` `exports: [WorkspacesService]`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd poc && npx jest src/modules/accounts/internal-accounts.controller.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Verify build + module wiring**

Run: `cd poc && npm run lint`
Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add poc/src/modules/accounts/internal-accounts.controller.ts poc/src/modules/accounts/internal-accounts.controller.spec.ts poc/src/modules/accounts/accounts.module.ts
git commit -m "feat(poc): internal accounts endpoint for connect connections screen"
```

---

## Task 2: Add Vitest harness to connect-tool

**Files:**
- Create: `connect-tool/vitest.config.ts`
- Modify: `connect-tool/package.json`

- [ ] **Step 1: Install dev deps**

Run: `cd connect-tool && npm install -D vitest@^2 jsdom@^25`

- [ ] **Step 2: Create the config**

Create `connect-tool/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['sdk/src/**/*.test.ts', 'lib/**/*.test.ts', 'app/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Add test scripts**

In `connect-tool/package.json` `scripts`, add `"test": "vitest run"` and `"test:watch": "vitest"`.

- [ ] **Step 4: Add a smoke test**

Create `connect-tool/sdk/src/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('vitest harness', () => {
  it('runs in jsdom', () => {
    expect(typeof window).toBe('object');
    expect(typeof document.createElement).toBe('function');
  });
});
```

- [ ] **Step 5: Run it**

Run: `cd connect-tool && npm test`
Expected: PASS (1 test). Then delete `sdk/src/smoke.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add connect-tool/vitest.config.ts connect-tool/package.json connect-tool/package-lock.json
git commit -m "chore(connect-tool): add vitest + jsdom test harness"
```

---

## Task 3: Rewrite the SDK as an iframe-modal host

**Files:**
- Modify (rewrite): `connect-tool/sdk/src/index.ts`
- Create: `connect-tool/sdk/src/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `connect-tool/sdk/src/index.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import CamaleonicConnect from './index';

const BASE = 'https://connect.example.com';

function initWith(extra: Record<string, unknown> = {}) {
  return CamaleonicConnect.init({ sdkToken: 'jwt', workspace: 'demo', baseUrl: BASE, ...extra });
}

describe('CamaleonicConnect iframe modal', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('injects an overlay with an iframe pointing at /connect (no window.open)', () => {
    const openSpy = vi.spyOn(window, 'open');
    initWith().open();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    const url = new URL(iframe.src);
    expect(url.origin + url.pathname).toBe(`${BASE}/connect`);
    expect(url.searchParams.get('ws')).toBe('demo');
    expect(url.searchParams.get('token')).toBe('jwt');
    expect(url.searchParams.get('embed')).toBe('1');
    expect(url.searchParams.get('platform')).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('passes a single platform from the init option (skip chooser)', () => {
    initWith({ platform: 'tiktok' }).open();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(new URL(iframe.src).searchParams.get('platform')).toBe('tiktok');
  });

  it('infers single platform from a 1-entry platforms allow-list', () => {
    initWith({ platforms: ['twitch'] }).open();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(new URL(iframe.src).searchParams.get('platform')).toBe('twitch');
  });

  it('open(platform) arg overrides the init option', () => {
    initWith({ platform: 'tiktok' }).open('youtube');
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(new URL(iframe.src).searchParams.get('platform')).toBe('youtube');
  });

  it('fires onSuccess and tears down on a success message from baseUrl', () => {
    const onSuccess = vi.fn();
    initWith({ onSuccess }).open();
    window.dispatchEvent(new MessageEvent('message', {
      origin: BASE,
      data: { type: 'camaleonic.connect.success', accountIds: ['14'], platform: 'tiktok' },
    }));
    expect(onSuccess).toHaveBeenCalledWith({ accountIds: ['14'], platform: 'tiktok' });
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('ignores messages from a foreign origin', () => {
    const onSuccess = vi.fn();
    initWith({ onSuccess }).open();
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://evil.example.com',
      data: { type: 'camaleonic.connect.success', accountIds: ['x'], platform: 'tiktok' },
    }));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(document.querySelector('iframe')).toBeTruthy();
  });

  it('resizes the modal on a resize message', () => {
    initWith().open();
    window.dispatchEvent(new MessageEvent('message', {
      origin: BASE, data: { type: 'camaleonic.connect.resize', height: 640 },
    }));
    const modal = document.querySelector('[data-camaleonic-modal]') as HTMLElement;
    expect(modal.style.height).toBe('640px');
  });

  it('fires onExit and tears down on exit message', () => {
    const onExit = vi.fn();
    initWith({ onExit }).open();
    window.dispatchEvent(new MessageEvent('message', { origin: BASE, data: { type: 'camaleonic.connect.exit' } }));
    expect(onExit).toHaveBeenCalled();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('close() is idempotent', () => {
    const handle = initWith();
    handle.open();
    handle.close();
    handle.close();
    expect(document.querySelector('iframe')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd connect-tool && npm test`
Expected: FAIL — current SDK uses `window.open`, no iframe injected.

- [ ] **Step 3: Rewrite the SDK**

Replace the entire contents of `connect-tool/sdk/src/index.ts` with:

```ts
/**
 * Camaleonic Connect SDK — v2.
 *
 * Renders the connect flow as an in-page iframe modal (not a popup window).
 * Only the real provider login breaks out to its own window; the iframe
 * relays the result back and the modal shows confirm → success in place.
 *
 *   const handle = CamaleonicConnect.init({
 *     sdkToken: "<jwt>", workspace: "<slug>",
 *     platform: "tiktok",                 // optional — skip the chooser
 *     onSuccess, onError, onExit,
 *   });
 *   button.onclick = () => handle.open();  // or handle.open("tiktok")
 */

export type PlatformKey =
  | 'facebook' | 'instagram' | 'youtube' | 'tiktok' | 'threads' | 'twitch';

export interface SuccessPayload { accountIds: string[]; platform: PlatformKey | null; }
export interface ErrorPayload { code: 'popup_blocked' | 'invalid_platform' | 'token' | 'unknown'; message: string; }

export interface CamaleonicConnectOptions {
  sdkToken: string;
  workspace: string;
  /** Skip the chooser and start at this platform. */
  platform?: PlatformKey;
  /** Allow-list; if exactly one entry and no `platform`, treated as the single platform. */
  platforms?: ReadonlyArray<PlatformKey>;
  baseUrl?: string;
  onSuccess?: (data: SuccessPayload) => void;
  onError?: (err: ErrorPayload) => void;
  onExit?: () => void;
}

export interface CamaleonicConnectHandle {
  open: (platform?: PlatformKey) => void;
  close: () => void;
}

const VERSION = '2.0.0';
const MSG = {
  resize: 'camaleonic.connect.resize',
  exit: 'camaleonic.connect.exit',
  success: 'camaleonic.connect.success',
  error: 'camaleonic.connect.error',
} as const;
const DEFAULT_HEIGHT = 600;
const MODAL_WIDTH = 460;

function resolveBaseUrl(opts: CamaleonicConnectOptions): string {
  if (typeof opts.baseUrl === 'string' && opts.baseUrl.length > 0) {
    return opts.baseUrl.replace(/\/+$/, '');
  }
  try {
    const scripts = document.getElementsByTagName('script');
    for (let i = scripts.length - 1; i >= 0; i--) {
      const s = scripts[i];
      if (s.src && s.src.indexOf('connect-sdk.js') !== -1) return new URL(s.src).origin;
    }
  } catch {
    /* fall through */
  }
  return typeof window !== 'undefined' ? window.location.origin : '';
}

function requireOpt(opts: CamaleonicConnectOptions, key: 'sdkToken' | 'workspace'): void {
  const v = opts[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error('CamaleonicConnect.init: missing option "' + String(key) + '"');
  }
}

function effectivePlatform(
  opts: CamaleonicConnectOptions,
  arg: PlatformKey | undefined,
): PlatformKey | undefined {
  if (arg) return arg;
  if (opts.platform) return opts.platform;
  if (opts.platforms && opts.platforms.length === 1) return opts.platforms[0];
  return undefined;
}

function buildConnectUrl(
  baseUrl: string,
  opts: CamaleonicConnectOptions,
  platform: PlatformKey | undefined,
): string {
  const qs = new URLSearchParams({
    ws: opts.workspace,
    token: opts.sdkToken,
    origin: window.location.origin,
    embed: '1',
  });
  if (platform) qs.set('platform', platform);
  return baseUrl + '/connect?' + qs.toString();
}

function init(opts: CamaleonicConnectOptions): CamaleonicConnectHandle {
  if (!opts || typeof opts !== 'object') {
    throw new Error('CamaleonicConnect.init: options object is required');
  }
  requireOpt(opts, 'sdkToken');
  requireOpt(opts, 'workspace');
  const baseUrl = resolveBaseUrl(opts);
  if (!baseUrl) throw new Error('CamaleonicConnect.init: could not resolve baseUrl');

  let overlay: HTMLDivElement | null = null;
  let modal: HTMLDivElement | null = null;
  let messageListener: ((ev: MessageEvent) => void) | null = null;
  let keyListener: ((ev: KeyboardEvent) => void) | null = null;
  let done = false;

  function teardown(): void {
    if (messageListener) { window.removeEventListener('message', messageListener); messageListener = null; }
    if (keyListener) { window.removeEventListener('keydown', keyListener); keyListener = null; }
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    modal = null;
  }

  function close(): void { teardown(); }

  function emitExit(): void {
    teardown();
    if (typeof opts.onExit === 'function') { try { opts.onExit(); } catch { /* swallow */ } }
  }
  function emitSuccess(p: SuccessPayload): void {
    if (done) return; done = true; teardown();
    if (typeof opts.onSuccess === 'function') { try { opts.onSuccess(p); } catch { /* swallow */ } }
  }
  function emitError(code: ErrorPayload['code'], message: string): void {
    if (typeof opts.onError === 'function') { try { opts.onError({ code, message }); } catch { /* swallow */ } }
  }

  function buildOverlay(url: string): void {
    overlay = document.createElement('div');
    overlay.setAttribute('data-camaleonic-overlay', '');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;' +
      'justify-content:center;background:rgba(8,8,12,0.6);backdrop-filter:blur(4px);';

    modal = document.createElement('div');
    modal.setAttribute('data-camaleonic-modal', '');
    modal.style.cssText =
      'position:relative;width:' + MODAL_WIDTH + 'px;max-width:calc(100vw - 32px);' +
      'height:' + DEFAULT_HEIGHT + 'px;max-height:calc(100vh - 48px);' +
      'border-radius:18px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,0.5);background:#fff;';

    const closeBtn = document.createElement('button');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText =
      'position:absolute;top:10px;right:10px;z-index:2;width:28px;height:28px;border:0;' +
      'border-radius:50%;background:rgba(0,0,0,0.06);cursor:pointer;font-size:14px;line-height:28px;';
    closeBtn.onclick = () => emitExit();

    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.title = 'Camaleonic Connect';
    iframe.allow = 'clipboard-write';
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;';

    modal.appendChild(closeBtn);
    modal.appendChild(iframe);
    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) emitExit(); });
    document.body.appendChild(overlay);
  }

  function open(platform?: PlatformKey): void {
    if (overlay) return; // already open
    done = false;
    const plat = effectivePlatform(opts, platform);
    if (plat && opts.platforms && opts.platforms.length > 1 && opts.platforms.indexOf(plat) === -1) {
      emitError('invalid_platform', 'platform "' + plat + '" is not in the configured allow-list');
      return;
    }
    buildOverlay(buildConnectUrl(baseUrl, opts, plat));

    messageListener = (ev: MessageEvent) => {
      if (ev.origin !== baseUrl) return;
      const data = ev.data as { type?: string; height?: number; accountIds?: string[]; platform?: PlatformKey; code?: string; message?: string };
      if (!data || typeof data.type !== 'string') return;
      if (data.type === MSG.resize && modal && typeof data.height === 'number') {
        modal.style.height = Math.max(360, data.height) + 'px';
      } else if (data.type === MSG.success) {
        emitSuccess({ accountIds: Array.isArray(data.accountIds) ? data.accountIds : [], platform: data.platform ?? plat ?? null });
      } else if (data.type === MSG.exit) {
        emitExit();
      } else if (data.type === MSG.error) {
        emitError((data.code as ErrorPayload['code']) ?? 'unknown', data.message ?? 'Connect error');
      }
    };
    window.addEventListener('message', messageListener);

    keyListener = (ev: KeyboardEvent) => { if (ev.key === 'Escape') emitExit(); };
    window.addEventListener('keydown', keyListener);
  }

  return { open, close };
}

export const version = VERSION;
export default { init, version };
export { init };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd connect-tool && npm test`
Expected: PASS (all SDK tests).

- [ ] **Step 5: Rebuild the bundle**

Run: `cd connect-tool && npm run build:sdk`
Expected: regenerates `public/connect-sdk.js`, `.d.ts`, `.js.map`, `.size`. Confirm `public/connect-sdk.js` contains `data-camaleonic-modal` and not `popup=yes`.

- [ ] **Step 6: Commit**

```bash
git add connect-tool/sdk/src/index.ts connect-tool/sdk/src/index.test.ts connect-tool/public/connect-sdk.js connect-tool/public/connect-sdk.d.ts connect-tool/public/connect-sdk.js.map connect-tool/public/connect-sdk.js.size
git commit -m "feat(sdk): iframe-modal host with message relay + single-platform option"
```

---

## Task 4: Add `embedded` flag to the OAuth context session

**Files:**
- Modify: `connect-tool/lib/session.ts` (`interface OAuthContextSession`)

- [ ] **Step 1: Add the field**

In `connect-tool/lib/session.ts`, inside `interface OAuthContextSession`, add after `openerOrigin?: string;`:

```ts
  /** True when the OAuth window was launched from the embedded iframe modal.
   *  Drives the callback to redirect to the /oauth/complete relay page. */
  embedded?: boolean;
```

- [ ] **Step 2: Typecheck**

Run: `cd connect-tool && npm run typecheck`
Expected: no errors (optional field; `PutSessionInput` derives from the interface).

- [ ] **Step 3: Commit**

```bash
git add connect-tool/lib/session.ts
git commit -m "feat(connect-tool): add embedded flag to oauth context session"
```

---

## Task 5: Dispatcher — read `embed`, store it, route callback to relay

**Files:**
- Modify: `connect-tool/app/api/oauth/[...slug]/route.ts`

- [ ] **Step 1: Persist `embedded` at start**

In the `if (action === 'start')` block, just before `contextSessionId = putSession({`, add:

```ts
        const embedded = sp.get('embed') === '1';
```

and add `embedded,` to the `putSession({ kind: 'oauth-context', ... })` object (alongside `openerOrigin`).

- [ ] **Step 2: Add imports**

Add `getOAuthContextSession` to the existing import from `'../../../../lib/session'`, and `getContextCookie` to the existing import from `'../../../../lib/oauth-context'`. (Keep each symbol in its correct module's import line; do not merge modules.)

- [ ] **Step 3: Route the callback to the relay when embedded**

In the `if (action === 'callback')` block, replace the `fb-picker` and `confirm` redirect lines (the two `NextResponse.redirect(...)` returns after `const result = await entry.promise;`) with:

```ts
      const ctxId = getContextCookie(req);
      const ctx = ctxId ? getOAuthContextSession(ctxId) : null;
      const embedded = !!ctx?.embedded;

      if (result.kind === 'fb-picker') {
        const target = embedded
          ? `${baseUrl}/oauth/complete?session=${result.sessionId}&kind=fb-picker&platform=facebook`
          : `${baseUrl}/facebook/pages?session=${result.sessionId}`;
        return NextResponse.redirect(target, { status: 302 });
      }
      const target = embedded
        ? `${baseUrl}/oauth/complete?session=${result.sessionId}&kind=confirm&platform=${result.platform}`
        : `${baseUrl}/confirm/${result.platform}?session=${result.sessionId}`;
      return NextResponse.redirect(target, { status: 302 });
```

- [ ] **Step 4: Typecheck**

Run: `cd connect-tool && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add connect-tool/app/api/oauth/\[...slug\]/route.ts
git commit -m "feat(connect-tool): route embedded oauth callback to relay page"
```

---

## Task 6: The `/oauth/complete` relay page

**Files:**
- Create: `connect-tool/app/oauth/complete/page.tsx`
- Create: `connect-tool/app/oauth/complete/client.tsx`

- [ ] **Step 1: Create the server page**

Create `connect-tool/app/oauth/complete/page.tsx`:

```tsx
import { Suspense } from 'react';
import { OAuthCompleteClient } from './client';

export const dynamic = 'force-dynamic';

export default function OAuthComplete() {
  return (
    <Suspense fallback={null}>
      <OAuthCompleteClient />
    </Suspense>
  );
}
```

- [ ] **Step 2: Create the client relay**

Create `connect-tool/app/oauth/complete/client.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Thin relay shown in the provider-login window when launched from the
 * embedded iframe modal. Posts the freshly-created OAuth session id back to
 * the opener (the iframe shell), which then navigates itself to the
 * confirm / page-picker step, and closes this window.
 */
export function OAuthCompleteClient() {
  const params = useSearchParams();
  const sessionId = params.get('session') ?? '';
  const kind = params.get('kind') ?? '';
  const platform = params.get('platform') ?? '';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const opener = window.opener;
    if (opener && opener !== window && sessionId) {
      try {
        opener.postMessage(
          { type: 'camaleonic.oauth.complete', sessionId, kind, platform },
          window.location.origin,
        );
      } catch {
        /* opener is same-origin by construction; ignore */
      }
    }
    const t = window.setTimeout(() => window.close(), 200);
    return () => window.clearTimeout(t);
  }, [sessionId, kind, platform]);

  return (
    <div className="v-canvas v-canvas--embed">
      <div className="v-shell">
        <p className="v-body">Finishing up… you can close this window.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd connect-tool && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add connect-tool/app/oauth/complete/page.tsx connect-tool/app/oauth/complete/client.tsx
git commit -m "feat(connect-tool): oauth-complete relay page for embedded flow"
```

---

## Task 7: Success page — embed mode posts to `window.parent`

**Files:**
- Modify: `connect-tool/app/success/client.tsx`

- [ ] **Step 1: Replace the post-message effect**

In `connect-tool/app/success/client.tsx`, replace the `openerOrigin`/`sentRef`/`useEffect` block with:

```tsx
  const openerOrigin = params.get('opener_origin') ?? '';
  const embedded = params.get('embed') === '1';
  const sentRef = useRef(false);
  useEffect(() => {
    if (sentRef.current) return;
    if (typeof window === 'undefined') return;
    const ids = accountsRaw ? accountsRaw.split(',').filter(Boolean) : [];
    if (ids.length === 0) return;
    const payload = { type: 'camaleonic.connect.success', accountIds: ids, platform };

    if (embedded && window.parent && window.parent !== window) {
      // Inside the modal iframe — notify the host SDK; do NOT close (we are
      // an iframe, not a popup). The SDK tears down the overlay.
      sentRef.current = true;
      try {
        window.parent.postMessage(payload, openerOrigin && openerOrigin.length > 0 ? openerOrigin : '*');
      } catch {
        /* host cross-origin policy — host's problem */
      }
      return;
    }

    // Legacy popup-window flow: notify opener and close.
    const opener = window.opener;
    if (!opener || opener === window) return;
    sentRef.current = true;
    try {
      opener.postMessage(payload, openerOrigin && openerOrigin.length > 0 ? openerOrigin : '*');
    } catch {
      /* opener cross-origin */
    }
    const timer = window.setTimeout(() => window.close(), 250);
    return () => window.clearTimeout(timer);
  }, [accountsRaw, openerOrigin, platform, embedded]);
```

- [ ] **Step 2: Typecheck**

Run: `cd connect-tool && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add connect-tool/app/success/client.tsx
git commit -m "feat(connect-tool): success posts to parent in embed mode"
```

---

## Task 8: Forward `embed` + `origin` through confirm and page-picker

The post-OAuth pages are reached by iframe navigation. They must keep `embed=1` (so success posts to the parent) AND `origin=<host>` (so the CSP in Task 12 keeps allowing the host frame across navigations).

**Files:**
- Modify: `connect-tool/app/confirm/[platform]/page.tsx`, `connect-tool/app/confirm/[platform]/client.tsx`
- Modify: `connect-tool/app/facebook/pages/page.tsx`, `connect-tool/app/facebook/pages/client.tsx`

- [ ] **Step 1: Pass `embed`/`origin` from confirm server page to client**

In `connect-tool/app/confirm/[platform]/page.tsx`, read `embed` and `origin` from `searchParams` (same pattern used for `session`), and pass `embed={sp.embed === '1'}` and `origin={typeof sp.origin === 'string' ? sp.origin : ''}` to `<ConfirmClient />`. Add `embed: boolean` and `origin: string` to `ConfirmClient`'s `Props`.

- [ ] **Step 2: Append them in ConfirmClient's success push**

In `connect-tool/app/confirm/[platform]/client.tsx`, destructure `embed` and `origin` from props. After the existing `opener_origin` handling and before `router.push(\`/success?${params.toString()}\`)`, add:

```ts
      if (embed) params.set('embed', '1');
      if (origin) params.set('origin', origin);
```

- [ ] **Step 3: Same for the Facebook page-picker**

In `connect-tool/app/facebook/pages/page.tsx`, pass `embed={sp.embed === '1'}` and `origin={typeof sp.origin === 'string' ? sp.origin : ''}` to `<FacebookPagesClient />`; add `embed: boolean` and `origin: string` to its `Props`. In `connect-tool/app/facebook/pages/client.tsx` `onSubmit`, where the `/success?...` URL is built, append `${embed ? '&embed=1' : ''}${origin ? `&origin=${encodeURIComponent(origin)}` : ''}`.

- [ ] **Step 4: Forward `origin` from the shell navigation too**

In `connect-tool/app/connect/ConnectShell.tsx` (Task 10), the relay handler builds the confirm/fb-picker URL. Ensure it appends `&origin=${encodeURIComponent(props.origin)}` so the first post-OAuth page already carries it. (Cross-referenced in Task 10's code.)

- [ ] **Step 5: Typecheck**

Run: `cd connect-tool && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add connect-tool/app/confirm connect-tool/app/facebook
git commit -m "feat(connect-tool): forward embed+origin through confirm and page picker"
```

---

## Task 9: Server helper to fetch connections

**Files:**
- Create: `connect-tool/lib/connections.ts`

- [ ] **Step 1: Write the helper**

Create `connect-tool/lib/connections.ts`:

```ts
import axios from 'axios';

export interface Connection {
  id: string;
  platform: string;
  handle: string | null;
  display_name: string | null;
  status: string;
  profile_image_url: string | null;
}

/**
 * Fetch the end-user's existing accounts for a workspace (optionally one
 * platform) from POC's internal endpoint. Server-only — uses POC_API_URL,
 * which is reachable from the connect-ui server but never the browser.
 * Returns [] on any failure (the connections screen degrades gracefully).
 */
export async function fetchConnections(
  wsSlug: string,
  endUserId: string,
  platform?: string,
): Promise<Connection[]> {
  const baseUrl = process.env.POC_API_URL;
  if (!baseUrl) return [];
  try {
    const res = await axios.get<{ data: Connection[] }>(`${baseUrl}/internal/accounts`, {
      params: { ws_slug: wsSlug, end_user_id: endUserId, ...(platform ? { platform } : {}) },
      timeout: 5_000,
      proxy: false,
      validateStatus: () => true,
    });
    if (res.status !== 200) return [];
    return res.data.data ?? [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd connect-tool && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add connect-tool/lib/connections.ts
git commit -m "feat(connect-tool): server helper to fetch end-user connections"
```

---

## Task 10: The `/connect` embedded shell

**Files:**
- Create: `connect-tool/app/connect/shell-machine.ts`
- Create: `connect-tool/app/connect/shell-machine.test.ts`
- Create: `connect-tool/app/connect/page.tsx`
- Create: `connect-tool/app/connect/ConnectShell.tsx`

- [ ] **Step 1: Write the step-machine test**

Create `connect-tool/app/connect/shell-machine.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { initialStep, nextAfterConsent, type Step } from './shell-machine';

describe('connect shell machine', () => {
  it('starts at consent', () => {
    expect(initialStep(undefined).step).toBe<Step>('consent');
  });
  it('after consent with a fixed platform goes straight to connections', () => {
    expect(nextAfterConsent('tiktok')).toBe<Step>('connections');
  });
  it('after consent with no platform goes to the chooser', () => {
    expect(nextAfterConsent(undefined)).toBe<Step>('chooser');
  });
  it('initialStep records the fixed platform', () => {
    expect(initialStep('twitch').platform).toBe('twitch');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd connect-tool && npm test`
Expected: FAIL — `Cannot find module './shell-machine'`.

- [ ] **Step 3: Write the machine**

Create `connect-tool/app/connect/shell-machine.ts`:

```ts
export type Step = 'consent' | 'chooser' | 'connections' | 'guidance';

export type PlatformKey =
  | 'facebook' | 'instagram' | 'youtube' | 'tiktok' | 'threads' | 'twitch';

export function initialStep(fixedPlatform: PlatformKey | undefined): {
  step: Step;
  platform: PlatformKey | undefined;
} {
  return { step: 'consent', platform: fixedPlatform };
}

/** A fixed platform skips the chooser; otherwise show it. */
export function nextAfterConsent(fixedPlatform: PlatformKey | undefined): Step {
  return fixedPlatform ? 'connections' : 'chooser';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd connect-tool && npm test`
Expected: PASS.

- [ ] **Step 5: Write the server page**

Create `connect-tool/app/connect/page.tsx`:

```tsx
import axios from 'axios';
import { verifySdkToken } from '../../lib/oauth-context';
import { fetchConnections } from '../../lib/connections';
import { ConnectShell } from './ConnectShell';
import type { PlatformKey } from './shell-machine';

export const dynamic = 'force-dynamic';

interface Branding { logo_url?: string; primary_color?: string; title?: string; }

function first(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return typeof v === 'string' ? v : undefined;
}

async function fetchBranding(slug: string): Promise<Branding | null> {
  const baseUrl = process.env.POC_API_URL;
  if (!baseUrl) return null;
  try {
    const res = await axios.get<{ branding: Branding | null }>(
      `${baseUrl}/internal/workspaces/${encodeURIComponent(slug)}/branding`,
      { timeout: 5_000, proxy: false, validateStatus: () => true },
    );
    return res.status === 200 ? res.data.branding : null;
  } catch {
    return null;
  }
}

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const ws = first(sp.ws);
  const token = first(sp.token);
  const origin = first(sp.origin);
  const platform = first(sp.platform) as PlatformKey | undefined;

  if (!ws || !token) {
    return (
      <div className="v-canvas v-canvas--embed">
        <div className="v-shell">
          <p className="v-body">Missing connect context. Restart from the app you came from.</p>
        </div>
      </div>
    );
  }

  let endUserId = '';
  let error: string | null = null;
  try {
    const claims = await verifySdkToken(token);
    endUserId = claims.sub;
  } catch (e) {
    error = e instanceof Error ? e.message : 'Invalid connect token';
  }

  const branding = await fetchBranding(ws);
  const connections = !error && platform ? await fetchConnections(ws, endUserId, platform) : [];

  return (
    <ConnectShell
      ws={ws}
      token={token}
      origin={origin ?? ''}
      fixedPlatform={platform}
      brandTitle={branding?.title ?? 'Camaleonic'}
      brandLogo={branding?.logo_url ?? null}
      initialConnections={connections}
      tokenError={error}
    />
  );
}
```

- [ ] **Step 6: Write the client shell**

Create `connect-tool/app/connect/ConnectShell.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import type { Connection } from '../../lib/connections';
import { initialStep, nextAfterConsent, type PlatformKey, type Step } from './shell-machine';

const PLATFORMS: Array<{ key: PlatformKey; label: string; provider: string }> = [
  { key: 'facebook', label: 'Facebook', provider: 'Facebook' },
  { key: 'instagram', label: 'Instagram', provider: 'Facebook' },
  { key: 'youtube', label: 'YouTube', provider: 'Google' },
  { key: 'tiktok', label: 'TikTok', provider: 'TikTok' },
  { key: 'threads', label: 'Threads', provider: 'Threads' },
  { key: 'twitch', label: 'Twitch', provider: 'Twitch' },
];

// Instagram connects via Facebook OAuth (see lib/platforms.ts).
function startPlatform(p: PlatformKey): PlatformKey {
  return p === 'instagram' ? 'facebook' : p;
}

interface Props {
  ws: string;
  token: string;
  origin: string;
  fixedPlatform?: PlatformKey;
  brandTitle: string;
  brandLogo: string | null;
  initialConnections: Connection[];
  tokenError: string | null;
}

export function ConnectShell(props: Props) {
  const init = initialStep(props.fixedPlatform);
  const [step, setStep] = useState<Step>(init.step);
  const [platform, setPlatform] = useState<PlatformKey | undefined>(init.platform);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(props.tokenError);

  // Tell the host SDK to size the modal to our content.
  useEffect(() => {
    const post = () =>
      window.parent?.postMessage(
        { type: 'camaleonic.connect.resize', height: document.body.scrollHeight + 24 },
        props.origin || '*',
      );
    post();
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [step, props.origin]);

  // Relay from the provider-login window → navigate the iframe to the
  // existing confirm / page-picker page in embed mode.
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const d = ev.data as { type?: string; sessionId?: string; kind?: string; platform?: string };
      if (d?.type !== 'camaleonic.oauth.complete' || !d.sessionId) return;
      const originQ = props.origin ? `&origin=${encodeURIComponent(props.origin)}` : '';
      const dest =
        d.kind === 'fb-picker'
          ? `/facebook/pages?session=${encodeURIComponent(d.sessionId)}&embed=1${originQ}`
          : `/confirm/${encodeURIComponent(d.platform || platform || '')}?session=${encodeURIComponent(d.sessionId)}&embed=1${originQ}`;
      window.location.href = dest;
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [platform, props.origin]);

  function exit() {
    window.parent?.postMessage({ type: 'camaleonic.connect.exit' }, props.origin || '*');
  }

  function login(p: PlatformKey) {
    const sp = startPlatform(p);
    const qs = new URLSearchParams({ ws: props.ws, token: props.token, origin: props.origin, embed: '1' });
    const url = `/api/oauth/start/${sp}?${qs.toString()}`;
    const popup = window.open(url, 'camaleonic-oauth', 'popup=yes,width=560,height=720');
    if (!popup) {
      setError('Your browser blocked the login window. Allow popups and try again.');
      window.parent?.postMessage(
        { type: 'camaleonic.connect.error', code: 'popup_blocked', message: 'Provider login popup blocked' },
        props.origin || '*',
      );
      return;
    }
    setConnecting(true);
    const timer = window.setInterval(() => {
      if (popup.closed) { window.clearInterval(timer); setConnecting(false); }
    }, 600);
  }

  if (error) {
    return (
      <Frame title={props.brandTitle} logo={props.brandLogo} onClose={exit}>
        <div className="v-banner danger">↯ {error}</div>
      </Frame>
    );
  }

  return (
    <Frame title={props.brandTitle} logo={props.brandLogo} onClose={exit}>
      {step === 'consent' && (
        <div style={{ textAlign: 'center' }}>
          <h2 className="v-display size-secondary">{props.brandTitle} uses Camaleonic to link your accounts</h2>
          <ul style={{ listStyle: 'none', padding: 0, textAlign: 'left', margin: '16px 0' }}>
            <li className="v-body">✓ Your account is in safe hands</li>
            <li className="v-body">✓ Your consent matters</li>
            <li className="v-body">✓ Your data is safe and encrypted</li>
          </ul>
          <button className="v-pill-primary" onClick={() => setStep(nextAfterConsent(props.fixedPlatform))}>
            Continue
          </button>
        </div>
      )}

      {step === 'chooser' && (
        <div>
          <h2 className="v-display size-secondary">Select a platform</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
            {PLATFORMS.map((p) => (
              <button key={p.key} className="v-pill-outline-mint" onClick={() => { setPlatform(p.key); setStep('connections'); }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 'connections' && platform && (
        <div>
          <h2 className="v-display size-secondary">{labelFor(platform)} connections</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0' }}>
            {props.initialConnections.length === 0 && <p className="v-body">No accounts connected yet.</p>}
            {props.initialConnections.map((c) => (
              <div key={c.id} className="v-row">
                <span className="v-row-val">{c.handle || c.display_name || c.id}</span>
                <span className="v-meta">{c.status}</span>
              </div>
            ))}
          </div>
          <button className="v-pill-primary" onClick={() => setStep('guidance')}>
            + Add {labelFor(platform)} account
          </button>
          {!props.fixedPlatform && (
            <button className="v-meta" style={{ marginLeft: 12 }} onClick={() => setStep('chooser')}>← Back</button>
          )}
        </div>
      )}

      {step === 'guidance' && platform && (
        <div>
          <h2 className="v-display size-secondary">{guidanceFor(platform).title}</h2>
          <p className="v-body" style={{ margin: '10px 0' }}>{guidanceFor(platform).body}</p>
          <button className="v-pill-primary" disabled={connecting} onClick={() => login(platform)}>
            {connecting ? 'Waiting for login…' : `Login with ${providerFor(platform)}`}
          </button>
          <button className="v-meta" style={{ marginLeft: 12 }} onClick={() => setStep('connections')}>← Back</button>
        </div>
      )}
    </Frame>
  );
}

function Frame({ title, logo, onClose, children }: {
  title: string; logo: string | null; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="v-canvas v-canvas--embed">
      <div className="v-shell">
        <header className="v-header">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" style={{ height: 24 }} />
          ) : (
            <span className="v-kicker mint">{title}</span>
          )}
          <button className="v-meta" aria-label="Close" onClick={onClose}>✕</button>
        </header>
        {children}
      </div>
    </div>
  );
}

function labelFor(p: PlatformKey): string { return PLATFORMS.find((x) => x.key === p)?.label ?? p; }
function providerFor(p: PlatformKey): string { return PLATFORMS.find((x) => x.key === p)?.provider ?? p; }
function guidanceFor(p: PlatformKey): { title: string; body: string } {
  if (p === 'instagram') {
    return { title: 'Connecting Instagram works via Facebook', body: 'Select the Facebook Page linked to your Instagram business account and grant all requested permissions.' };
  }
  if (p === 'facebook') {
    return { title: 'Login with Facebook', body: 'Select the Page(s) you want to connect and grant all requested permissions.' };
  }
  return { title: `Login with ${providerFor(p)}`, body: 'You will be asked to approve read access to your profile and content. Grant all requested permissions.' };
}
```

- [ ] **Step 7: Typecheck + tests**

Run: `cd connect-tool && npm run typecheck && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add connect-tool/app/connect
git commit -m "feat(connect-tool): embedded connect shell (consent/chooser/connections/guidance)"
```

---

## Task 11: Compact embed styling

**Files:**
- Modify: the global stylesheet imported by `connect-tool/app/layout.tsx`

- [ ] **Step 1: Locate the stylesheet**

Open `connect-tool/app/layout.tsx`, find the `import './…css'` (or `import '../styles/…css'`) line. That file is the global stylesheet.

- [ ] **Step 2: Add the embed modifier**

Append to that stylesheet:

```css
/* Embedded iframe-modal mode: drop the full-screen canvas chrome so the
   connect-ui fits inside the SDK's modal card. */
.v-canvas--embed {
  min-height: 0;
  padding: 20px;
  background: #ffffff;
  color: #14141a;
}
.v-canvas--embed .v-shell { max-width: 100%; margin: 0; gap: 14px; }
.v-canvas--embed .v-header { margin-bottom: 8px; }
.v-canvas--embed .v-display.size-secondary { font-size: 22px; line-height: 1.15; color: #14141a; }
.v-canvas--embed .v-body { color: #4a4a55; }
```

- [ ] **Step 3: Commit**

```bash
git add connect-tool/app/layout.tsx connect-tool/styles
git commit -m "style(connect-tool): compact embed mode for iframe modal"
```

---

## Task 12: Middleware — `frame-ancestors` for embedded routes

**Files:**
- Create: `connect-tool/middleware.ts`

- [ ] **Step 1: Write the middleware**

Create `connect-tool/middleware.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';

/**
 * Allow only the legitimate host app to frame the embedded connect routes,
 * and forbid framing everywhere else. The host origin arrives as ?origin=…
 * on the iframe URL (set by the SDK from window.location.origin) and is
 * forwarded across the post-OAuth page navigations.
 */
export function middleware(req: NextRequest): NextResponse {
  const res = NextResponse.next();
  const { searchParams } = req.nextUrl;

  if (searchParams.get('embed') === '1') {
    const origin = searchParams.get('origin');
    const ancestors = origin ? `'self' ${origin}` : `'self'`;
    res.headers.set('Content-Security-Policy', `frame-ancestors ${ancestors};`);
    res.headers.delete('X-Frame-Options');
  } else {
    res.headers.set('X-Frame-Options', 'DENY');
    res.headers.set('Content-Security-Policy', `frame-ancestors 'none';`);
  }
  return res;
}

export const config = {
  matcher: ['/connect', '/oauth/complete', '/confirm/:path*', '/facebook/pages', '/success'],
};
```

- [ ] **Step 2: Typecheck**

Run: `cd connect-tool && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add connect-tool/middleware.ts
git commit -m "feat(connect-tool): frame-ancestors CSP for embedded connect routes"
```

---

## Task 13: Host integration — optional `platform` option

**Files:**
- Modify (optional): `social_media_dashboard/public/app.js`

- [ ] **Step 1: Confirm no breaking change is required**

The host already calls `window.CamaleonicConnect.init({ sdkToken, workspace, onSuccess, onError, onExit }).open(platform)` with `platform` from `btn.dataset.platform`. The rewritten SDK keeps this API and a per-tile platform already skips the chooser. No change is strictly required.

- [ ] **Step 2: (Optional) demo the init-level `platform` option**

If a "Connect TikTok only" entry point is desired, add a button whose handler does:

```js
window.CamaleonicConnect.init({
  sdkToken: sdk_token,
  workspace: currentSession.workspace,
  platform: 'tiktok',
  onSuccess: () => refreshAccounts(),
}).open();
```

Commit only if such an entry point is added.

---

## Task 14: Run the full flow end-to-end (manual)

**Files:** none (verification)

- [ ] **Step 1: Start connect-ui**

Run: `cd connect-tool && npm run build:sdk && npm run dev`
Expected: connect-tool on `http://localhost:3002`. `POC_API_URL` + provider creds set in `connect-tool/.env`; POC API running.

- [ ] **Step 2: Point the host at local connect-ui**

In `social_media_dashboard/.env` set `CAMALEONIC_BASE_URL=http://localhost:3002`. Run: `cd social_media_dashboard && bash bounce.sh && node --env-file=.env server.js`
Expected: host on `http://localhost:4000`.

- [ ] **Step 3: Drive it in a browser**

Open `http://localhost:4000`, log in, click a Connect button. Verify:
- An in-page modal overlay appears (dimmed backdrop), NOT a new tab.
- consent → (chooser if no platform) → connections → guidance render inside the modal.
- "Login with X" opens the provider in a separate window.
- After approving, the provider window closes and the modal advances to confirm/page-picker → success.
- `onSuccess` fires (host accounts list refreshes) and the modal closes.

- [ ] **Step 4: Verify "no new tab" + resize + close**

The chooser/consent never replace the host page in a new tab. Modal height tracks content. X/ESC/backdrop closes and fires `onExit`.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A && git commit -m "fix(connect-tool): adjustments from end-to-end run"
```

---

## Task 15: Playwright E2E

**Files:**
- Create: `connect-tool/e2e/connect-modal.spec.ts`
- Modify: `connect-tool/package.json`

- [ ] **Step 1: Install Playwright**

Run: `cd connect-tool && npm install -D @playwright/test && npx playwright install chromium`

- [ ] **Step 2: Write the E2E**

Create `connect-tool/e2e/connect-modal.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

// Asserts the launch is an in-page modal, not a new tab. (Real provider
// OAuth can't run in CI; this test covers up to the modal + first screen.)
test('connect opens an in-page modal, not a new tab', async ({ page, context }) => {
  await page.goto('http://localhost:4000');
  // Adjust selectors to social_media_dashboard/public/index.html.
  await page.fill('input[name="email"]', 'e2e@example.com');
  await page.fill('input[name="password"]', 'e2e-password');
  await page.click('button[data-action="register"]');

  const pagesBefore = context.pages().length;
  await page.click('[data-platform="tiktok"]');

  const overlay = page.locator('[data-camaleonic-overlay]');
  await expect(overlay).toBeVisible();
  expect(context.pages().length).toBe(pagesBefore); // no new tab

  const frame = page.frameLocator('[data-camaleonic-modal] iframe');
  await expect(frame.getByText(/uses Camaleonic to link/i)).toBeVisible();
});
```

- [ ] **Step 3: Add the script**

In `connect-tool/package.json` `scripts`: `"e2e": "playwright test"`.

- [ ] **Step 4: Run it (host + connect-ui + POC running)**

Run: `cd connect-tool && npm run e2e`
Expected: PASS — overlay visible, no new tab, consent text present. Adjust host login selectors to match `social_media_dashboard/public/index.html`.

- [ ] **Step 5: Commit**

```bash
git add connect-tool/e2e connect-tool/package.json connect-tool/package-lock.json
git commit -m "test(connect-tool): e2e — connect opens an in-page modal"
```

---

## Final: open a PR

- [ ] Push the branch and open a PR summarizing the three-layer change, linking the spec.

```bash
git push -u origin feat/connect-iframe-modal
gh pr create --fill --base main
```
