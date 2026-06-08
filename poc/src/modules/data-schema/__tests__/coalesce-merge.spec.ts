import { coalesceMerge } from "../coalesce-merge";

describe("coalesceMerge — keep last known good on null/empty", () => {
  test("null new scalar keeps old value", () => {
    expect(coalesceMerge(1983, null as unknown as number)).toBe(1983);
    expect(coalesceMerge("x", undefined as unknown as string)).toBe("x");
  });

  test("real new scalar wins (incl. a lower number / zero)", () => {
    expect(coalesceMerge(1983, 1900)).toBe(1900);
    expect(coalesceMerge(10, 0)).toBe(0);
  });

  test("empty new array keeps old non-empty array", () => {
    expect(coalesceMerge([1, 2], [])).toEqual([1, 2]);
  });

  test("non-empty new array replaces", () => {
    expect(coalesceMerge([1, 2], [3])).toEqual([3]);
  });

  test("nested: null leaves fall back, present leaves win", () => {
    const oldDoc: Record<string, unknown> = {
      reputation: { follower_count: 1983, following_count: 50 },
      image_url: "https://logo",
      full_name: "Old",
    };
    const newDoc: Record<string, unknown> = {
      reputation: { follower_count: null, following_count: 55 },
      image_url: null,
      full_name: "New",
    };
    expect(coalesceMerge(oldDoc, newDoc)).toEqual({
      reputation: { follower_count: 1983, following_count: 55 },
      image_url: "https://logo",
      full_name: "New",
    });
  });

  test("engagement all-null keeps prior engagement", () => {
    const oldDoc: Record<string, unknown> = {
      engagement: { like_count: 14, comment_count: 0, view_count: 408 },
    };
    const newDoc: Record<string, unknown> = {
      engagement: { like_count: null, comment_count: null, view_count: null },
    };
    expect(coalesceMerge(oldDoc, newDoc)).toEqual(oldDoc);
  });

  test("first write (no old doc) returns new as-is", () => {
    const newDoc = { a: 1, b: null };
    expect(coalesceMerge(undefined, newDoc)).toEqual(newDoc);
  });
});
