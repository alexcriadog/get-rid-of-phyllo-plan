// Streamable HTTP MCP endpoint at /mcp/t/:token. Runs the transport in
// stateless mode (a fresh McpServer + transport per request), which is the
// simplest correct shape for a read-only tool server and needs no session
// store. GET/DELETE return 405 (no standalone SSE stream in stateless mode).

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
import { StreamableHTTPServerTransport } from "./sdk";
import { McpServerFactory } from "./mcp-server.factory";
import {
  McpConnectionTokenGuard,
  type RequestWithMcpWorkspace,
} from "./mcp-connection-token.guard";

const METHOD_NOT_ALLOWED = {
  jsonrpc: "2.0" as const,
  error: {
    code: -32000,
    message: "Method not allowed: this MCP server is stateless (POST only).",
  },
  id: null,
};

@Controller("mcp/t/:token")
@UseGuards(McpConnectionTokenGuard)
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(private readonly factory: McpServerFactory) {}

  @Post()
  async handle(
    @Req() req: RequestWithMcpWorkspace,
    @Res() res: Response,
  ): Promise<void> {
    const workspaceId = req.mcpWorkspaceId as string;
    const server = this.factory.forWorkspace(workspaceId);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void Promise.resolve(transport.close()).catch(() => undefined);
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      this.logger.error(
        `MCP request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal error" },
          id: null,
        });
      }
    }
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
