# MCP Server — Design

> Status: **DESIGN / not yet implemented** · Author: investigation 2026-06-22 · Owner: connector (`poc/`)

## 1. Goal & scope

Expose our connector's data to AI assistants (Claude, ChatGPT, Gemini, …) through a single
**Model Context Protocol (MCP)** server, so an end user can connect their workspace from their
assistant and ask things like *"give me the metrics of my Instagram account this month"*.

Reference / prior art: **OmniSocials** (`https://mcp.omnisocials.com/`) does exactly this — one
remotely-hosted MCP server, co-located OAuth 2.1 Authorization Server with Dynamic Client
Registration (DCR) + PKCE, mapping OAuth tokens to a workspace API key. Confirmed live from their
public discovery docs on 2026-06-22.

**Phasing:**

| Phase | Scope | Auth | Outcome |
|-------|-------|------|---------|
| **1 — MVP** | Read-only analytics tools over the existing `/v1` data layer | Opaque connection token in the MCP URL (maps to a workspace credential) | Works in any MCP client today; zero new auth infra |
| **2 — Connect UX** | Same tools, polished "Connect → Authorize → done" flow; multi-client | OAuth 2.1 + PKCE + DCR (co-located AS), parity with OmniSocials | Self-serve connect from Claude/ChatGPT/Gemini |
| **3 — Write** *(later)* | Scheduling / publishing tools | adds `social:write` scope | Feature parity with OmniSocials |

This document covers Phases 1 and 2. Phase 3 is out of scope here.

## 2. Where it lives (repo placement)

One new NestJS domain module, following the exact convention of `src/modules/data-api/`. **No
existing files move.** The MCP module *reuses* the `/v1` read layer — it does not re-implement it.

```
poc/src/modules/mcp/
├── __tests__/
│   ├── mcp-tools.service.spec.ts
│   └── connection-token.service.spec.ts
├── mcp.module.ts                 # imports DataApiModule → reuses ReadService
├── mcp.controller.ts             # Streamable HTTP endpoint: POST/GET/DELETE /mcp
├── mcp-server.factory.ts         # builds the McpServer instance + registers tools
├── mcp-tools.service.ts          # tool impls → call ReadService / account resolver
├── tool-schemas.ts               # zod input schema per tool (zod is already a dep)
├── connection-token.service.ts   # Phase 1: opaque URL token → workspaceId
├── constants.ts                  # tool names, server name/version, scopes
└── oauth/                        # Phase 2 (added later, same module)
    ├── oauth.controller.ts       # /.well-known/* · /authorize · /token · /register · /revoke
    ├── well-known.ts             # protected-resource + authorization-server metadata
    ├── client-registry.service.ts# DCR (RFC 7591): each assistant = its own client_id
    ├── token.service.ts          # issue/validate/revoke access+refresh tokens → workspace
    └── session.service.ts        # concurrent MCP sessions (Redis)
```

**Touch-points outside the module (minimal):**
- `src/app.module.ts` — one line: add `McpModule` to `imports`.
- `prisma/schema.prisma` — Phase 2 only: new models (§7).
- `docker-compose.yml` + `src/main.ts` — only if/when we split MCP into its own process (§8).
- Caddy (reverse proxy on `ec2-conn`) — one TLS route to the MCP endpoint (§8). **HTTPS is
  mandatory**: Claude/ChatGPT/Gemini only accept `https` connectors.

## 3. Transport

**Streamable HTTP** (the only remote transport the major assistants support). We use the official
`@modelcontextprotocol/sdk` (`StreamableHTTPServerTransport`). This is the **only new runtime
dependency**.

NestJS wiring — a controller hands the raw Express `req`/`res` to the transport:

```ts
// mcp.controller.ts (sketch)
@Controller('mcp')
export class McpController {
  @Post()
  async handle(@Req() req: Request, @Res() res: Response) {
    const workspaceId = req.mcpWorkspaceId;          // set by auth (§5/§6)
    const { server } = this.factory.forWorkspace(workspaceId);
    const transport = await this.sessions.transportFor(req, res); // session-aware
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
  @Get()    handleStream(...) { /* SSE stream for server→client */ }
  @Delete() handleClose(...)  { /* terminate Mcp-Session-Id */ }
}
```

