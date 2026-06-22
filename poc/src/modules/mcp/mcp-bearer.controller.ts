// OAuth-authenticated MCP endpoint (Phase 2) at POST /mcp. The access token
// (Authorization: Bearer) is resolved to a workspace by McpOAuthGuard; on a
// missing/invalid token the guard returns 401 + WWW-Authenticate so the client
// starts the OAuth flow. Stateless transport, shared with the Phase-1 endpoint.

import {
  Controller,
  Delete,
  Get,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { McpServerFactory } from "./mcp-server.factory";
import {
  McpOAuthGuard,
  type RequestWithMcpWorkspace,
} from "./oauth/mcp-oauth.guard";
import { runMcpRequest } from "./mcp-http";

const METHOD_NOT_ALLOWED = {
  jsonrpc: "2.0" as const,
  error: {
    code: -32000,
    message: "Method not allowed: this MCP server is stateless (POST only).",
  },
  id: null,
};

@Controller("mcp")
@UseGuards(McpOAuthGuard)
export class McpBearerController {
  private readonly logger = new Logger(McpBearerController.name);

  constructor(private readonly factory: McpServerFactory) {}

  @Post()
  async handle(
    @Req() req: RequestWithMcpWorkspace,
    @Res() res: Response,
  ): Promise<void> {
    await runMcpRequest(
      this.factory,
      req.mcpWorkspaceId as string,
      req,
      res,
      this.logger,
    );
  }

  @Get()
  getStream(@Res() res: Response): void {
    res.status(405).json(METHOD_NOT_ALLOWED);
  }

  @Delete()
  closeSession(@Res() res: Response): void {
    res.status(405).json(METHOD_NOT_ALLOWED);
  }
}
