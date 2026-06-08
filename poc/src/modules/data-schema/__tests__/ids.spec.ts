import {
  apiAccountId,
  apiContentId,
  apiProfileId,
  apiUserId,
  apiUserIdOrFallback,
} from "../ids";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("canonical ids (UUIDv5, deterministic)", () => {
  test("produces RFC-4122 v5 UUIDs", () => {
    expect(apiAccountId("13")).toMatch(UUID_RE);
    expect(apiContentId("13", "abc")).toMatch(UUID_RE);
  });

  test("is stable across calls (idempotent re-sync)", () => {
    expect(apiAccountId("13")).toBe(apiAccountId("13"));
    expect(apiContentId("13", "abc")).toBe(apiContentId("13", "abc"));
  });

  test("different inputs → different ids", () => {
    expect(apiAccountId("13")).not.toBe(apiAccountId("14"));
    expect(apiProfileId("13")).not.toBe(apiAccountId("13"));
    expect(apiContentId("13", "a")).not.toBe(apiContentId("13", "b"));
  });

  test("user fallback is stable and distinct from real end-user id", () => {
    const fb = apiUserIdOrFallback(null, "13");
    expect(fb).toMatch(UUID_RE);
    expect(fb).toBe(apiUserIdOrFallback(undefined, "13"));
    expect(fb).not.toBe(apiUserId("13"));
  });
});
