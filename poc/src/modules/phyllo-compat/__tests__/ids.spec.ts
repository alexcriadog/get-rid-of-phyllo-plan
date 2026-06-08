import {
  phylloAccountId,
  phylloContentId,
  phylloProfileId,
  phylloUserId,
  phylloUserIdOrFallback,
} from "../ids";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("phyllo ids (UUIDv5, deterministic)", () => {
  test("produces RFC-4122 v5 UUIDs", () => {
    expect(phylloAccountId("13")).toMatch(UUID_RE);
    expect(phylloContentId("13", "abc")).toMatch(UUID_RE);
  });

  test("is stable across calls (idempotent re-sync)", () => {
    expect(phylloAccountId("13")).toBe(phylloAccountId("13"));
    expect(phylloContentId("13", "abc")).toBe(phylloContentId("13", "abc"));
  });

  test("different inputs → different ids", () => {
    expect(phylloAccountId("13")).not.toBe(phylloAccountId("14"));
    expect(phylloProfileId("13")).not.toBe(phylloAccountId("13"));
    expect(phylloContentId("13", "a")).not.toBe(phylloContentId("13", "b"));
  });

  test("user fallback is stable and distinct from real end-user id", () => {
    const fb = phylloUserIdOrFallback(null, "13");
    expect(fb).toMatch(UUID_RE);
    expect(fb).toBe(phylloUserIdOrFallback(undefined, "13"));
    expect(fb).not.toBe(phylloUserId("13"));
  });
});
