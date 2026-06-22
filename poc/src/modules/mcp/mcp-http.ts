// Shared stateless Streamable HTTP request handler used by both MCP endpoints
// (the Phase-1 token-in-path controller and the Phase-2 OAuth-bearer
// controller). A fresh McpServer + transport per request.

import { Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "./sdk";
import { McpServerFactory } from "./mcp-server.factory";

export async function runMcpRequest(
  factory: McpServerFactory,
  workspaceId: string,
  req: Request,
  res: Response,
  logger: Logger,
): Promise<void> {
  const server = factory.forWorkspace(workspaceId);
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
    logger.error(
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
