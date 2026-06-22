// Storage + crypto for the MCP OAuth Authorization Server. OAuth state
// (dynamically-registered clients, authorization codes, access/refresh tokens)
// lives in Mongo — short-lived and high-churn, no MySQL migration needed. The
// `cmlk_*` → workspaceId lookup reuses the existing api_keys table (Prisma,
// read-only). Codes/tokens are stored only as SHA-256 hashes; the raw values
// are returned once.

import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { MongoService } from "@shared/database/mongo.service";
import { PrismaService } from "@shared/database/prisma.service";
import { MCP_OAUTH } from "../constants";

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function token(prefix: string, bytes = 32): string {
  return `${prefix}${randomBytes(bytes).toString("base64url")}`;
}

/** PKCE S256: base64url(sha256(verifier)) === challenge. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256")
    .update(verifier, "utf8")
    .digest("base64url");
  return computed === challenge;
}

export interface OAuthClient {
  client_id: string;
  client_secret_hash: string | null; // null for public (PKCE) clients
  client_name: string | null;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  created_at: Date;
}

interface CodeDoc {
  code_hash: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  resource: string | null;
  workspace_id: string;
  used: boolean;
  expires_at: Date;
}

interface TokenDoc {
  access_hash: string;
  refresh_hash: string | null;
  client_id: string;
  workspace_id: string;
  scope: string;
  access_expires_at: Date;
  refresh_expires_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}

@Injectable()
export class OAuthStoreService {
  constructor(
    private readonly mongo: MongoService,
    private readonly prisma: PrismaService,
  ) {}

  private clients() {
    return this.mongo.getCollection<OAuthClient>("mcp_oauth_clients");
  }
  private codes() {
    return this.mongo.getCollection<CodeDoc>("mcp_oauth_codes");
  }
  private tokens() {
    return this.mongo.getCollection<TokenDoc>("mcp_oauth_tokens");
  }

  // ---- Dynamic Client Registration (RFC 7591) ----

  async registerClient(input: {
    clientName?: string;
    redirectUris: string[];
    tokenEndpointAuthMethod?: string;
  }): Promise<{ client: OAuthClient; clientSecret: string | null }> {
    const clientId = token("cmcp_client_", 16);
    const method =
      input.tokenEndpointAuthMethod === "client_secret_post"
        ? "client_secret_post"
        : "none";
    const clientSecret = method === "none" ? null : token("cmcp_csecret_", 24);
    const doc: OAuthClient = {
      client_id: clientId,
      client_secret_hash: clientSecret ? sha256(clientSecret) : null,
      client_name: input.clientName ?? null,
      redirect_uris: input.redirectUris,
      token_endpoint_auth_method: method,
      created_at: new Date(),
    };
    await this.clients().insertOne(doc);
    return { client: doc, clientSecret };
  }

  async getClient(clientId: string): Promise<OAuthClient | null> {
    return this.clients().findOne({ client_id: clientId });
  }

  // ---- Authorization codes ----

  async createCode(input: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    scope: string;
    resource: string | null;
    workspaceId: string;
  }): Promise<string> {
    const code = token("cmcp_code_", 32);
    await this.codes().insertOne({
      code_hash: sha256(code),
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      code_challenge: input.codeChallenge,
      scope: input.scope,
      resource: input.resource,
      workspace_id: input.workspaceId,
      used: false,
      expires_at: new Date(Date.now() + MCP_OAUTH.CODE_TTL_SECONDS * 1000),
    });
    return code;
  }

  /** Single-use: marks the code used and returns it only if valid+fresh+unused. */
  async consumeCode(code: string): Promise<CodeDoc | null> {
    const result = await this.codes().findOneAndUpdate(
      { code_hash: sha256(code), used: false, expires_at: { $gt: new Date() } },
      { $set: { used: true } },
      { returnDocument: "before" },
    );
    return (result as unknown as CodeDoc | null) ?? null;
  }

  // ---- Tokens ----

  async issueTokens(input: {
    clientId: string;
    workspaceId: string;
    scope: string;
  }): Promise<IssuedTokens> {
    const accessToken = token("cmcp_at_", 32);
    const refreshToken = token("cmcp_rt_", 32);
    const now = Date.now();
    await this.tokens().insertOne({
      access_hash: sha256(accessToken),
      refresh_hash: sha256(refreshToken),
      client_id: input.clientId,
      workspace_id: input.workspaceId,
      scope: input.scope,
      access_expires_at: new Date(now + MCP_OAUTH.ACCESS_TTL_SECONDS * 1000),
      refresh_expires_at: new Date(now + MCP_OAUTH.REFRESH_TTL_SECONDS * 1000),
      revoked_at: null,
      created_at: new Date(now),
    });
    return {
      accessToken,
      refreshToken,
      expiresIn: MCP_OAUTH.ACCESS_TTL_SECONDS,
      scope: input.scope,
    };
  }

  /** Resolve a Bearer access token to its workspace, or null if invalid. */
  async resolveAccessToken(
    accessToken: string,
  ): Promise<{ workspaceId: string; scope: string } | null> {
    const row = await this.tokens().findOne({
      access_hash: sha256(accessToken),
    });
    if (!row || row.revoked_at) return null;
    if (row.access_expires_at.getTime() <= Date.now()) return null;
    return { workspaceId: row.workspace_id, scope: row.scope };
  }

  async refresh(refreshToken: string): Promise<IssuedTokens | null> {
    const row = await this.tokens().findOne({
      refresh_hash: sha256(refreshToken),
    });
    if (!row || row.revoked_at) return null;
    if (
      row.refresh_expires_at &&
      row.refresh_expires_at.getTime() <= Date.now()
    ) {
      return null;
    }
    // Rotate: revoke the old token row and issue a fresh pair.
    await this.tokens().updateOne(
      { refresh_hash: sha256(refreshToken) },
      { $set: { revoked_at: new Date() } },
    );
    return this.issueTokens({
      clientId: row.client_id,
      workspaceId: row.workspace_id,
      scope: row.scope,
    });
  }

  async revoke(rawToken: string): Promise<void> {
    const hash = sha256(rawToken);
    await this.tokens().updateOne(
      { $or: [{ access_hash: hash }, { refresh_hash: hash }] },
      { $set: { revoked_at: new Date() } },
    );
  }

  // ---- Identity: cmlk_* workspace API key → workspaceId (existing table) ----

  async resolveWorkspaceByApiKey(
    apiKey: string,
  ): Promise<{ workspaceId: string; slug: string; name: string } | null> {
    const row = await this.prisma.apiKey.findUnique({
      where: { keyHash: sha256(apiKey) },
      select: {
        revokedAt: true,
        workspace: { select: { id: true, slug: true, name: true } },
      },
    });
    if (!row || row.revokedAt) return null;
    return {
      workspaceId: row.workspace.id,
      slug: row.workspace.slug,
      name: row.workspace.name,
    };
  }
}
