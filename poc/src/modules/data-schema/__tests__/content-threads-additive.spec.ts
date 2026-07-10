// Threads max-capture additive keys on the served /v1 content doc.
//
// Contract under test:
//   1. topic_tag / location / alt_text / link_attachment_url / gif_url /
//      is_spoiler_media / poll appear ONLY when the canonical ContentData
//      carries them — docs from other platforms keep their exact shape.
//   2. metrics.extra.clicks → engagement.click_count and
//      metrics.extra.reposts → engagement.repost_count (existing null slots),
//      while metrics.shares (= Threads reposts) keeps feeding share_count
//      unchanged, so the dashboard mapping never moves.

import type { ContentData } from "@modules/platforms/shared/platform-types";
import type { SchemaContext } from "../context";
import { toApiContent } from "../mappers/content.mapper";

const ctx: SchemaContext = {
  accountPk: "23",
  platform: "threads",
  endUserId: "user-1",
  endUserName: "pito",
  platformUsername: "i.am.pito",
  canonicalUserId: "24359267497097029",
  createdAt: new Date("2026-07-10T11:00:00.000Z"),
  updatedAt: new Date("2026-07-10T12:00:00.000Z"),
};

function baseContent(overrides: Partial<ContentData>): ContentData {
  return {
    platformContentId: "18181270933410270",
    contentType: "image",
    caption: "World cup quarter finals",
    permalink: "https://www.threads.com/@i.am.pito/post/X",
    mediaUrls: ["https://cdn/img.jpg"],
    thumbnailUrl: null,
    metrics: {},
    publishedAt: new Date("2026-07-10T11:54:19.000Z"),
    fetchedAt: new Date("2026-07-10T12:00:00.000Z"),
    rawResponse: { collection: "raw_platform_responses", contentHash: "x" },
    ...overrides,
  };
}

describe("toApiContent — Threads additive keys", () => {
  it("emits the additive keys when the canonical content carries them", () => {
    const doc = toApiContent(
      ctx,
      baseContent({
        topicTag: "World Cup 2026",
        location: {
          id: "1209084156595889",
          name: "Miami, Florida",
          city: "Miami",
          country: "US",
          latitude: 25.7752,
          longitude: -80.192,
        },
        altText: "a football stadium",
        linkAttachmentUrl: "https://example.com/a",
        gifUrl: "https://cdn/g.gif",
        isSpoilerMedia: false,
        poll: {
          options: [
            { label: "Yes", votesPercentage: 75 },
            { label: "No", votesPercentage: 25 },
          ],
          expiresAt: "2026-07-11T11:54:19+0000",
          totalVotes: 4,
        },
      }),
    );
    expect(doc.topic_tag).toBe("World Cup 2026");
    expect(doc.location).toEqual({
      id: "1209084156595889",
      name: "Miami, Florida",
      city: "Miami",
      country: "US",
      latitude: 25.7752,
      longitude: -80.192,
      address: null,
      postal_code: null,
    });
    expect(doc.alt_text).toBe("a football stadium");
    expect(doc.link_attachment_url).toBe("https://example.com/a");
    expect(doc.gif_url).toBe("https://cdn/g.gif");
    expect(doc.is_spoiler_media).toBe(false);
    expect(doc.poll).toEqual({
      options: [
        { label: "Yes", votes_percentage: 75 },
        { label: "No", votes_percentage: 25 },
      ],
      expires_at: "2026-07-11T11:54:19+0000",
      total_votes: 4,
    });
  });

  it("omits every additive key when the content has none (shape unchanged)", () => {
    const doc = toApiContent(ctx, baseContent({})) as unknown as Record<
      string,
      unknown
    >;
    for (const key of [
      "topic_tag",
      "location",
      "alt_text",
      "link_attachment_url",
      "gif_url",
      "is_spoiler_media",
      "poll",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(doc, key)).toBe(false);
    }
  });

  it("routes extra.clicks/extra.reposts into click_count/repost_count without moving share_count", () => {
    const doc = toApiContent(
      ctx,
      baseContent({
        metrics: {
          views: 100,
          likes: 5,
          comments: 2,
          shares: 7, // Threads reposts — historical dashboard mapping
          extra: { quotes: 1, reposts: 7, shares: 3, clicks: 11 },
        },
      }),
    );
    expect(doc.engagement.share_count).toBe(7);
    expect(doc.engagement.repost_count).toBe(7);
    expect(doc.engagement.click_count).toBe(11);
    expect(doc.engagement.view_count).toBe(100);
  });
});