> Note: `main.ts` mounts `express.raw` only for `/webhooks/ingest/*`; the MCP route uses the normal
> JSON body parser. `transport.handleRequest(req, res, req.body)` receives the parsed body.

## 4. Tool surface (Phase 1, read-only)

Every tool resolves the workspace from auth (never trusts a workspace id from the model), then calls
the **existing** `ReadService` / account resolver. Tool inputs validated with **zod**. Results are
returned as structured text (Markdown tables + a JSON block) so they render identically across
clients.

Backing methods that already exist (`src/modules/data-api/read.service.ts`):
`profileByAccountPk`, `profileById`, `audienceByAccountPk`, `contents`, `contentById`,
`contentsByIds`, `comments`. Account listing/resolution via the existing accounts controller +
`account-resolver.service.ts`.

| Tool | Input (zod) | Maps to | Returns |
|------|-------------|---------|---------|
| `list_workspaces` | — | credential/token → workspaces in scope | workspace names + connected-account counts |
| `list_accounts` | `{ platform? }` | accounts controller (workspace-scoped) | connected accounts: id, platform, username, follower_count |
| `get_account` | `{ account_id }` | `profileByAccountPk` | profile + `reputation` (followers/following/content_count/…) |
| `get_account_audience` | `{ account_id }` | `audienceByAccountPk` | countries / cities / gender×age distribution |
| `list_content` | `{ account_id, from_date?, to_date?, limit?, offset? }` | `contents(...)` | posts/videos with engagement metrics |
| `get_content_analytics` | `{ content_id }` | `contentById` | per-post impressions/engagements/likes/comments/shares/views + insights |
| `get_content_comments` | `{ account_id, content_id, limit?, offset? }` | `comments(...)` | comments on a post |

Notes:
- `account_id` accepted from the model is the **public account UUID** (the `/v1` `id`), resolved to
  the internal `accountPk` inside the service — identical to how `/v1` does it.
- Tool descriptions carry date-handling guidance ("use the most recent April, not training-cutoff
  April"), mirroring OmniSocials' tool prompts.
- All list tools honour the same pagination + `from_date`/`to_date` semantics as `/v1`.

## 5. Auth — Phase 1 (opaque connection token)

Fastest path that works in every client *today*, with no OAuth server yet.

- The user mints a **connection token** from the dashboard. It's an opaque, revocable string bound
  to one workspace credential (we reuse `ApiCredentialsService.issue(workspaceId)` underneath, and
  wrap its `clientId:clientSecret` behind an opaque token so the raw secret never travels in a URL).
- The MCP connector URL embeds it in the **path** (not query — fewer logs leak):
  `https://mcp.<domain>/t/<connectionToken>/mcp`.
- A guard (`McpConnectionTokenGuard`) resolves the token → `workspaceId` → `req.mcpWorkspaceId`,
  reusing the same workspace-scoping contract as `ApiBasicAuthGuard` (`req.apiWorkspaceId`).
- Multi-workspace (OmniSocials-style): allow comma-separated tokens → `list_workspaces` +
  `switch_workspace`.

Why not raw Basic creds in the URL: secrets in URLs end up in proxy/access logs. The opaque token is
independently revocable and never exposes the underlying `client_secret`.

**Phase-1 known limitations (revisit in Phase 2):**
- The `:token` path param is effectively a bearer credential. The edge proxy (Caddy) **must redact
  `/mcp/t/*` paths from access logs**; the app's own metric route label already normalises ids.
- No rate limiting on `/mcp/t/:token` yet — add coarse per-IP throttling before public exposure.
- Invalid token currently returns `403`; the MCP-correct response is `401` + `WWW-Authenticate`
  (lands with the Phase-2 OAuth discovery work).

## 6. Auth — Phase 2 (OAuth 2.1 + PKCE + DCR, multi-client)

This is the parity flow and the answer to **"how do we support many clients (Claude, ChatGPT,
Gemini, …)"**: **one server, client-agnostic.** Each assistant self-registers via DCR.

**Discovery (served by `oauth.controller.ts`):**
- `GET /.well-known/oauth-protected-resource` →
  `{ resource, authorization_servers:[<self>], scopes_supported:["social:read","social:write"], resource_documentation }`
