// OAuth discovery documents (RFC 8414 authorization-server metadata + RFC 9728
// protected-resource metadata) and the canonical endpoint URLs. The connector
// is reached under a path prefix, so the issuer is the host root and all
// endpoints live under /mcp/oauth/* (routed to the api by Caddy via /mcp*).

import { MCP_PUBLIC_BASE_URL, MCP_OAUTH_SCOPE } from "../constants";

export function issuer(): string {
  return MCP_PUBLIC_BASE_URL;
}

export function resourceUrl(): string {
  return `${MCP_PUBLIC_BASE_URL}/mcp`;
}

export function protectedResourceMetadataUrl(): string {
  return `${MCP_PUBLIC_BASE_URL}/.well-known/oauth-protected-resource`;
}

export function authorizationServerMetadata(): Record<string, unknown> {
  const base = MCP_PUBLIC_BASE_URL;
  return {
    issuer: issuer(),
    authorization_endpoint: `${base}/mcp/oauth/authorize`,
    token_endpoint: `${base}/mcp/oauth/token`,
    registration_endpoint: `${base}/mcp/oauth/register`,
    revocation_endpoint: `${base}/mcp/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    scopes_supported: [MCP_OAUTH_SCOPE],
  };
}

export function protectedResourceMetadata(): Record<string, unknown> {
  return {
    resource: resourceUrl(),
    authorization_servers: [issuer()],
    scopes_supported: [MCP_OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_documentation: `${MCP_PUBLIC_BASE_URL}/`,
  };
}
