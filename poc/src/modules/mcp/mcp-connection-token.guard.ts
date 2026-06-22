// Resolves the /mcp/t/:token path param to a workspace id and attaches it to
// the request (mirrors ApiBasicAuthGuard's req.apiWorkspaceId contract). On an
// invalid/revoked token it returns false → 403, which MCP clients treat as an
// auth failure. Phase 2 will return 401 + WWW-Authenticate for OAuth discovery.

import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { McpConnectionTokenService } from "./connection-token.service";

export type RequestWithMcpWorkspace = Request & { mcpWorkspaceId?: string };

@Injectable()
export class McpConnectionTokenGuard implements CanActivate {
  constructor(private readonly tokens: McpConnectionTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithMcpWorkspace>();
    const token = (req.params as { token?: string }).token ?? "";
    const workspaceId = token ? await this.tokens.resolve(token) : null;
    if (!workspaceId) return false;
    req.mcpWorkspaceId = workspaceId;
    return true;
  }
}
