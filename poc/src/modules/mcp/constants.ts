// MCP server identity, tool names, and paging limits. See docs/MCP-SERVER-DESIGN.md.

export const MCP_SERVER_NAME = "camaleonic-connector";
export const MCP_SERVER_VERSION = "0.1.0";

export const MCP_TOOL = {
  LIST_WORKSPACES: "list_workspaces",
  LIST_ACCOUNTS: "list_accounts",
  GET_ACCOUNT: "get_account",
  GET_ACCOUNT_AUDIENCE: "get_account_audience",
  LIST_CONTENT: "list_content",
  GET_CONTENT_ANALYTICS: "get_content_analytics",
  GET_CONTENT_COMMENTS: "get_content_comments",
  GET_ANALYTICS_OVERVIEW: "get_analytics_overview",
} as const;

export const MCP_DEFAULT_PAGE_LIMIT = 20;
export const MCP_MAX_PAGE_LIMIT = 100;
