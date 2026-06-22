// MCP OAuth 2.1 Authorization Server (Phase 2). Endpoints:
//   GET  /.well-known/oauth-authorization-server  — RFC 8414 metadata
//   GET  /.well-known/oauth-protected-resource     — RFC 9728 metadata
//   POST /mcp/oauth/register                        — Dynamic Client Registration (RFC 7591)
//   GET  /mcp/oauth/authorize                       — auth-code + PKCE; delegates consent to the dashboard
//   GET  /mcp/oauth/grant                           — consumes the dashboard handoff, mints the code
//   POST /mcp/oauth/token                           — code→token + refresh
//   POST /mcp/oauth/revoke                          — revoke a token
//   POST /internal/mcp/resolve-workspace            — (internal) cmlk_* → workspace, for the dashboard handoff
//
// Identity comes from the connector's own /client dashboard session via a
// short-lived handoff JWT (signed with the shared CONNECT_TOOL_SECRET) — no
// second login. See docs/MCP-OAUTH-DESIGN.md.

import {
  Body,
  Controller,
  Get,
  HttpException,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { OAuthStoreService, verifyPkce } from "./oauth-store.service";
import { signJwt, verifyJwt } from "./oauth-jwt";
import {
  authorizationServerMetadata,
  protectedResourceMetadata,
} from "./oauth-metadata";
import { MCP_OAUTH, MCP_OAUTH_SCOPE, MCP_PUBLIC_BASE_URL } from "../constants";

function handoffSecret(): string {
  return process.env.CONNECT_TOOL_SECRET || "dev-mcp-oauth-secret";
}

interface AuthReqClaims {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  resource: string | null;
  state: string | null;
}

interface HandoffClaims {
  req: string;
  workspace_id: string;
}

@Controller(".well-known")
export class OAuthDiscoveryController {
  @Get("oauth-authorization-server")
  authServer(): Record<string, unknown> {
    return authorizationServerMetadata();
  }

  @Get("oauth-protected-resource")
  protectedResource(): Record<string, unknown> {
    return protectedResourceMetadata();
  }
}

@Controller("mcp/oauth")
export class OAuthController {
  constructor(private readonly store: OAuthStoreService) {}

  @Post("register")
  async register(
    @Body() body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const redirectUris = Array.isArray(body.redirect_uris)
      ? body.redirect_uris.filter((u): u is string => typeof u === "string")
      : [];
    if (redirectUris.length === 0) {
      throw new HttpException(
        { error: "invalid_redirect_uri", error_description: "redirect_uris is required" },
        400,
      );
    }
    const { client, clientSecret } = await this.store.registerClient({
      clientName:
        typeof body.client_name === "string" ? body.client_name : undefined,
      redirectUris,
      tokenEndpointAuthMethod:
        typeof body.token_endpoint_auth_method === "string"
          ? body.token_endpoint_auth_method
          : undefined,
    });
    return {
      client_id: client.client_id,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      client_id_issued_at: Math.floor(client.created_at.getTime() / 1000),
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: client.token_endpoint_auth_method,
    };
  }

  @Get("authorize")
  async authorize(
    @Query() q: Record<string, string | undefined>,
    @Res() res: Response,
  ): Promise<void> {
    const clientId = q.client_id ?? "";
    const redirectUri = q.redirect_uri ?? "";
    const client = clientId ? await this.store.getClient(clientId) : null;
    // If client/redirect_uri are invalid we cannot safely redirect — fail closed.
    if (!client || !redirectUri || !client.redirect_uris.includes(redirectUri)) {
      throw new HttpException("invalid client_id or redirect_uri", 400);
    }
    const fail = (error: string, desc: string): void => {
      const u = new URL(redirectUri);
      u.searchParams.set("error", error);
      u.searchParams.set("error_description", desc);
      if (q.state) u.searchParams.set("state", q.state);
      res.redirect(302, u.toString());
    };
    if (q.response_type !== "code") {
      return fail("unsupported_response_type", "response_type must be code");
    }
    if (!q.code_challenge || q.code_challenge_method !== "S256") {
      return fail("invalid_request", "PKCE with S256 is required");
    }
    const authReq = signJwt(
      {
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: q.code_challenge,
        scope: q.scope ?? MCP_OAUTH_SCOPE,
        resource: q.resource ?? null,
        state: q.state ?? null,
      },
      handoffSecret(),
      MCP_OAUTH.AUTH_REQUEST_TTL_SECONDS,
    );
    const consent = new URL(`${MCP_PUBLIC_BASE_URL}/client/connect`);
    consent.searchParams.set("req", authReq);
    res.redirect(302, consent.toString());
  }

  @Get("grant")
  async grant(
    @Query() q: Record<string, string | undefined>,
    @Res() res: Response,
  ): Promise<void> {
    const handoff = q.handoff
      ? verifyJwt<HandoffClaims>(q.handoff, handoffSecret())
      : null;
    if (
      !handoff ||
      typeof handoff.req !== "string" ||
      typeof handoff.workspace_id !== "string"
    ) {
      throw new HttpException("invalid handoff", 400);
    }
    const authReq = verifyJwt<AuthReqClaims>(handoff.req, handoffSecret());
    if (!authReq) {
      throw new HttpException("invalid or expired authorization request", 400);
    }
    const code = await this.store.createCode({
      clientId: authReq.client_id,
      redirectUri: authReq.redirect_uri,
      codeChallenge: authReq.code_challenge,
      scope: authReq.scope,
      resource: authReq.resource,
      workspaceId: handoff.workspace_id,
    });
    const u = new URL(authReq.redirect_uri);
    u.searchParams.set("code", code);
    if (authReq.state) u.searchParams.set("state", authReq.state);
    res.redirect(302, u.toString());
  }

  @Post("token")
  async token(
    @Body() body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const grantType = String(body.grant_type ?? "");
    if (grantType === "authorization_code") {
      const code = String(body.code ?? "");
      const redirectUri = String(body.redirect_uri ?? "");
      const clientId = String(body.client_id ?? "");
      const verifier = String(body.code_verifier ?? "");
      const row = code ? await this.store.consumeCode(code) : null;
      if (!row) {
        throw new HttpException(
          { error: "invalid_grant", error_description: "code invalid or expired" },
          400,
        );
      }
      if (row.client_id !== clientId || row.redirect_uri !== redirectUri) {
        throw new HttpException(
          { error: "invalid_grant", error_description: "client/redirect mismatch" },
          400,
        );
      }
      if (!verifier || !verifyPkce(verifier, row.code_challenge)) {
        throw new HttpException(
          { error: "invalid_grant", error_description: "PKCE verification failed" },
          400,
        );
      }
      const t = await this.store.issueTokens({
        clientId: row.client_id,
        workspaceId: row.workspace_id,
        scope: row.scope,
      });
      return {
        access_token: t.accessToken,
        token_type: "Bearer",
        expires_in: t.expiresIn,
        refresh_token: t.refreshToken,
        scope: t.scope,
      };
    }
    if (grantType === "refresh_token") {
      const refreshToken = String(body.refresh_token ?? "");
      const t = refreshToken ? await this.store.refresh(refreshToken) : null;
      if (!t) {
        throw new HttpException(
          { error: "invalid_grant", error_description: "refresh token invalid or expired" },
          400,
        );
      }
      return {
        access_token: t.accessToken,
        token_type: "Bearer",
        expires_in: t.expiresIn,
        refresh_token: t.refreshToken,
        scope: t.scope,
      };
    }
    throw new HttpException({ error: "unsupported_grant_type" }, 400);
  }

  @Post("revoke")
  async revoke(@Body() body: Record<string, unknown>): Promise<{ ok: true }> {
    const tok = String(body.token ?? "");
    if (tok) await this.store.revoke(tok);
    return { ok: true };
  }
}

@Controller("internal/mcp")
export class McpInternalController {
  constructor(private readonly store: OAuthStoreService) {}

  // Guarded by the global InternalAuthGuard (path starts with /internal/).
  // The dashboard's server-side handoff route calls this with the
  // CONNECT_TOOL_SECRET bearer to turn the logged-in client's cmlk_* key into a
  // workspaceId, without exposing the key in the browser.
  @Post("resolve-workspace")
  async resolveWorkspace(
    @Body() body: Record<string, unknown>,
  ): Promise<{ workspace_id: string; slug: string; name: string }> {
    const apiKey = String(body.api_key ?? "");
    const resolved = apiKey
      ? await this.store.resolveWorkspaceByApiKey(apiKey)
      : null;
    if (!resolved) throw new HttpException({ error: "invalid_api_key" }, 401);
    return {
      workspace_id: resolved.workspaceId,
      slug: resolved.slug,
      name: resolved.name,
    };
  }
}
