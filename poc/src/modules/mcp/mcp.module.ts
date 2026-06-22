import { Module } from "@nestjs/common";
import { DataApiModule } from "@modules/data-api/data-api.module";
import { SharedDatabaseModule } from "@shared/database/database.module";
import { McpController } from "./mcp.controller";
import { McpBearerController } from "./mcp-bearer.controller";
import { McpServerFactory } from "./mcp-server.factory";
import { McpToolsService } from "./mcp-tools.service";
import { McpConnectionTokenService } from "./connection-token.service";
import { McpConnectionTokenGuard } from "./mcp-connection-token.guard";
import { OAuthStoreService } from "./oauth/oauth-store.service";
import { McpOAuthGuard } from "./oauth/mcp-oauth.guard";
import {
  OAuthDiscoveryController,
  OAuthController,
  McpInternalController,
} from "./oauth/oauth.controller";

/**
 * MCP server. Phase 1: read-only tools at /mcp/t/:token (opaque token).
 * Phase 2: OAuth 2.1 + DCR + PKCE at /mcp (Bearer), with a co-located
 * Authorization Server (/mcp/oauth/*, /.well-known/*) whose consent reuses the
 * /client dashboard session via a signed handoff. See docs/MCP-OAUTH-DESIGN.md.
 */
@Module({
  imports: [DataApiModule, SharedDatabaseModule],
  controllers: [
    McpController,
    McpBearerController,
    OAuthDiscoveryController,
    OAuthController,
    McpInternalController,
  ],
  providers: [
    McpServerFactory,
    McpToolsService,
    McpConnectionTokenService,
    McpConnectionTokenGuard,
    OAuthStoreService,
    McpOAuthGuard,
  ],
  exports: [McpConnectionTokenService],
})
export class McpModule {}
