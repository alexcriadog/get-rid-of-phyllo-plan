import { McpToolsService } from "../mcp-tools.service";
import type { ApiReadService } from "@modules/data-api/read.service";
import type {
  ApiAccountResolver,
  ResolvedAccount,
} from "@modules/data-api/account-resolver.service";

function resolverWith(rows: Array<Partial<ResolvedAccount>>): ApiAccountResolver {
  return {
    accountsFor: jest.fn().mockResolvedValue(rows),
    byAccountUuid: jest.fn(),
  } as unknown as ApiAccountResolver;
}

describe("McpToolsService", () => {
  it("reports no accounts when the workspace is empty", async () => {
    const svc = new McpToolsService({} as unknown as ApiReadService, resolverWith([]));
    await expect(svc.listAccounts("ws")).resolves.toMatch(/No connected accounts/);
  });

  it("refuses content whose account is not in the workspace (tenancy)", async () => {
    const read = {
      contentById: jest
        .fn()
        .mockResolvedValue({ doc: { id: "c1" }, accountPk: "999" }),
    } as unknown as ApiReadService;
    // Workspace owns account pk "1", not "999".
    const svc = new McpToolsService(read, resolverWith([{ id: BigInt(1) }]));
    await expect(svc.getContentAnalytics("ws", "c1")).resolves.toMatch(
      /No content found/,
    );
  });

  it("returns analytics for content the workspace owns", async () => {
    const doc = {
      id: "c1",
      type: "VIDEO",
      format: null,
      published_at: "2026-04-01",
      url: null,
      engagement: {
        like_count: 10,
        comment_count: 2,
        share_count: null,
        save_count: null,
        view_count: 100,
        impression_organic_count: null,
        reach_organic_count: null,
        impression_paid_count: null,
      },
    };
    const read = {
      contentById: jest.fn().mockResolvedValue({ doc, accountPk: "1" }),
    } as unknown as ApiReadService;
    const svc = new McpToolsService(read, resolverWith([{ id: BigInt(1) }]));
    const out = await svc.getContentAnalytics("ws", "c1");
    expect(out).toMatch(/Likes: 10/);
    expect(out).toMatch(/Views: 100/);
  });
});
