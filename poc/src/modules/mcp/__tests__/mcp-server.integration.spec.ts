// In-process end-to-end check of the MCP wiring: a real MCP SDK client talks
// to our McpServerFactory over the Streamable HTTP transport via a throwaway
// http.Server that mirrors the controller's stateless request handling. No DB —
// the tools service is stubbed — so this validates the transport/protocol path,
// not the data layer (that is covered by mcp-tools.service.spec.ts).

import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "../sdk";
import { McpServerFactory } from "../mcp-server.factory";
import type { McpToolsService } from "../mcp-tools.service";

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require(
  "@modelcontextprotocol/sdk/client/streamableHttp.js",
);
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */

function stubTools(): McpToolsService {
  return {
    listWorkspaces: async () => "Connected workspace `ws_test` — 1 active account(s) (1 total).",
    listAccounts: async () => "Connected accounts (1):",
    getAccount: async () => "**Acme** — instagram",
    getAccountAudience: async () => "**Audience** — Acme",
    listContent: async () => "Content for Acme (showing 0, offset 0):",
    getContentAnalytics: async () => "**Content `c1`**",
    getContentComments: async () => "Comments (0):",
  } as unknown as McpToolsService;
}

describe("MCP server over HTTP (in-process)", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const factory = new McpServerFactory(stubTools());
    server = http.createServer((req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let body: unknown;
        try {
          body = raw ? JSON.parse(raw) : undefined;
        } catch {
          body = undefined;
        }
        const mcp = factory.forWorkspace("ws_test");
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        res.on("close", () => {
          void Promise.resolve(transport.close()).catch(() => undefined);
        });
        void mcp
          .connect(transport)
          .then(() => transport.handleRequest(req, res, body))
          .catch(() => {
            if (!res.headersSent) {
              res.statusCode = 500;
              res.end();
            }
          });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}/mcp/t/faketoken`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("lists all 7 read tools over the wire", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl));
    const client = new Client({ name: "test-client", version: "0.0.1" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t: { name: string }) => t.name).sort();
      expect(names).toEqual(
        [
          "get_account",
          "get_account_audience",
          "get_content_analytics",
          "get_content_comments",
          "list_accounts",
          "list_content",
          "list_workspaces",
        ].sort(),
      );
    } finally {
      await client.close();
    }
  });

  it("calls list_workspaces and returns the tool text", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl));
    const client = new Client({ name: "test-client", version: "0.0.1" });
    await client.connect(transport);
    try {
      const result = await client.callTool({
        name: "list_workspaces",
        arguments: {},
      });
      const content = (result as {
        content: Array<{ type: string; text?: string }>;
      }).content;
      expect(content[0].text).toMatch(/Connected workspace `ws_test`/);
    } finally {
      await client.close();
    }
  });
});
