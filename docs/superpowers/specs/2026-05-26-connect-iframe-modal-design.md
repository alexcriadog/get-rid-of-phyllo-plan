# Camaleonic Connect — Phyllo-style in-page modal

**Date:** 2026-05-26
**Status:** Approved (design)
**Owner:** Alex

## Problem

The Camaleonic Connect SDK (`connect-tool/sdk/src/index.ts`) opens the connect
flow with `window.open(...)`, which the browser degrades to a **full new tab**.
Phyllo (now InsightIQ), the product we are replacing, instead renders an
**in-page modal dialog**: the host app stays visible behind a dimmed backdrop,
and the user walks a multi-step flow (consent → platform chooser → connections
list → pre-OAuth guidance → success) without leaving their tab. Only the actual
provider login (Facebook/Google/TikTok) opens in a separate window, because
those providers send `X-Frame-Options: DENY` and cannot be framed.

Reference: InsightIQ Connect SDK flow —
https://docs.insightiq.ai/docs/api-reference/connect-SDK/connect-SDK-flow

## Goal

Make Camaleonic Connect behave like Phyllo: an in-page iframe modal hosting the
full screen sequence, with the provider login as the only break-out step.
Scope: **full Phyllo parity** (container + screen sequence), plus a single
specified platform skips the chooser.

## Non-goals

- Changing the OAuth token-exchange logic for any platform (reuse
  `lib/platforms.ts` unchanged).
- Changing how accounts are seeded into the POC (`/api/seed-confirm`,
  `/api/seed-pages` unchanged).
- A redirect-based fallback mode (`redirect: true`). Out of scope for now;
  noted as a future option.

## Current architecture (as-is)

The entire flow runs inside the single `window.open`ed window:

1. SDK `window.open`s `baseUrl/?ws&token&origin` (chooser) or
   `baseUrl/api/oauth/start/{platform}?…` (skip chooser).
2. `app/page.tsx` — chooser with 5 platform tiles linking to
   `/api/oauth/start/{platform}`.
3. `app/api/oauth/[...slug]/route.ts` — `start` verifies the SDK token via
   `POST {POC_API_URL}/internal/sdk-tokens/verify`, persists an `oauth-context`
   session (`workspaceId`, `workspaceSlug`, `endUserId`, `allowedPlatforms`,
   `environment`, `openerOrigin`) under a HttpOnly cookie, then **302-redirects
   the window itself** to the provider authorize URL.
4. Provider OAuth runs in that same window; `callback` exchanges the code,
   builds a session, and redirects to `/facebook/pages?session=…` (FB/IG page
   picker) or `/confirm/{platform}?session=…` (product picker).
5. `ConfirmClient` / `FacebookPagesClient` POST to `/api/seed-confirm` /
   `/api/seed-pages`, then `router.push('/success?…')`.
6. `app/success/client.tsx` does `window.opener.postMessage(
   {type:'camaleonic.connect.success', accountIds, platform}, openerOrigin)`
   then `window.close()`.

**Crux:** step 3 navigates the window to the provider. An iframe can't do that,
so the provider step must break out to its own window and relay the result back.

## Target architecture

Three layers change. The OAuth engine, product/page pickers, branding, and
SDK-token verify are reused.

### Layer 1 — SDK (`connect-tool/sdk/src/index.ts`, rebuilt)

- Replace `window.open` with an **injected DOM overlay**: a fixed,
  full-viewport dimmed/blurred backdrop + a centered card containing an
  `<iframe>` whose `src` is the new embedded route
  `{baseUrl}/connect?ws=<slug>&token=<jwt>&origin=<host-origin>&embed=1[&platform=<key>]`.
- New init option **`platform?: PlatformKey`** (singular). Skip-chooser rule:
  if `opts.platform` is set, or `opts.platforms` has exactly one entry, the
  shell starts at that platform and the chooser is skipped. `open(platform)`
  arg still overrides both.
- Host-side `message` listener, **origin-checked against `baseUrl`**, handles:
  - `camaleonic.connect.resize { height }` → set modal height (clamped to
    viewport).
  - `camaleonic.connect.exit` → teardown overlay + `onExit()`.
  - `camaleonic.connect.success { accountIds, platform }` → `onSuccess(...)` +
    teardown.
  - `camaleonic.connect.error { code, message }` → `onError(...)`.
- Close affordances: X button on the card, `Escape`, backdrop click → treated
  as `exit`.
- `close()` tears down the overlay and removes listeners (idempotent).
- The `popup_blocked` error path moves: the iframe always loads, so blockage is
  only possible on the provider window; that is detected inside the shell and
  surfaced via `camaleonic.connect.error { code: 'popup_blocked' }`.
- Public API stays backward compatible: `init(opts)` returns
  `{ open(platform?), close() }`; `version` unchanged shape (bump to `2.0.0`).
- Rebuild `public/connect-sdk.js` from source (existing esbuild step).

### Layer 2 — connect-ui (`connect-tool/app`)

- **New `/connect` embedded shell** — a client component implementing a step
  machine:
  `consent → chooser → connections → guidance → connecting → confirm|fb-picker → success`.
  - `consent`: branded (logo, primary color, title) "{Brand} uses Camaleonic
    to link your accounts" + trust bullets + Continue. Branding from
    `GET {POC_API_URL}/internal/workspaces/{slug}/branding` (already exists).
  - `chooser`: platform tiles (reuse `PlatformTile`); skipped when a single
    platform is set.
  - `connections`: lists the end-user's existing connected accounts for the
    chosen platform (new internal endpoint, Layer 3) + "Add {platform}
    account" + Back.
  - `guidance`: platform-specific pre-OAuth copy + "Login with {provider}"
    button. The click (user gesture) calls
    `window.open('/api/oauth/start/{platform}?ws&token&origin&embed=1', 'camaleonic-oauth', popupFeatures)`.
  - `connecting`: spinner while the provider window is open; poll
    `popup.closed` to detect abandonment → return to `guidance`.
  - `confirm` / `fb-picker`: reuse `ConfirmClient` / `FacebookPagesClient` as
    in-modal components, driven by the `sessionId` relayed from the popup.
  - `success`: "Account connected" + "Add another" (→ chooser/connections) +
    "Done" (→ `parent.postMessage(success)` to the host SDK).
