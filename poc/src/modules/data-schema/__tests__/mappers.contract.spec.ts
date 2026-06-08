import * as fs from "fs";
import * as path from "path";
import type {
  ProfileData,
  ContentData,
  AudienceData,
} from "@modules/platforms/shared/platform-types";
import type { SchemaContext } from "../context";
import { toApiProfile } from "../mappers/profile.mapper";
import { toApiContent } from "../mappers/content.mapper";
import { toApiAudience } from "../mappers/audience.mapper";
import { diffShape } from "./shape";

const FIX = path.join(__dirname, "fixtures");
const load = (f: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));

const ctx: SchemaContext = {
  accountPk: "13",
  platform: "instagram",
  endUserId: "user-1",
  endUserName: "1117_1",
  platformUsername: "camaleonicanalytics",
  canonicalUserId: "50425727770",
  createdAt: new Date("2026-03-03T12:00:00.000Z"),
  updatedAt: new Date("2026-06-05T11:12:04.637Z"),
};

describe("profile mapper is a structural superset of InsightIQ", () => {
  const profile: ProfileData = {
    username: "camaleonicanalytics",
    displayName: "Camaleonic Analytics",
    biography: "bio",
    avatarUrl: "https://img",
    profileUrl: "https://instagram.com/camaleonicanalytics",
    followersCount: 422,
    followingCount: 112,
    postsCount: 309,
    verified: false,
    accountType: "BUSINESS",
    website: "https://linktr.ee/camaleonic",
    fetchedAt: new Date("2026-06-05T11:12:03.940Z"),
  };

  for (const f of [
    "sample-profile-instagram.json",
    "sample-profile-youtube.json",
    "sample-profile-tiktok.json",
  ]) {
    test(`covers every key of ${f}`, () => {
      const expected = load(f);
      const actual = toApiProfile(ctx, profile) as unknown;
      const problems = diffShape(expected, actual).filter((p) =>
        p.includes("MISSING"),
      );
      expect(problems).toEqual([]);
    });
  }
});

describe("content mapper is a structural superset of InsightIQ", () => {
  const content: ContentData = {
    platformContentId: "18094040162248157",
    contentType: "story",
    caption:
      "Do you want to know the hidden metrics of your posts? #metrics @camaleonicanalytics",
    permalink: "https://www.instagram.com/stories/camaleonicanalytics/123",
    mediaUrls: ["https://media"],
    thumbnailUrl: "https://thumb",
    metrics: {
      likes: 0,
      comments: 0,
      shares: 0,
      views: 107,
      reach: 86,
      extra: {
        tap_exits: 29,
        tap_forwards: 49,
        swipe_forwards: 13,
        profile_visits: 0,
        followers_gained: 0,
      },
    },
    insights: {
      trafficSources: [{ label: "FOR_YOU", value: 0.8, unit: "percent" }],
      audienceGenders: [{ label: "female", value: 0.6, unit: "percent" }],
      audienceTypes: [{ label: "NEW_VIEWER", value: 0.7, unit: "percent" }],
    },
    publishedAt: new Date("2026-06-04T09:49:23.000Z"),
    fetchedAt: new Date("2026-06-05T08:11:30.142Z"),
    rawResponse: { collection: "raw_platform_responses", contentHash: "x" },
  };

  for (const f of [
    "sample-content-instagram.json",
    "sample-content-tiktok.json",
    "sample-content-youtube.json",
  ]) {
    test(`covers every key of ${f}`, () => {
      const expected = load(f);
      const actual = toApiContent(ctx, content) as unknown;
      const problems = diffShape(expected, actual).filter((p) =>
        p.includes("MISSING"),
      );
      expect(problems).toEqual([]);
    });
  }

  test("engagement object has every InsightIQ key", () => {
    const expected = load("sample-content-tiktok.json").engagement as Record<
      string,
      unknown
    >;
    const actual = (
      toApiContent(ctx, content) as unknown as {
        engagement: Record<string, unknown>;
      }
    ).engagement;
    const problems = diffShape(expected, actual).filter((p) =>
      p.includes("MISSING"),
    );
    expect(problems).toEqual([]);
  });

  test("story navigation maps from metrics.extra", () => {
    const out = toApiContent(ctx, content);
    expect(out.engagement.additional_info?.story_navigation?.tap_exits).toBe(
      29,
    );
    expect(out.type).toBe("STORY");
  });
});

describe("audience mapper is a structural superset of InsightIQ", () => {
  const audience: AudienceData = {
    genderDistribution: [
      { label: "female", value: 60, unit: "count" },
      { label: "male", value: 40, unit: "count" },
    ],
    ageDistribution: [{ label: "25-34", value: 50, unit: "count" }],
    countryDistribution: [
      { label: "ES", value: 62, unit: "count" },
      { label: "US", value: 10, unit: "count" },
    ],
    cityDistribution: [{ label: "Madrid", value: 5, unit: "count" }],
    fetchedAt: new Date("2026-05-30T11:10:00.350Z"),
  };

  test("covers every key of sample-audience-instagram.json", () => {
    const expected = load("sample-audience-instagram.json");
    const actual = toApiAudience(ctx, audience) as unknown;
    const problems = diffShape(expected, actual).filter((p) =>
      p.includes("MISSING"),
    );
    expect(problems).toEqual([]);
  });

  test("country buckets become {code,value} as 0..100 percent", () => {
    const out = toApiAudience(ctx, audience);
    const es = out.countries.find((c) => c.code === "ES");
    expect(es).toBeDefined();
    expect(es!.value).toBeGreaterThan(50);
    expect(es!.value).toBeLessThanOrEqual(100);
  });
});