- `GET /.well-known/oauth-authorization-server` (RFC 8414) →
  `issuer, authorization_endpoint:/authorize, token_endpoint:/token, registration_endpoint:/register,
   revocation_endpoint:/revoke, response_types_supported:["code"], grant_types_supported:["authorization_code","refresh_token"],
   code_challenge_methods_supported:["S256"], token_endpoint_auth_methods_supported:["client_secret_post","none"]`
- On any `401` from `/mcp`, return `WWW-Authenticate` pointing at the protected-resource metadata so
  clients can auto-discover the AS (per MCP auth spec).

**Endpoints:**
- `POST /register` — **Dynamic Client Registration (RFC 7591)**. Each assistant registers itself
  → gets its own `client_id` + declares its own `redirect_uri`. Claude = one client, ChatGPT =
  another, Gemini = another. **No per-client code.**
- `GET /authorize` — auth-code flow with **PKCE S256**. Renders our consent screen (choose
  workspace(s) to expose), then redirects back to the client's registered `redirect_uri` with a code.
- `POST /token` — exchanges code (+ PKCE verifier) for an access token + refresh token; also handles
  `refresh_token` grant. Public clients (`none`) supported via PKCE.
- `POST /revoke` — revoke a client's tokens (per `client_id`, independent of other clients).

**Token → data mapping:** every issued access token records `(client_id, workspaceId, scope)`.
Validation resolves `workspaceId` → `req.mcpWorkspaceId`, then the *exact same* workspace-scoping as
`/v1`. Whether the token came from Claude or ChatGPT is irrelevant to the data layer.

**Multi-client / multi-tenant matrix:** N clients × M users.
- Same workspace can be connected from Claude *and* ChatGPT simultaneously → two distinct tokens,
  same `workspaceId`.
