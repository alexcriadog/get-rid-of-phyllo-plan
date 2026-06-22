import {
  encode,
  decode,
  McpConnectionTokenService,
} from "../connection-token.service";
import type { ApiCredentialsService } from "@modules/data-api/credentials.service";

describe("connection token encode/decode", () => {
  it("round-trips clientId and secret behind the cmcp_ prefix", () => {
    const token = encode("ciqk_abc", "ciqs_secret");
    expect(token.startsWith("cmcp_")).toBe(true);
    expect(token).not.toContain("ciqs_secret"); // not cleartext
    expect(decode(token)).toEqual({
      clientId: "ciqk_abc",
      clientSecret: "ciqs_secret",
    });
  });

  it("preserves a secret that contains ':' characters", () => {
    const token = encode("ciqk_x", "a:b:c");
    expect(decode(token)).toEqual({ clientId: "ciqk_x", clientSecret: "a:b:c" });
  });

  it("rejects tokens without the prefix", () => {
    expect(decode("nope")).toBeNull();
  });

  it("rejects payloads with no separator", () => {
    expect(decode("cmcp_" + Buffer.from("noseparator").toString("base64url"))).toBeNull();
  });
});

describe("McpConnectionTokenService.resolve", () => {
  it("verifies the decoded credential and returns the workspace id", async () => {
    const verify = jest.fn().mockResolvedValue("ws_1");
    const svc = new McpConnectionTokenService({
      verify,
    } as unknown as ApiCredentialsService);
    await expect(svc.resolve(encode("ciqk_x", "ciqs_y"))).resolves.toBe("ws_1");
    expect(verify).toHaveBeenCalledWith("ciqk_x", "ciqs_y");
  });

  it("returns null for an invalid token without calling verify", async () => {
    const verify = jest.fn();
    const svc = new McpConnectionTokenService({
      verify,
    } as unknown as ApiCredentialsService);
    await expect(svc.resolve("garbage")).resolves.toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });
});
