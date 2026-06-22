import { McpToolsService } from "../mcp-tools.service";
import type { ApiReadService } from "@modules/data-api/read.service";
import type {
  ApiAccountResolver,
  ResolvedAccount,
} from "@modules/data-api/account-resolver.service";

function resolverWith(rows: Array<Partial<ResolvedAccount>>): ApiAccountResolver {
  return {
    accountsFor: jest.fn().mockResolvedValue(rows),
    byAccountUuid: jest.fn().mockResolvedValue(rows[0] ?? null),
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
    const svc = new McpToolsService(read, resolverWith([{ id: BigInt(1) }]));
    await expect(svc.getContentAnalytics("ws", "c1")).resolves.toMatch(
      /No content found/,
    );
  });

  it("returns rich analytics (caption, hashtags, metrics) for owned content", async () => {
    const doc = {
      id: "c1",
      type: "VIDEO",
      format: null,
      published_at: "2026-04-01",
      url: null,
      title: "Sponsorship deep dive",
      description: "what brands pay for",
      hashtags: ["#Sponsorship", "#SportsBiz"],
      mentions: [],
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
    expect(out).toMatch(/#Sponsorship/);
    expect(out).toMatch(/Sponsorship deep dive/);
  });

  it("forwards the hashtag filter to the read layer", async () => {
    const contents = jest.fn().mockResolvedValue([]);
    const read = { contents } as unknown as ApiReadService;
    const acc = {
      id: BigInt(1),
      platform: "instagram",
      handle: "h",
      displayName: "H",
      status: "ready",
    };
    const resolver = {
      accountsFor: jest.fn(),
      byAccountUuid: jest.fn().mockResolvedValue(acc),
    } as unknown as ApiAccountResolver;
    const svc = new McpToolsService(read, resolver);
    await svc.listContent("ws", "acc-uuid", { hashtag: "#Sponsorship" });
    expect(contents).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({ hashtag: "#Sponsorship" }),
    );
  });

  it("aggregates an analytics overview with totals", async () => {
    const engagementSummary = jest.fn().mockResolvedValue([
      {
        accountPk: "1",
        posts: 3,
        likes: 30,
        comments: 6,
        shares: 3,
        saves: 0,
        views: 1000,
        impressions: 0,
        reach: 0,
      },
    ]);
    const read = { engagementSummary } as unknown as ApiReadService;
    const resolver = {
      accountsFor: jest.fn().mockResolvedValue([
        {
          id: BigInt(1),
          platform: "instagram",
          handle: "h",
          displayName: "H",
          status: "ready",
        },
      ]),
    } as unknown as ApiAccountResolver;
    const svc = new McpToolsService(read, resolver);
    const out = await svc.getAnalyticsOverview("ws", { period: "30d" });
    expect(out).toMatch(/Analytics overview/);
    expect(out).toMatch(/3 posts/);
    expect(engagementSummary).toHaveBeenCalled();
  });
});
