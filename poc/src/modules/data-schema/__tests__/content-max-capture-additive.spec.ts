// Max-capture additive keys on the served /v1 content doc — all platforms.
// Companion to content-threads-additive.spec.ts; field map in
// docs/max-capture-all-platforms.md.
//
// Contract under test:
//   1. Every max-capture key appears ONLY when the canonical ContentData
//      carries it — a plain post keeps its exact historical shape.
//   2. Phyllo-canonical slots get FILLED instead of new keys being invented:
//      TikTok is_ad → sponsored, IG collaborators → collaboration + authors,
//      FB shares → engagement.share_count, FB message_tags → mentions,
//      TikTok/LinkedIn duration → duration.
//   3. Type normalizations: YouTube hasCaptions "true"/"false" → boolean,
//      concurrentViewers numeric string → number, durations → int seconds.

import type { ContentData } from "@modules/platforms/shared/platform-types";
import type { SchemaContext } from "../context";
import { toApiContent } from "../mappers/content.mapper";

const ctx: SchemaContext = {
  accountPk: "23",
  platform: "instagram",
  endUserId: "user-1",
  endUserName: "pito",
  platformUsername: "i.am.pito",
  canonicalUserId: "17841400000000000",
  createdAt: new Date("2026-07-16T11:00:00.000Z"),
  updatedAt: new Date("2026-07-16T12:00:00.000Z"),
};

function baseContent(overrides: Partial<ContentData>): ContentData {
  return {
    platformContentId: "18181270933410270",
    contentType: "image",
    caption: "quarter finals",
    permalink: "https://example.com/p/X",
    mediaUrls: ["https://cdn/img.jpg"],
    thumbnailUrl: null,
    metrics: {},
    publishedAt: new Date("2026-07-16T11:54:19.000Z"),
    fetchedAt: new Date("2026-07-16T12:00:00.000Z"),
    rawResponse: { collection: "raw_platform_responses", contentHash: "x" },
    ...overrides,
  };
}

const MAX_CAPTURE_KEYS = [
  "link_attachment_title",
  "media_product_type",
  "embed_url",
  "category_id",
  "default_language",
  "default_audio_language",
  "upload_status",
  "is_comment_enabled",
  "is_shared_to_feed",
  "definition",
  "dimension",
  "has_captions",
  "licensed_content",
  "license",
  "embeddable",
  "public_stats_viewable",
  "made_for_kids",
  "live_broadcast_content",
  "topic_categories",
  "recording_date",
  "recording_location",
  "live_streaming_details",
  "is_featured",
  "source_video_id",
];

