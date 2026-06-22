// Builds a per-workspace McpServer and registers the read-only tools, wiring
// each to McpToolsService. A fresh server is created per request (the transport
// runs stateless), so the workspaceId is captured in the closure.

import { Injectable } from "@nestjs/common";
import { McpServer } from "./sdk";
import type { McpServerLike, McpToolResult } from "./sdk";
import { McpToolsService } from "./mcp-tools.service";
import { MCP_SERVER_NAME, MCP_SERVER_VERSION, MCP_TOOL } from "./constants";
import {
  listAccountsShape,
  getAccountShape,
  getAccountAudienceShape,
  listContentShape,
  getContentAnalyticsShape,
  getContentCommentsShape,
} from "./tool-schemas";

function text(s: string): McpToolResult {
  return { content: [{ type: "text", text: s }] };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

@Injectable()
export class McpServerFactory {
  constructor(private readonly tools: McpToolsService) {}

  forWorkspace(workspaceId: string): McpServerLike {
    const server = new McpServer({
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    });

    server.registerTool(
      MCP_TOOL.LIST_WORKSPACES,
      {
        description:
          "List the workspace(s) this connection can access, with connected-account counts.",
      },
      async () => text(await this.tools.listWorkspaces(workspaceId)),
    );

    server.registerTool(
      MCP_TOOL.LIST_ACCOUNTS,
      {
        description:
          "List connected social accounts in the workspace. Optionally filter by platform (instagram, tiktok, youtube, facebook, ...).",
        inputSchema: listAccountsShape,
      },
      async (args) =>
        text(await this.tools.listAccounts(workspaceId, str(args.platform))),
    );

    server.registerTool(
      MCP_TOOL.GET_ACCOUNT,
      {
        description:
          "Get profile and reputation (followers, following, content count, verified) for one connected account.",
        inputSchema: getAccountShape,
      },
      async (args) =>
        text(await this.tools.getAccount(workspaceId, String(args.account_id))),
    );

    server.registerTool(
      MCP_TOOL.GET_ACCOUNT_AUDIENCE,
      {
        description:
          "Get audience demographics (top countries, cities, gender × age) for one connected account.",
        inputSchema: getAccountAudienceShape,
      },
      async (args) =>
        text(
          await this.tools.getAccountAudience(
            workspaceId,
            String(args.account_id),
          ),
        ),
    );

    server.registerTool(
      MCP_TOOL.LIST_CONTENT,
      {
        description:
          "List recent posts/videos for an account with engagement metrics. Dates are ISO YYYY-MM-DD; when the user names a month, use the most recent occurrence rather than a year from training data.",
        inputSchema: listContentShape,
      },
      async (args) =>
        text(
          await this.tools.listContent(workspaceId, String(args.account_id), {
            fromDate: str(args.from_date),
            toDate: str(args.to_date),
            limit: num(args.limit),
            offset: num(args.offset),
          }),
        ),
    );

    server.registerTool(
      MCP_TOOL.GET_CONTENT_ANALYTICS,
      {
        description:
          "Get detailed analytics for one published post/video (impressions, reach, likes, comments, shares, saves, views).",
        inputSchema: getContentAnalyticsShape,
      },
      async (args) =>
        text(
          await this.tools.getContentAnalytics(
            workspaceId,
            String(args.content_id),
          ),
        ),
    );

    server.registerTool(
      MCP_TOOL.GET_CONTENT_COMMENTS,
      {
        description: "List comments on a published post/video.",
        inputSchema: getContentCommentsShape,
      },
      async (args) =>
        text(
          await this.tools.getContentComments(
            workspaceId,
            String(args.account_id),
            String(args.content_id),
            { limit: num(args.limit), offset: num(args.offset) },
          ),
        ),
    );

    return server;
  }
}
