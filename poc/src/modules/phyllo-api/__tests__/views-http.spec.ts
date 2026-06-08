import { accountView, userView } from "../phyllo-views";
import { parseOffsetLimit, parseDate } from "../phyllo-http";
import { listEnvelope, errorEnvelope } from "@modules/phyllo-compat";
import type { ResolvedAccount } from "../phyllo-account-resolver.service";

const acc: ResolvedAccount = {
  id: 13n,
  platform: "instagram",
  canonicalUserId: "50425727770",
  handle: "camaleonicanalytics",
  displayName: "Camaleonic Analytics",
  status: "ready",
  endUserId: "1117_1",
  isTest: false,
  connectedAt: new Date("2026-03-03T12:00:59.808Z"),
  disconnectedAt: null,
  createdAt: new Date("2026-03-03T12:00:59.808Z"),
  updatedAt: new Date("2026-05-22T11:04:19.486Z"),
};

describe("accountView", () => {
  test("matches the Phyllo account top-level keys", () => {
    const v = accountView(
      acc,
      [
        {
          product: "identity",
          status: "idle",
          lastSuccessAt: new Date("2026-06-05T11:12:04.637Z"),
        },
      ],
      "https://pic",
    );
    for (const k of [
      "id",
      "created_at",
      "updated_at",
      "user",
      "work_platform",
      "username",
      "platform_username",
      "profile_pic_url",
      "status",
      "platform_profile_name",
      "platform_profile_id",
      "platform_profile_published_at",
      "disconnection_source",
      "data",
    ]) {
      expect(v).toHaveProperty(k);
    }
    expect(v.status).toBe("CONNECTED");
    expect((v.work_platform as { id: string }).id).toBe(
      "9bb8913b-ddd9-430b-a66a-d74d846e6c66",
    );
    expect((v.data as { identity: { status: string } }).identity.status).toBe(
      "SYNCED",
    );
  });

  test("disconnected account → NOT_CONNECTED", () => {
    const v = accountView({ ...acc, status: "disconnected" }, [], null);
    expect(v.status).toBe("NOT_CONNECTED");
    expect((v.data as { identity: { status: string } }).identity.status).toBe(
      "NOT_SYNCED",
    );
  });
});

describe("userView", () => {
  test("has Phyllo user keys", () => {
    const v = userView({
      uuid: "u",
      endUserId: "1117_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    for (const k of [
      "name",
      "external_id",
      "id",
      "created_at",
      "updated_at",
      "status",
    ]) {
      expect(v).toHaveProperty(k);
    }
    expect(v.status).toBe("ACTIVE");
  });
});

describe("pagination + envelopes", () => {
  test("parseOffsetLimit clamps", () => {
    expect(parseOffsetLimit(undefined, undefined)).toEqual({
      offset: 0,
      limit: 10,
    });
    expect(parseOffsetLimit("5", "500")).toEqual({ offset: 5, limit: 100 });
    expect(parseOffsetLimit("-3", "0")).toEqual({ offset: 0, limit: 1 });
  });
  test("parseDate", () => {
    expect(parseDate(undefined)).toBeUndefined();
    expect(parseDate("not-a-date")).toBeUndefined();
    expect(parseDate("2026-06-05")).toBeInstanceOf(Date);
  });
  test("listEnvelope shape", () => {
    const e = listEnvelope([1, 2], { offset: 0, limit: 10 });
    expect(e).toEqual({
      data: [1, 2],
      metadata: { offset: 0, limit: 10, from_date: null, to_date: null },
    });
  });
  test("errorEnvelope shape mirrors Phyllo", () => {
    const e = errorEnvelope({
      type: "RECORD_NOT_FOUND",
      code: "incorrect_account_id",
      message: "x",
      statusCode: 404,
      requestId: "r",
    });
    expect(e.error).toMatchObject({
      type: "RECORD_NOT_FOUND",
      code: "incorrect_account_id",
      error_code: "incorrect_account_id",
      status_code: 404,
      http_status_code: 404,
      request_id: "r",
    });
  });
});
