# Connection Portal

**Status:** Stable reference
**Last updated:** 2026-06-04
**Answers question:** Q5 — Where does the Connect UI live? Separate project? Monorepo?

A "connection portal" is whatever the creator interacts with to connect their platform account. Today Phyllo's Connect SDK was an embedded React widget in `frontend-app`. The replacement must serve the same purpose without becoming a new standalone deployable or forcing a monorepo on a 3-person team.

---

## 0. Token normalisation invariant (since 2026-05-04)

Regardless of which path the operator uses to seed an account — the structured discovery UI, the "Manual connect" form, the public `POST /accounts/seed`, or any helper script — the connector now guarantees that **only Page (or System User) access tokens land in `oauth_tokens`** for the Meta family.

Why it matters: Meta's app-level rate limit (`200 × Daily Active Users` per hour) only counts calls made with User access tokens. Page tokens for FB and IG_User/Page tokens for IG are exempt. Persisting a User token by accident burns the global app-level cap on every call. Pre-2026-05 there were three seed paths in the codebase (UI, controller, scripts) and each had its own validation; the manual form in particular passed whatever the operator typed straight to the AES vault.

The invariant lives in `AccountsService.seedAccount()` (`poc/src/modules/accounts/accounts.service.ts`):

1. If `platform ∈ {facebook, instagram}`, call `GET /me/accounts?fields=id,access_token,instagram_business_account{id}` with the supplied token.
2. If the response is a list of pages → it's a User token. Find the page that matches `canonical_user_id` (page id for FB, `instagram_business_account.id` for IG) and replace the token with that page's `access_token`.
3. If the response is `(#100) nonexisting field (accounts)` → the token is already a Page token. Probe `GET /{canonical_user_id}?fields=id` to verify it actually accesses the requested resource, then accept it as-is.
4. Anything else → throw `BadRequestException` with the upstream Meta error. No silent persistence.

For Threads the analogous invariant is the long-lived exchange in `seedConnection` (admin.service.ts): `ThreadsTokenRefreshService.exchangeShortLived()` is called before persistence so what we store is always a 60d token with `expires_at` populated. The refresh service then proactively refreshes when there are <7 days left.

---

## 0.5. Per-connection product scope invariant (since 2026-06-03)

A client can scope an **individual connection** to a subset of its workspace's
enabled products by passing `products` (`Record<platform, productId[]>`) when
minting the SDK token (`POST /v1/sdk-tokens`). Example: a "basic" account that
must not collect Ads data is minted with `products: { facebook: ["identity",
"audience"] }`.

The invariant: **an account's enrolled `sync_jobs` ⊆ (token product scope ∩
workspace allow-list)**, enforced at three independent layers:

1. **Mint** — `buildConnectionProductScope()`
   (`poc/src/modules/sdk-tokens/connection-products.ts`) rejects any product
   outside the workspace allow-list with a 400, injects `identity`, and signs
   the result into the JWT as the `products` claim. The end user cannot widen
   it.
