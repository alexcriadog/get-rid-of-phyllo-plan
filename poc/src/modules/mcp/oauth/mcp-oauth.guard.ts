// Bearer-token guard for the OAuth-authenticated MCP endpoint (POST /mcp).
// Resolves the access token to a workspace and attaches it to the request. On a
// missing/invalid token it returns 401 with a WWW-Authenticate challenge that
// points MCP clients (Claude/ChatGPT) at the protected-resource metadata so
// they can start the OAuth flow (per the MCP authorization spec).

import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { OAuthStoreService } from "./oauth-store.service";
import { protectedResourceMetadataUrl } from "./oauth-metadata";

export type RequestWithMcpWorkspace = Request & { mcpWorkspaceId?: string };

@Injectable()
export class McpOAuthGuard implements CanActivate {
  constructor(private readonly store: OAuthStoreService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithMcpWorkspace>();
    const res = context.switchToHttp().getResponse<Response>();
    const header = req.headers.authorization ?? "";
    const tokenValue = header.startsWith("Bearer ")
      ? header.slice("Bearer ".length).trim()
      : "";
    const resolved = tokenValue
      ? await this.store.resolveAccessToken(tokenValue)
      : null;
    if (!resolved) {
      res.setHeader(
        "WWW-Authenticate",
        `Bearer resource_metadata="${protectedResourceMetadataUrl()}"`,
      );
      throw new HttpException(
        {
          jsonrpc: "2.0",
          error: { code: -32001, message: "Unauthorized: OAuth required" },
          id: null,
        },
        401,
      );
    }
    req.mcpWorkspaceId = resolved.workspaceId;
    return true;
  }
}
