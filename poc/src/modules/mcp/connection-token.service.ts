// Phase 1 auth: an opaque, revocable "connection token" that the user pastes
// into their AI assistant's connector URL (/mcp/t/<token>). It wraps an
// existing workspace API credential (ApiCredentialsService) so we reuse the
// exact same workspace-scoping as the /v1 read API — no new storage, and the
// raw client_secret never travels as cleartext in the URL.
//
// Phase 2 replaces this with OAuth 2.1 + DCR (see docs/MCP-SERVER-DESIGN.md).

import { Injectable } from "@nestjs/common";
import { ApiCredentialsService } from "@modules/data-api/credentials.service";

const TOKEN_PREFIX = "cmcp_";

export interface MintedConnectionToken {
  token: string;
  workspaceId: string;
  createdAt: string;
}

/** Encode (clientId, clientSecret) into an opaque connection token. */
export function encode(clientId: string, clientSecret: string): string {
  return (
    TOKEN_PREFIX +
    Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64url")
  );
}

/** Decode a connection token back to its credential parts, or null if invalid. */
export function decode(
  token: string,
): { clientId: string; clientSecret: string } | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(token.slice(TOKEN_PREFIX.length), "base64url").toString(
      "utf8",
    );
  } catch {
    return null;
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return null;
  const clientId = decoded.slice(0, sep);
  const clientSecret = decoded.slice(sep + 1);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

@Injectable()
export class McpConnectionTokenService {
  constructor(private readonly creds: ApiCredentialsService) {}

  /** Mint a new connection token for a workspace (issues a fresh credential). */
  async mint(workspaceId: string, label?: string): Promise<MintedConnectionToken> {
    const issued = await this.creds.issue(workspaceId, label ?? "mcp");
    return {
      token: encode(issued.clientId, issued.clientSecret),
      workspaceId,
      createdAt: issued.createdAt,
    };
  }

  /** Resolve a connection token to its workspace id, or null if invalid/revoked. */
  async resolve(token: string): Promise<string | null> {
    const parsed = decode(token);
    if (!parsed) return null;
    return this.creds.verify(parsed.clientId, parsed.clientSecret);
  }
}