2. **connect-tool** — `intersectConnectionProducts()`
   (`connect-tool/lib/workspace-config.ts`) merges the claim over
   `workspace.products`; the effective config drives the OAuth scope set
   (`computeOAuthScopes`, so the consent screen only asks for the scoped
   products' scopes) and the confirm/page-picker display. The seed handlers
   clamp the final enrolment with `clampProductsToScope()`.
3. **Seed** — POC `seedAccount()` independently re-enforces the workspace
   ceiling via `enforceWorkspaceProducts()` (unchanged, pre-existing).

A token without the `products` claim behaves exactly as before — the full
workspace allow-list. Platforms the claim omits keep the workspace default;
only listed platforms are narrowed.

Caveat for demos: on Twitch the `identity` product is labelled
"Channel + followers + subs" and already carries all of Twitch's scopes, while
`engagement_new` ("VODs + clips") adds none — so the OAuth consent looks
identical with or without the scope; the difference is the enrolled products.
Facebook/YouTube show the scope reduction clearly (`ads_read` / analytics
scopes drop).

References: implementation plan
`docs/superpowers/plans/2026-06-03-per-connection-product-scope.md`; client
docs in `connect-tool/sdk/README.md` ("Per-connection product scope").

---

## 1. Decision (D-13)

**Embed the Connect UI in `frontend-app`. Keep repos separate. Publish a shared types package for the contract between connector and backend-api.**

- Connector exposes `POST /v1/connect/initiate` and `GET /oauth/callback/:platform`.
- Frontend-app hosts the UI that triggers the flow and handles the post-OAuth landing.
- Backend-api brokers: frontend → backend-api → connector (never frontend → connector directly).
- Shared types live in `@camaleonic/connector-contract`, published privately (GitHub Packages).
- **No monorepo.** Three repos stay as they are: `connector`, `socialmedia-backend`, `frontend-app`.

---

## 2. Why embedded (not hosted, not separate repo, not monorepo)

| Option | Cost | Trade-off |
|---|---|---|
| **A. Embedded in frontend-app** ★ | Minimal | Frontend learns platform names + logos. Acceptable. |
| B. Hosted portal served by connector | Medium | Reusable by future mobile / B2B partners. New subdomain to maintain. Not needed for phase 1. |
| C. Separate `connect-portal` repo | High | Independent deploy, duplicate CI, duplicate auth story. Premature. |
| D. Monorepo (Turborepo/Nx) | Very high | Shared build tooling — but for 3 repos of different tech/teams, overhead > benefit. |

Rationale for A:
1. Only consumer today is `frontend-app`. No need to generalize yet.
2. UX lives closest to where the user already is (inside the dashboard).
3. Branding, i18n, styling, error-state copy all reuse frontend-app's existing systems.
4. Adding a "hosted portal" later is additive — the connector's `/v1/connect/initiate` doesn't care who calls it.

If later we need mobile or B2B partner onboarding, we **extract** the Connect flow to its own hosted portal. Connector stays untouched. This is a documented **future option**, not a requirement.

---

## 3. Repo strategy — three repos, one shared package

```
┌─────────────────────────┐     ┌───────────────────────────┐     ┌──────────────────────┐
│  connector              │     │  socialmedia-backend      │     │  frontend-app        │
│  (new repo)             │     │  (existing repo)          │     │  (existing repo)     │
│                         │     │                           │     │                      │
│  Nest.js service        │     │  Nest.js service          │     │  React/Next frontend │
│  Publishes →            │     │  Consumes →               │     │  Consumes →          │
│  `@camaleonic/          │     │  `@camaleonic/            │     │  its own `backend-   │
│   connector-contract`   │     │   connector-contract`     │     │   api` client only   │
│                         │     │  (types + zod schemas)    │     │  (unchanged)         │
│                         │     │                           │     │                      │
└─────────┬───────────────┘     └─────────────┬─────────────┘     └──────────┬───────────┘
          │                                    │                              │
          │ publishes package                  │ depends on package           │ calls backend-api
          ▼                                    │                              │
    ┌─────────────────────┐                    │                              │
    │ GitHub Packages     │                    │                              │
    │ (npm private)       │◄───────────────────┘                              │
    │ @camaleonic/        │                                                   │
    │  connector-contract │                                                   │
    └─────────────────────┘                                                   │
                                                                              ▼
                                                          ┌──────────────────────────────────┐
                                                          │  user's browser                  │
                                                          │  renders Connect UI              │
                                                          │  redirects to platform OAuth     │
                                                          │  returns via connector callback  │
                                                          └──────────────────────────────────┘
```

**Why not monorepo:**
- Each repo has different tech, different deploy cadence, different owners.
- Monorepo tools (Turborepo, Nx, pnpm workspaces) add build complexity, CI complexity, and force everyone to learn the tool.
- At 3 people, the ceremony cost dominates the benefit.
- **If code volume in the shared package ever justifies it, switch then.** Today it's ~500 lines of types.

---

## 4. The shared contract package

`@camaleonic/connector-contract` published to GitHub Packages (private npm registry).

**Contents:**
```
packages/connector-contract/
├── package.json                    @camaleonic/connector-contract
├── tsconfig.json
├── src/
│   ├── index.ts                    re-exports everything
│   ├── api/
│   │   ├── connect.ts              POST /v1/connect/initiate request/response types
│   │   ├── accounts.ts             GET /v1/accounts, /v1/accounts/:id/{profile,audience,contents}
│   │   ├── refresh.ts              POST /v1/accounts/:id/refresh
│   │   └── admin.ts                admin endpoints (tiers, cadence overrides)
│   ├── events/
│   │   ├── account.ts              account.connected, account.disconnected, account.needs_reauth, etc.
│   │   ├── content.ts              content.added, content.updated, content.deleted
│   │   ├── audience.ts             audience.updated
│   │   └── refresh.ts              refresh.completed
│   ├── enums.ts                    Platform, Product, SyncTier, Priority
│   └── schemas/                    Zod schemas mirroring the types
└── README.md
```

**Publishing flow:**
1. Change the types in the connector repo (authoritative source).
2. CI on main branch bumps the package version (semver) and publishes to GitHub Packages.
3. Backend-api PR updates the dep version when needed.
4. Breaking changes = major version bump = explicit adoption decision on backend-api side.

**Why shared package and not copy-paste types:**
- Drift between connector's emit shape and backend-api's receive shape → silent runtime bugs.
- Shared package = compile-time type safety across the boundary.
- Zod schemas enable runtime validation (HMAC-verified body → parse → typed handler).

**Why GitHub Packages:**
- Free, private, uses existing GitHub auth (same tokens CI already has).
- No separate infra to set up (vs. Verdaccio, AWS CodeArtifact).

---

## 5. Authentication flow — three-hop call chain

```
┌────────────┐       user is logged in        ┌──────────────┐
│ frontend-  │ ─── JWT / session cookie ────► │ backend-api  │
│    app     │                                │              │
└────────────┘                                │   decides    │
                                              │  authorize   │
                                              │   rewrite    │
                                              │    call      │
                                              ▼               │
                              Service-Token (long-lived       │
                              per-env secret in Secrets       │
                              Manager) over private           │
                              network                         │
                                              │               │
                                              ▼               │
                                        ┌─────────────────────┴──┐
                                        │ connector              │
                                        │ authenticates via      │
                                        │ Service-Token header;  │
                                        │ no user session        │
                                        └────────────────────────┘
```

- **Frontend-app ↔ backend-api:** existing JWT/session. Unchanged.
- **Backend-api ↔ connector:** `Authorization: Service-Token <token>`. The token is a long-lived secret stored in AWS Secrets Manager under `/connector/{env}/service-tokens/backend-api`. Rotated on ops schedule; connector accepts multiple valid tokens during rotation window (same pattern as outbound HMAC multi-secret).
- **Connector never sees end-user identity.** It operates on `account_id` from backend-api's side. Backend-api is responsible for authorizing "does user X own account Y?" before calling the connector.

This gate is deliberate — it prevents frontend-app from directly hitting the connector (bypassing authz). The connector has no concept of "user."

---

## 6. OAuth flow — user's journey

```
Step 1: User clicks "Connect Instagram" in frontend-app
        │
        ▼
Step 2: frontend-app → backend-api (POST /integrations/initiate-connect)
        │              { platform: 'instagram', org_id: '...' }
        │
        ▼
Step 3: backend-api authorizes + calls connector
        │    POST /v1/connect/initiate
        │    { platform: 'instagram', user_id, org_id, return_url: 'https://app.camaleonic.com/integrations/result' }
        │
        ▼
Step 4: connector
        │  • generates state nonce (Redis oauth:state:{nonce} TTL 10min, bound to platform+user+org)
        │  • constructs authorize_url with required scopes
        │  • returns { authorize_url, state }
        │
        ▼
Step 5: backend-api returns { authorize_url } to frontend-app
        │
        ▼
Step 6: frontend-app redirects browser to authorize_url
        │  (user now sees Instagram's consent screen)
        │
        ▼
Step 7: User consents on Instagram → browser redirects to
        │  GET https://connector.<env>.internal/oauth/callback/instagram?code=...&state=...
        │
        ▼
Step 8: connector callback handler:
        │  • validates state nonce (single-use; deletes from Redis)
        │  • exchanges code for tokens via adapter.exchangeCode()
        │  • resolves canonical platform user ID (per-platform; retries if needed)
        │  • upserts account, encrypts + stores tokens
        │  • enqueues backfill jobs (identity, audience, engagement)
        │  • emits `account.connected` event
        │  • 302 redirect → return_url + ?result=success&account_id=<id>
        │
        ▼
Step 9: browser lands on https://app.camaleonic.com/integrations/result?result=success&account_id=<id>
        │  frontend-app renders success state; may trigger re-fetch of account list
```

Failure paths:
- **User declines consent:** platform redirects with `error=access_denied` → connector redirects to `return_url?result=declined`.
- **State expired or tampered:** connector redirects to `return_url?result=state_invalid`. No account created.
- **Canonical ID resolution fails (FB page, TikTok user info):** retries per adapter; if all fail, redirect with `return_url?result=canonical_id_failed`. Account marked `pending_resolution_failed` in connector DB for ops replay.
- **Token exchange fails (network, platform 5xx):** same pattern, `return_url?result=token_exchange_failed`.

All failure result-codes have a matching copy key in frontend-app's i18n (es/en).

---

## 7. Deep linking, post-connect landing, edge cases

**Deep link back after OAuth:**
- `return_url` is passed through at initiate time, preserved through state, and used on callback.
- For security, `return_url` must match a whitelist of allowed origins (configured per env). Rejected otherwise.
- Common values: `https://app.<env>.camaleonic.com/integrations/connect/result`, or deep-specific paths for flows triggered from different dashboards.

**Multiple tabs / double submit:**
- State nonce is single-use. Second callback with same state returns 410 Gone → `return_url?result=state_reused`.
- Frontend-app should disable the "Connect" button during flow to avoid this, but the backend enforces.

**User reconnects an already-connected account:**
- Connector detects existing account by canonical platform user ID; updates tokens, marks as `ready`, emits `account.reconnected` event.
- Backend-api clears any `needs_reauth` flag.

**User connects account owned by another org (cross-org share):**
- Connector upserts to `account_organizations` (N:N); account keeps original owning org.
- Event `account.shared_with_organization` emitted; backend-api applies visibility policy.

---

## 8. Adding a new platform — impact on this flow

Zero impact on the Connect portal architecture itself. When a new platform is added:

1. Adapter implements `buildAuthorizeUrl(state, scopes, return_url)` as part of `PlatformAdapter` port.
2. A new entry in frontend-app's platforms list (logo, display name, scope summary copy).
3. `connector.buildAuthorizeUrl('<new-platform>', ...)` just works — the generic endpoint dispatches to the adapter.
4. `/oauth/callback/:platform` route is platform-parameterized; no new route needed.

The single point of change in frontend-app is the platform-picker UI. Everything else is dispatch through the port.

---

## 9. ADR

See [`adr/0013-connection-portal-placement.md`](adr/0013-connection-portal-placement.md) for the decision to embed + shared contract package. Alternatives considered and rejected:
- **Hosted portal from day 1** — rejected, no consumer other than frontend-app in phase 1; defer until a second consumer appears.
- **Monorepo** — rejected for 3-person team, tooling overhead > shared-code benefit.
- **Copy-paste types between repos** — rejected, drift risk; shared package is cheap insurance.
- **Connector endpoint directly exposed to frontend-app (bypass backend-api)** — rejected, authz concerns; backend-api stays the gate.

---

## 10. Related docs

- [`05-api-contract.md`](05-api-contract.md) — OpenAPI for `/v1/connect/initiate` and callback
- [`06-event-catalog.md`](06-event-catalog.md) — `account.connected`, `account.reconnected`, etc.
- [`08-operations/security.md`](08-operations/security.md) — service-token rotation, state nonce management
- [`07-platforms/*.md`](07-platforms/) — per-platform scope lists, canonical ID resolvers
- [`09-migration/backend-api-changes.md`](09-migration/backend-api-changes.md) — changes in backend-api for adapter swap
