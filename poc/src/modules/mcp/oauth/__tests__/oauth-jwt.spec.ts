import { createHash } from "node:crypto";
import { signJwt, verifyJwt } from "../oauth-jwt";
import { verifyPkce } from "../oauth-store.service";

describe("oauth-jwt", () => {
  const secret = "test-secret";

  it("round-trips a payload", () => {
    const t = signJwt({ a: "x", workspace_id: "w1" }, secret, 60);
    const p = verifyJwt<{ a: string; workspace_id: string }>(t, secret);
    expect(p?.a).toBe("x");
    expect(p?.workspace_id).toBe("w1");
  });

  it("rejects a wrong secret", () => {
    const t = signJwt({ a: "x" }, secret, 60);
    expect(verifyJwt(t, "other-secret")).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const t = signJwt({ a: "x" }, secret, 60);
    const [h, , s] = t.split(".");
    const forged = Buffer.from(
      JSON.stringify({ a: "y", exp: 9999999999 }),
      "utf8",
    ).toString("base64url");
    expect(verifyJwt(`${h}.${forged}.${s}`, secret)).toBeNull();
  });

  it("rejects an expired token", () => {
    const t = signJwt({ a: "x" }, secret, -1);
    expect(verifyJwt(t, secret)).toBeNull();
  });
});

describe("verifyPkce (S256)", () => {
  it("accepts a correct verifier", () => {
    const verifier = "abc123def456ghi789jkl012mno345pqr678stuv";
    const challenge = createHash("sha256")
      .update(verifier, "utf8")
      .digest("base64url");
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it("rejects a wrong verifier", () => {
    const challenge = createHash("sha256")
      .update("right-verifier", "utf8")
      .digest("base64url");
    expect(verifyPkce("wrong-verifier", challenge)).toBe(false);
  });
});
