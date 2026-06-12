import { CanonicalWriteService } from "../canonical-write.service";

function mockMongo(stored: Array<{ external_id: string; doc: unknown }>) {
  return {
    getCollection: () => ({
      find: () => ({ toArray: async () => stored }),
      bulkWrite: async () => ({ upsertedCount: 0, upsertedIds: {} }),
      findOne: async () => null,
    }),
  } as any;
}
const acct = {
  id: 1n,
  platform: "tiktok",
  canonicalUserId: "u",
  handle: "h",
  endUserId: "e",
  connectedAt: new Date(),
  createdAt: new Date(),
};
const recent = new Date().toISOString();
const old = new Date(Date.now() - 200 * 86400000).toISOString();
// toApiContent reads ContentData.metrics.likes (-> ApiContent.engagement.like_count),
// not content.engagement; the fixture must vary metrics.likes to drive the compare.
const item = (id: string, likes: number, published: string) =>
  ({
    platformContentId: id,
    publishedAt: published,
    metrics: { likes },
  }) as any;

describe("writeContents itemsUpdated", () => {
  it("counts in-window existing posts whose engagement changed", async () => {
    const svc = new CanonicalWriteService(
      mockMongo([{ external_id: "a", doc: { engagement: { like_count: 10 } } }]),
    );
    const d = await (svc as any).writeContents(
      (svc as any).buildContext(acct),
      [item("a", 11, recent)],
      90,
    );
    expect(d.itemsUpdated).toBe(1);
    expect(d.updatedSampleIds).toContain("a");
  });
  it("ignores out-of-window changes", async () => {
    const svc = new CanonicalWriteService(
      mockMongo([{ external_id: "a", doc: { engagement: { like_count: 10 } } }]),
    );
    const d = await (svc as any).writeContents(
      (svc as any).buildContext(acct),
      [item("a", 11, old)],
      90,
    );
    expect(d.itemsUpdated).toBe(0);
  });
  it("ignores unchanged engagement", async () => {
    const svc = new CanonicalWriteService(
      mockMongo([{ external_id: "a", doc: { engagement: { like_count: 10 } } }]),
    );
    const d = await (svc as any).writeContents(
      (svc as any).buildContext(acct),
      [item("a", 10, recent)],
      90,
    );
    expect(d.itemsUpdated).toBe(0);
  });
  it("does not flag a partial fetch that drops a metric to null (compares merged doc)", async () => {
    // Stored doc has like_count=10. The fresh item carries NO likes metric
    // (metrics: {}), so toApiContent yields like_count=null. coalesceMerge
    // keeps the stored 10, so the persisted doc is unchanged → not "updated".
    const svc = new CanonicalWriteService(
      mockMongo([{ external_id: "a", doc: { engagement: { like_count: 10 } } }]),
    );
    const partial = {
      platformContentId: "a",
      publishedAt: recent,
      metrics: {},
    } as any;
    const d = await (svc as any).writeContents(
      (svc as any).buildContext(acct),
      [partial],
      90,
    );
    expect(d.itemsUpdated).toBe(0);
    expect(d.updatedSampleIds).not.toContain("a");
  });
});
