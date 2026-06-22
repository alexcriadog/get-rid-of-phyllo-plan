// MCP SDK access shim.
//
// The connector compiles to CommonJS with classic ("node") module resolution,
// which does NOT read a package's `exports` map. `@modelcontextprotocol/sdk`
// (v1.x, `type: module`) only exposes its entrypoints through `exports`, so a
// bare `@modelcontextprotocol/sdk/server/mcp.js` import fails to type-check
// here — while Node at RUNTIME enforces that same `exports` map and forbids
// reaching into `dist/cjs/...` directly.
//
// We bridge the gap in one place: declare the minimal structural types we use
// locally, and pull the runtime values from the `exports`-valid subpath via
// `require` (the SDK ships a CJS build behind the `./*` wildcard export).
//
// TODO: replace this shim with normal imports once the connector adopts
// `moduleResolution: node16`.

export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export type McpToolCallback = (
  args: Record<string, unknown>,
) => Promise<McpToolResult> | McpToolResult;

export interface McpToolConfig {
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpServerLike {
  registerTool(name: string, config: McpToolConfig, cb: McpToolCallback): unknown;
  connect(transport: unknown): Promise<void>;
}

export interface McpServerCtor {
  new (info: { name: string; version: string }): McpServerLike;
}

export interface StreamableTransportLike {
  handleRequest(req: unknown, res: unknown, parsedBody?: unknown): Promise<void>;
  close(): Promise<void> | void;
}

export interface StreamableTransportCtor {
  new (opts: {
    sessionIdGenerator: undefined | (() => string);
    enableJsonResponse?: boolean;
  }): StreamableTransportLike;
}

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js") as {
  McpServer: McpServerCtor;
};
const { StreamableHTTPServerTransport } = require(
  "@modelcontextprotocol/sdk/server/streamableHttp.js",
) as { StreamableHTTPServerTransport: StreamableTransportCtor };
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */

export { McpServer, StreamableHTTPServerTransport };
