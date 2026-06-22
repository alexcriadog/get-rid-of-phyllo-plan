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

// ---- Phase 2 OAuth ----

/** Public base URL of the connector (override per env). */
export const MCP_PUBLIC_BASE_URL =
  process.env.MCP_PUBLIC_BASE_URL ?? "https://smconnector.camaleonicanalytics.com";

/** The read scope advertised + granted (Phase 2 is read-only). */
export const MCP_OAUTH_SCOPE = "social:read";

export const MCP_OAUTH = {
  ACCESS_TTL_SECONDS: 3600,
  REFRESH_TTL_SECONDS: 60 * 60 * 24 * 30,
  CODE_TTL_SECONDS: 300,
  /** TTL of the auth-request token handed to the dashboard. */
  AUTH_REQUEST_TTL_SECONDS: 600,
  /** TTL of the consent handoff token the dashboard signs back. */
  HANDOFF_TTL_SECONDS: 120,
} as const;