describe("toApiContent — max-capture additive keys (all platforms)", () => {
  it("a plain post emits NONE of the max-capture keys and keeps null slots", () => {
    const doc = toApiContent(ctx, baseContent({}));
    for (const key of MAX_CAPTURE_KEYS) {
      expect(doc).not.toHaveProperty(key);
    }
    expect(doc.sponsored).toBeNull();
    expect(doc.collaboration).toBeNull();
    expect(doc.authors).toBeNull();
    expect(doc.engagement.additional_info).toBeNull();
  });

  it("Instagram: alt text, comment toggle, shared-to-feed, product type, collab", () => {
    const doc = toApiContent(
      ctx,
      baseContent({
        altText: "a football stadium",
        isCommentEnabled: true,
        isSharedToFeed: false,
        mediaProductType: "REELS",
        collaborators: ["colab.user"],
      }),
    );
    expect(doc.alt_text).toBe("a football stadium");
    expect(doc.is_comment_enabled).toBe(true);
    expect(doc.is_shared_to_feed).toBe(false);
    expect(doc.media_product_type).toBe("REELS");
    expect(doc.authors).toEqual(["colab.user"]);
    expect(doc.collaboration).toEqual({ has_collaboration: true });
  });

  it("TikTok: is_ad fills sponsored (even when false), duration + embed_url", () => {
    const doc = toApiContent(
      ctx,
      baseContent({
        contentType: "video",
        sponsored: false,
        duration: "16",
        embedUrl: "https://www.tiktok.com/embed/v2/123",
      }),
    );
    expect(doc.sponsored).toEqual({ is_sponsored: false, tags: null });
    expect(doc.duration).toBe(16);
    expect(doc.embed_url).toBe("https://www.tiktok.com/embed/v2/123");
  });

  it("YouTube: metadata block with type normalizations", () => {
    const doc = toApiContent(
      ctx,
      baseContent({
        contentType: "video",
        categoryId: "22",
        defaultLanguage: "es",
        defaultAudioLanguage: "es-ES",
        definition: "hd",
        dimension: "2d",
        hasCaptions: "false",
        licensedContent: true,
        license: "youtube",
        embeddable: true,
        publicStatsViewable: false,
        madeForKids: false,
        liveBroadcastContent: "none",
        uploadStatus: "processed",
        topicCategories: ["https://en.wikipedia.org/wiki/Sport"],
        recordingDate: "2026-07-01T10:00:00Z",
        recordingLocation: { latitude: 25.77, longitude: -80.19 },
        liveStreamingDetails: {
          actualStartTime: "2026-07-01T10:00:00Z",
          actualEndTime: null,
          scheduledStartTime: "2026-07-01T09:55:00Z",
          concurrentViewers: "123",
        },
      }),
    );
    expect(doc.category_id).toBe("22");
    expect(doc.default_language).toBe("es");
    expect(doc.default_audio_language).toBe("es-ES");
    expect(doc.definition).toBe("hd");
    expect(doc.dimension).toBe("2d");
    expect(doc.has_captions).toBe(false);
    expect(doc.licensed_content).toBe(true);
    expect(doc.license).toBe("youtube");
    expect(doc.embeddable).toBe(true);
    expect(doc.public_stats_viewable).toBe(false);
    expect(doc.made_for_kids).toBe(false);
    expect(doc.live_broadcast_content).toBe("none");
    expect(doc.upload_status).toBe("processed");
    expect(doc.topic_categories).toEqual([
      "https://en.wikipedia.org/wiki/Sport",
    ]);
    expect(doc.recording_date).toBe("2026-07-01T10:00:00Z");
    expect(doc.recording_location).toEqual({
      latitude: 25.77,
      longitude: -80.19,
      altitude: null,
    });
    expect(doc.live_streaming_details).toEqual({
      actual_start_time: "2026-07-01T10:00:00Z",
      actual_end_time: null,
      scheduled_start_time: "2026-07-01T09:55:00Z",
      scheduled_end_time: null,
      concurrent_viewers: 123,
    });
  });

  it("LinkedIn: article link attachment + lifecycle + video duration", () => {
    const doc = toApiContent(
      ctx,
      baseContent({
        contentType: "video",
        linkAttachmentUrl: "https://example.com/article",
        linkAttachmentTitle: "Quarterly results",
        uploadStatus: "PUBLISHED",
        duration: "13",
      }),
    );
    expect(doc.link_attachment_url).toBe("https://example.com/article");
    expect(doc.link_attachment_title).toBe("Quarterly results");
    expect(doc.upload_status).toBe("PUBLISHED");
    expect(doc.duration).toBe(13);
  });

  it("Twitch: real VOD kind, clip featured flag + source VOD + category", () => {
    const doc = toApiContent(
      ctx,
      baseContent({
        contentType: "clip",
        mediaProductType: "CLIP",
        isFeatured: true,
        sourceVideoId: "2280123456",
        categoryId: "33214",
        defaultLanguage: "en",
        liveBroadcastContent: "none",
      }),
    );
    expect(doc.media_product_type).toBe("CLIP");
    expect(doc.is_featured).toBe(true);
    expect(doc.source_video_id).toBe("2280123456");
    expect(doc.category_id).toBe("33214");
    expect(doc.default_language).toBe("en");
    expect(doc.live_broadcast_content).toBe("none");
  });

  it("Facebook: declared mentions union caption-derived, place → location, reactions breakdown, share_count", () => {
    const doc = toApiContent(
      ctx,
      baseContent({
        caption: "great match with @acme",
        mentions: ["Acme Co", "acme"],
        mediaProductType: "ADDED_PHOTOS",
        location: {
          id: "111222333",
          name: "Miami, Florida",
          city: "Miami",
          country: "US",
          latitude: 25.7752,
          longitude: -80.192,
        },
        metrics: {
          likes: 12,
          shares: 4,
          extra: {
            reaction_like: 8,
            reaction_love: 3,
            reaction_wow: 1,
            click_other_clicks: 5,
          },
        },
      }),
    );
    // Declared first, caption-derived deduped ("acme" already declared).
    expect(doc.mentions).toEqual(["Acme Co", "acme"]);
    expect(doc.media_product_type).toBe("ADDED_PHOTOS");
    expect(doc.location).toEqual({
      id: "111222333",
      name: "Miami, Florida",
      city: "Miami",
      country: "US",
      latitude: 25.7752,
      longitude: -80.192,
      address: null,
      postal_code: null,
    });
    expect(doc.engagement.share_count).toBe(4);
    expect(doc.engagement.additional_info?.reactions_breakdown).toEqual({
      like: 8,
      love: 3,
      wow: 1,
    });
  });
});
