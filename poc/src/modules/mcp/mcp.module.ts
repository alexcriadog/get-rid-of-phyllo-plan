import { Module } from "@nestjs/common";
import { DataApiModule } from "@modules/data-api/data-api.module";
import { McpController } from "./mcp.controller";
import { McpServerFactory } from "./mcp-server.factory";
import { McpToolsService } from "./mcp-tools.service";
import { McpConnectionTokenService } from "./connection-token.service";
import { McpConnectionTokenGuard } from "./mcp-connection-token.guard";

/**
 * MCP server (Phase 1, read-only). Exposes the workspace's stats to AI
 * assistants (Claude, ChatGPT, ...) over the Streamable HTTP transport at
 * /mcp/t/:token, reusing the /v1 read layer (DataApiModule). Phase 2 adds the
 * OAuth 2.1 + DCR flow. See docs/MCP-SERVER-DESIGN.md.
 */
@Module({
  imports: [DataApiModule],
  controllers: [McpController],
  providers: [
    McpServerFactory,
    McpToolsService,
    McpConnectionTokenService,
    McpConnectionTokenGuard,
  ],
  exports: [McpConnectionTokenService],
})
export class McpModule {}