- Revoking ChatGPT's token does not affect Claude's.
- Per-client `redirect_uri` validated against what was captured at registration; plus a **soft
  allow-list of known client hosts** (`claude.ai`, `chatgpt.com`, Gemini's, `localhost` in dev) —
  this is where the pending **Sec-4 per-workspace origin allow-list** plugs in.

**What differs per client (and how it's absorbed):** redirect URIs (captured at DCR), MCP capability
support (we target the baseline: plain tools + JSON-schema inputs + structured-text results, no
optional features), and how the user adds a connector (ChatGPT needs "Developer mode"; Gemini has
its own UX) — all client-side; **the server is unchanged.** We do **not** submit our app to
Anthropic/OpenAI/Google for the custom-connector path (self-serve). Official directory listings are
a separate, optional, later step.

## 7. Data model additions (Phase 2)

New Prisma models (MySQL), following the existing `ApiCredential` style. Phase 1 needs none beyond a
thin wrapper over `api_credentials`.

```prisma
model McpOauthClient {            // one row per registered assistant (DCR)
  id               String   @id @default(cuid())
  clientId         String   @unique @map("client_id")
  clientSecretHash String?  @map("client_secret_hash") // null for public (PKCE) clients
  clientName       String?  @map("client_name")
  redirectUris     Json     @map("redirect_uris")
  createdAt        DateTime @default(now()) @map("created_at")
  @@map("mcp_oauth_clients")
}

model McpAuthorizationCode {      // short-lived; PKCE challenge stored here
  code             String   @id
  clientId         String   @map("client_id")
  workspaceId      String   @map("workspace_id")
  codeChallenge    String   @map("code_challenge")
  scope            String
  expiresAt        DateTime @map("expires_at")
  @@map("mcp_authorization_codes")
}

model McpAccessToken {            // access + refresh; tokens stored encrypted/hashed
  id               String    @id @default(cuid())
  tokenHash        String    @unique @map("token_hash")
  refreshTokenHash String?   @unique @map("refresh_token_hash")
  clientId         String    @map("client_id")
  workspaceId      String    @map("workspace_id")
  scope            String
  expiresAt        DateTime  @map("expires_at")
  revokedAt        DateTime? @map("revoked_at")
  createdAt        DateTime  @default(now()) @map("created_at")
  @@index([clientId])
  @@index([workspaceId])
  @@map("mcp_access_tokens")
}
```

**Sessions** (Streamable HTTP `Mcp-Session-Id`) are ephemeral → **Redis** (`src/shared/redis/`),
keyed `mcp:session:<id>` → `{ workspaceId, clientId, createdAt }`, with TTL. This keeps the server
horizontally scalable and lets sessions survive across api-process replicas or a dedicated mcp
process. Token secrets encrypted with `src/shared/crypto/` (same approach as the rest of the repo);
DB stores only hashes for lookup.

## 8. Deployment

**Phase 1 (footprint zero):** `McpModule` is registered in `AppModule` and served by the **existing
`api` process** under `/mcp`. No `main.ts` change, no compose change. Add a Caddy route to port 3000.

**Process isolation (when LLM traffic justifies it):**
- `src/main.ts`: extend `type Mode` and `VALID_MODES` with `'mcp'`, add `bootstrapMcp()` (mirror of
  `bootstrapApi()`, listens on `MCP_PORT`, e.g. **3003** — avoids 3000 api / 3001 web-dev / 3002
  connect-tool). Reuses `startOpsServer` for `/healthz` + `/metrics` on the private `OPS_PORT 9464`.
- `docker-compose.yml`: 4th service `mcp` from the same `poc-app` image,
  `command: [... "src/main.ts", "mcp"]`, `ports: ["3003:3003"]`, same `env_file`/`depends_on`.
- Because MCP is already a self-contained module, this split is a small change, not a rewrite.

**Caddy / `ec2-conn`:** terminate TLS for `mcp.<domain>` (or path-route `/mcp`) → MCP port. The
private `OPS_PORT` is never routed (matches the existing `main.ts` comment).

## 9. Cross-cutting

- **Observability:** every process already serves `/healthz` + `/metrics`; add MCP counters
  (tool-call count/latency/errors, active sessions) to `src/shared/metrics/prometheus`.
- **Rate limiting:** reuse the per-workspace limiter that already protects `/v1`
  (`RateLimitInterceptor`) — LLMs can be chatty.
- **Read-only safety:** Phase 1/2 tools are strictly read; no mutation reaches the connector.
- **CORS:** MCP clients are server-to-server (not browser), so no CORS relaxation needed for `/mcp`.
- **Audit:** log tool calls into the existing `ApiCallLog` model for traceability.

## 10. Dependencies

- **Add:** `@modelcontextprotocol/sdk` (runtime).
- **Reuse:** `zod` (already a dep), `ioredis`, `@prisma/client`, `@nestjs/*`, `src/shared/crypto`,
  `src/shared/redis`, `src/modules/data-api` (`ReadService`, `ApiCredentialsService`).

## 11. Implementation checklist

**Phase 1 (MVP)**
- [ ] `npm i @modelcontextprotocol/sdk`
- [ ] `src/modules/mcp/` module skeleton (constants, schemas, factory, controller, tools service)
- [ ] `connection-token.service.ts` + `McpConnectionTokenGuard` (opaque token → workspaceId)
- [ ] 7 read tools wired to `ReadService` + account resolver
- [ ] Register `McpModule` in `AppModule`; Caddy route + TLS
- [ ] Dashboard: "Connect to AI assistant" → mint/copy connection URL + revoke
- [ ] Tests: tool schemas, workspace scoping, token resolution
- [ ] Manual verify: connect from Claude **and** ChatGPT, ask for account metrics

**Phase 2 (OAuth/DCR)**
- [ ] Prisma models (§7) + migration
- [ ] `oauth/` subfolder: well-known docs, `/register` (DCR), `/authorize` (PKCE S256), `/token`, `/revoke`
- [ ] Consent screen (workspace selection)
- [ ] Token issue/validate/revoke + refresh; `WWW-Authenticate` on 401
- [ ] Redis session store; soft redirect-host allow-list (ties into Sec-4)
- [ ] Verify discovery + full connect flow across Claude / ChatGPT / Gemini

## 12. Open decisions

1. **Subdomain vs path** for the endpoint (`mcp.<domain>/mcp` vs `<domain>/mcp`). Subdomain is
   cleaner for Caddy/TLS and matches OmniSocials.
2. **Phase 1 auth surface in clients** — confirm each target client accepts a token-in-URL connector
   (it does for the URL-based custom connector); otherwise jump straight to Phase 2 OAuth.
3. **Where connection-token minting lives in the dashboard UI** (likely next to existing API-key
   management in the admin surface).
4. **Process split timing** — ship Phase 1 inside the `api` process; split to a dedicated `mcp`
   process before any meaningful external traffic.