- **Provider break-out + relay**: the `oauth-context` session gains an
  `embedded: boolean` flag (set at `start` when `embed=1`). On `callback`, when
  `embedded` is true, redirect the popup to a **thin `/oauth/complete` relay
  page** instead of the full `/confirm` or `/facebook/pages` page. The relay
  page reads `session`, `kind` (`confirm` | `fb-picker`), `platform`, then
  `window.opener.postMessage({type:'camaleonic.oauth.complete', sessionId, kind,
  platform}, connectOrigin)` and `window.close()`. The shell (in the iframe)
  receives it and advances its step machine. When `embedded` is false, current
  behavior is unchanged (legacy/standalone).
- **Framing policy**: add `connect-tool/middleware.ts` that, for `/connect` and
  its assets, sets `Content-Security-Policy: frame-ancestors 'self' <origin>`
  where `<origin>` is the verified host origin from the SDK-token context
  (fallbacks: omit header for non-embedded requests). Remove any default
  `X-Frame-Options: DENY`. This keeps framing restricted to the legitimate host
  app rather than allowing `*`.
- **Embedded styling**: a compact modal layout variant of the existing
  `v-canvas`/`v-shell` chrome, sized for the iframe; the shell posts
  `camaleonic.connect.resize` on step change so the host modal matches content
  height.

### Layer 3 — POC backend

- **New internal endpoint** `GET /internal/accounts?ws_slug=&end_user_id=&platform=`
  returning the end-user's connected accounts for that workspace/platform:
  `{ data: [{ id, platform, handle, display_name, status, profile_image_url }] }`.
  Reuses `accounts.service` with a `(workspaceId, endUserId[, platform])`
  filter; protected by the same internal guard as the other `/internal/*`
  routes (network-internal / shared secret). Powers the `connections` screen.

## Data flow (embedded happy path)

```
host app                connect-ui (iframe)            provider window           POC
   │  init()+open()         │                               │                     │
   │──inject overlay+iframe─▶ /connect?embed=1               │                     │
   │                        │  consent→chooser→connections   │                     │
   │                        │  →guidance                     │                     │
   │                        │  window.open(start?embed=1) ──▶ /api/oauth/start     │
   │                        │                               │  verify token ──────▶ /internal/sdk-tokens/verify
   │                        │                               │  set ctx cookie     │
   │                        │                               │  302 ─▶ provider    │
   │                        │                               │  user approves      │
   │                        │                               │  302 ─▶ /callback   │
   │                        │                               │  exchange code,     │
   │                        │                               │  putSession         │
   │                        │                               │  302 ─▶ /oauth/complete
   │                        │ ◀── postMessage(oauth.complete, sessionId) + close   │
   │                        │  confirm|fb-picker (in modal)  │                     │
   │                        │  POST seed-confirm/seed-pages ───────────────────────▶ seed
   │                        │  success                       │                     │
   │ ◀ postMessage(success) │                                │                     │
   │  onSuccess(); teardown │                                │                     │
```

## Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| SDK `init/open/close` | overlay lifecycle, message routing, host callbacks | host DOM, iframe origin |
| `/connect` shell | step machine, branding fetch, popup launch, relay handling | branding + accounts internal APIs, ConfirmClient, FacebookPagesClient |
| `/oauth/complete` relay | post sessionId to opener, close | opener origin |
| oauth dispatcher | token verify, ctx (incl. `embedded`), authorize redirect, callback routing | lib/platforms, oauth-context, session |
| `/internal/accounts` | list end-user accounts for connections screen | accounts.service |

## Error handling

- Provider popup blocked → shell shows inline error + retry; SDK gets
  `error{code:'popup_blocked'}`.
- SDK token expired / workspace mismatch / platform not allowed → existing
  `classifyError` copy shown in-modal; SDK gets `error`.
- Duplicate OAuth callback (Chrome prefetch) → already deduped via the
  `callbackInFlight` map in the dispatcher; relay is idempotent (guard on the
  shell side too).
- User closes modal mid-flow (X/ESC/backdrop) → `onExit`.
- Provider window closed before completing → shell returns to `guidance`.

## Testing

- **Unit**: SDK message routing + overlay teardown (jsdom); shell step-machine
  reducer transitions incl. skip-chooser.
- **E2E (Playwright)**: launch `social_media_dashboard`, click Connect, assert
  an in-page iframe modal appears and **no new tab opens**; walk
  consent→chooser→connections→guidance; stub the `camaleonic.oauth.complete`
  relay message to drive confirm→success (real provider OAuth can't run in CI).
- **Visual regression**: modal at 375 / 768 / 1440.

## Rollout / compatibility

- Non-embedded (`embed` absent) requests keep current behavior, so any existing
  standalone usage and the legacy single-tenant flow are unaffected.
- SDK bumped to `2.0.0`; host integration (`social_media_dashboard/public/app.js`)
  continues to call `init().open()` and only gains the optional `platform` opt.

## Open questions (none blocking)

- Consent/guidance copy: use generic defaults now, refine later.
- Whether to later add `redirect: true` full-page fallback for popup-hostile
  environments.
