import type {
  ContentData,
  ContentInsights,
  ContentLocation,
  ContentPoll,
  DistributionBucket,
  EngagementDeepItem,
  ReferencedContent,
  RetentionCurve,
  SecondPercentage,
} from "@modules/platforms/shared/platform-types";
import type { SchemaContext } from "../context";
import type {
  ApiContent,
  ApiContentAudience,
  ApiContentInsights,
  ApiContentLocation,
  ApiContentPoll,
  ApiEngagement,
  ApiEngagementAdditionalInfo,
  ApiGenderAgeBucket,
  ApiReferencedContent,
} from "../api-types";
import { apiContentId } from "../ids";
import { buildEnvelope } from "./envelope.mapper";
import { naiveUtc, round2 } from "../serializers";
import {
  contentTypeToFormatType,
  durationToSeconds,
  visibilityOf,
} from "../format";
import {
  countriesToApi,
  citiesToApi,
  gendersToApi,
  agesToApi,
  genderAgeToApi,
} from "./audience.mapper";
import { toPercentPairs } from "../buckets";

/** Optional deep-analytics join (§4.6) — YouTube's per-video snapshot item. */
export interface DeepJoin {
  item?: EngagementDeepItem;
  retention?: RetentionCurve | null;
}

const ENGAGEMENT_DEFAULT: ApiEngagement = {
  like_count: null,
  dislike_count: null,
  comment_count: null,
  impression_organic_count: null,
  reach_organic_count: null,
  save_count: null,
  view_count: null,
  replay_count: null,
  watch_time_in_hours: null,
  avg_watch_time_in_sec: null,
  share_count: null,
  impression_paid_count: null,
  reach_paid_count: null,
  email_open_rate: null,
  email_click_rate: null,
  unsubscribe_count: null,
  spam_report_count: null,
  click_count: null,
  additional_info: null,
  repost_count: null,
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function buildAdditionalInfo(
  extra: Record<string, number> | undefined,
): ApiEngagementAdditionalInfo | null {
  if (!extra) return null;
  const has = (k: string): number | null => num(extra[k]);
  const nav = {
    swipe_ups: has("swipe_ups"),
    tap_backs: has("tap_backs"),
    tap_exits: has("tap_exits"),
    swipe_backs: has("swipe_backs"),
    swipe_downs: has("swipe_downs"),
    tap_forwards: has("tap_forwards"),
    swipe_forwards: has("swipe_forwards"),
    automatic_forwards: has("automatic_forwards"),
  };
  const navHasAny = Object.values(nav).some((v) => v !== null);
  // Per-platform aliases for the same concept: IG `profile_visits`/`follows`,
  // TikTok `profile_views`/`new_followers`/`website_clicks` (a click on the
  // profile's website link = bio link click).
  const profileVisits = has("profile_visits") ?? has("profile_views");
  const bioLink = has("bio_link_clicked") ?? has("website_clicks");
  const followersGained =
    has("followers_gained") ?? has("follows") ?? has("new_followers");
  const totalInteractions = has("total_interactions");
  const reelsSkipRate = has("reels_skip_rate");
  const completionRate = has("completion_rate");
  const storyReplies = has("story_replies");
  const stickerInteractions = has("sticker_interactions");
  const uniqueMediaViews = has("unique_media_views");
  // Facebook per-reaction counts land in extra as `reaction_<type>` (like,
  // love, wow, haha, sad, angry, care) — regroup them into one object.
  const reactionsBreakdown: Record<string, number> = {};
  for (const [k, v] of Object.entries(extra)) {
    if (k.startsWith("reaction_") && typeof v === "number") {
      reactionsBreakdown[k.slice("reaction_".length)] = v;
    }
  }
  const hasReactions = Object.keys(reactionsBreakdown).length > 0;
  if (
    !navHasAny &&
    !hasReactions &&
    profileVisits === null &&
    bioLink === null &&
    followersGained === null &&
    totalInteractions === null &&
    reelsSkipRate === null &&
    completionRate === null &&
    storyReplies === null &&
    stickerInteractions === null &&
    uniqueMediaViews === null
  ) {
    return null;
  }
  return {
    profile_visits: profileVisits,
    bio_link_clicked: bioLink,
    followers_gained: followersGained,
    story_navigation: navHasAny ? nav : null,
    total_interactions: totalInteractions,
    reels_skip_rate: reelsSkipRate,
    completion_rate: completionRate,
    story_replies: storyReplies,
    sticker_interactions: stickerInteractions,
    unique_media_views: uniqueMediaViews,
    ...(hasReactions ? { reactions_breakdown: reactionsBreakdown } : {}),
  };
}

function buildEngagement(content: ContentData): ApiEngagement {
  const m = content.metrics ?? {};
  const extra = m.extra ?? {};
  // IG reels watch-time metrics arrive in MILLISECONDS (Meta wire format,
  // see instagram-insights.mapper.ts); the InsightIQ contract wants seconds
  // (avg) and hours (total). TikTok's *_time_watched_s keys are already
  // seconds — only the total needs the s→h conversion.
  const reelsAvgWatchMs = num(extra["ig_reels_avg_watch_time"]);
  const reelsTotalWatchMs = num(extra["ig_reels_video_view_total_time"]);
  const totalWatchS = num(extra["total_time_watched_s"]);
  return {
    ...ENGAGEMENT_DEFAULT,
    like_count: num(m.likes),
    comment_count: num(m.comments),
    share_count: num(m.shares),
    save_count: num(m.saves),
    view_count: num(m.views),
    reach_organic_count: num(m.reach),
    avg_watch_time_in_sec:
      num(extra["average_time_watched_s"]) ??
      num(extra["avg_watch_time_in_sec"]) ??
      (reelsAvgWatchMs !== null ? reelsAvgWatchMs / 1000 : null),
    watch_time_in_hours:
      totalWatchS !== null
        ? totalWatchS / 3600
        : reelsTotalWatchMs !== null
          ? reelsTotalWatchMs / 3_600_000
          : null,
    // LinkedIn surfaces per-post click counts; Threads surfaces reposts.
    click_count: num(extra["clicks"]),
    repost_count: num(extra["reposts"]),
    additional_info: buildAdditionalInfo(extra),
  };
}

/** Per-post viewer demographics (§4.5) from in-band insights + deep join. */
function buildContentAudience(
  insights: ContentInsights | undefined,
  deep: DeepJoin | undefined,
): ApiContentAudience | null {
  const countries: DistributionBucket[] = insights?.audienceCountries ?? [];
  const cities: DistributionBucket[] = insights?.audienceCities ?? [];
  const genders: DistributionBucket[] = insights?.audienceGenders ?? [];
  const types = insights?.audienceTypes ?? [];

  // YouTube deep join: per-video countries (count→%) + demographics (joint).
  const deepCountries: DistributionBucket[] = (deep?.item?.countries ?? []).map(
    (c) => ({
      label: c.country,
      value: c.views,
      unit: "count" as const,
    }),
  );
  const deepGenderAge: ApiGenderAgeBucket[] = (
    deep?.item?.demographics ?? []
  ).map((d) => ({
    gender: d.gender.toUpperCase(),
    age_range: d.ageGroup.replace(/^age/i, ""),
    value: round2(d.viewerPercentage),
  }));

  const allCountries = [...countries, ...deepCountries];
  const genderAge = [...genderAgeToApi(genders, undefined), ...deepGenderAge];

  const out: ApiContentAudience = {
    countries: countriesToApi(allCountries),
    cities: citiesToApi(cities),
    gender_age_distribution: genderAge,
    audience_types: toPercentPairs(types),
    gender_distribution: gendersToApi(genders),
    age_distribution: [],
  };
  const empty =
    out.countries.length === 0 &&
    out.cities.length === 0 &&
    out.gender_age_distribution.length === 0 &&
    out.audience_types.length === 0 &&
    out.gender_distribution.length === 0;
  return empty ? null : out;
}

function secondCurve(
  points: SecondPercentage[] | undefined,
): Array<{ second: number; value: number }> {
  return (points ?? []).map((p) => ({
    second: p.second,
    value: round2(p.percentage * (p.percentage <= 1 ? 100 : 1)),
  }));
}

/** Deep per-post analytics (§4.6) — additive `insights` object. */
function buildInsights(
  insights: ContentInsights | undefined,
  deep: DeepJoin | undefined,
): ApiContentInsights | null {
  const tikTokTraffic = toPercentPairs(insights?.trafficSources).map((b) => ({
    source: b.label,
    views: null,
    minutes: null,
    value: b.value,
  }));
  const ytTraffic = (deep?.item?.trafficSources ?? []).map((t) => ({
    source: t.source,
    views: t.views,
    minutes: t.minutes,
    value: null,
  }));
  const devices = (deep?.item?.devices ?? []).map((d) => ({
    device_type: d.deviceType,
    views: d.views,
    minutes: d.minutes,
  }));
  const audienceRetention = (deep?.retention?.points ?? []).map((p) => ({
    elapsed_ratio: p.elapsedRatio,
    watch_ratio: p.audienceWatchRatio,
    relative_performance: p.relativeRetentionPerformance ?? null,
  }));
  const sharing = (deep?.item?.sharing ?? []).map((s) => ({
    service: s.service,
    shares: s.shares,
  }));
  const viewerDemographics: ApiGenderAgeBucket[] = (
    deep?.item?.demographics ?? []
  ).map((d) => ({
    gender: d.gender.toUpperCase(),
    age_range: d.ageGroup.replace(/^age/i, ""),
    value: round2(d.viewerPercentage),
  }));
  const viewerTypes = toPercentPairs(insights?.audienceTypes);
  const retentionCurve = secondCurve(insights?.retentionCurve);
  const likesTimeline = secondCurve(insights?.likesTimeline);
  const extra: Record<string, unknown> = {};
  if (deep?.item?.metrics) extra.metrics = deep.item.metrics;
  if (deep?.item?.countries) extra.countries = deep.item.countries;

  const trafficSources = [...tikTokTraffic, ...ytTraffic];
  const anything =
    trafficSources.length ||
    devices.length ||
    audienceRetention.length ||
    sharing.length ||
    viewerDemographics.length ||
    viewerTypes.length ||
    retentionCurve.length ||
    likesTimeline.length ||
    Object.keys(extra).length;
  if (!anything) return null;
  return {
    traffic_sources: trafficSources,
    devices,
    audience_retention: audienceRetention,
    viewer_demographics: viewerDemographics,
    sharing,
    viewer_types: viewerTypes,
    retention_curve: retentionCurve,
    likes_timeline: likesTimeline,
    extra,
  };
}

/**
 * Compute just the additive `audience` (§4.5) + `insights` (§4.6) parts from a
 * deep-analytics join, with no in-band content. Used by the engagement_deep
 * fold step to patch existing contents docs (YouTube). Returns nulls
 * when the deep item carries nothing.
 */
export function deepToContentParts(deep: DeepJoin): {
  audience: ApiContentAudience | null;
  insights: ApiContentInsights | null;
} {
  return {
    audience: buildContentAudience(undefined, deep),
    insights: buildInsights(undefined, deep),
  };
}

/** ContentData → InsightIQ content document (§4.2 + §4.5 + §4.6). */
export function toApiContent(
  ctx: SchemaContext,
  content: ContentData,
  deep?: DeepJoin,
): ApiContent {
  const external = content.platformContentId;
  const id = apiContentId(ctx.accountPk, external);
  const env = buildEnvelope(ctx, id, {
    updatedAt: content.fetchedAt ?? ctx.updatedAt,
  });
  const isVideo =
    content.contentType === "video" ||
    content.contentType === "reel" ||
    content.mediaProductType === "REELS";
  const { format, type } = contentTypeToFormatType(content.contentType, {
    isVideo,
  });
  const mediaUrls = Array.isArray(content.mediaUrls)
    ? content.mediaUrls.filter(Boolean)
    : [];

  const collaborators =
    content.collaborators && content.collaborators.length > 0
      ? content.collaborators
      : null;

  return {
    ...env,
    engagement: buildEngagement(content),
    // IG collab posts: co-author usernames. Backend renders coauthors from
    // this list, so it stays a plain string[] (Phyllo leaves it null).
    authors: collaborators,
    audience: buildContentAudience(content.insights, deep),
    platform: null,
    external_id: external,
    title: deriveTitle(content),
    format,
    type,
    url: content.permalink,
    // Phyllo parity: when the platform exposes no downloadable media URL (TikTok
    // BC v1.3, YouTube, Twitch) it still surfaces the official embeddable player
    // URL here. Consumers derive a media count from `media_url` (media_url ? 1 : 0)
    // and gate rendering on it, so leaving this null made those posts look
    // media-less. The binary is still fetched out-of-band (TikAPI / yt-dlp) via
    // `external_id`, independent of this field.
    media_url: mediaUrls[0] ?? content.embedUrl ?? null,
    duration: durationToSeconds(content.duration),
    description: content.caption,
    visibility: visibilityOf(content.privacyStatus, undefined),
    thumbnail_url: content.thumbnailUrl ?? null,
    persistent_thumbnail_url: null,
    published_at: naiveUtc(content.publishedAt),
    platform_profile_id: ctx.canonicalUserId,
    platform_profile_name: ctx.platformUsername,
    // Platform-declared ad flag (TikTok is_ad). Phyllo's object shape; null
    // when the platform says nothing (never guess from caption).
    sponsored:
      content.sponsored != null
        ? { is_sponsored: content.sponsored, tags: null }
        : null,
    // IG collab posts (collaborators fetched on the FB-graph flow).
    collaboration: collaborators ? { has_collaboration: true } : null,
    is_owned_by_platform_user: true,
    hashtags:
      content.tags && content.tags.length > 0
        ? content.tags
        : extractTags(content.caption, "#"),
    content_tags: null,
    // Platform-declared tags (FB message_tags) unioned with caption-derived
    // @mentions — declared ones first, caption duplicates dropped.
    mentions: mergeMentions(
      content.mentions,
      extractTags(content.caption, "@"),
    ),
    media_urls: mediaUrls.length > 1 ? mediaUrls : [],
    insights: buildInsights(content.insights, deep),
    quoted_post: referencedToApi(content.quotedPost),
    reposted_post: referencedToApi(content.repostedPost),
    // Additive Threads extras — only present when the platform exposed them,
    // so docs of other platforms (and older Threads docs) keep their exact
    // shape. Consumers that don't know these keys simply ignore them.
    ...(content.topicTag != null ? { topic_tag: content.topicTag } : {}),
    ...(content.location ? { location: locationToApi(content.location) } : {}),
    ...(content.altText != null ? { alt_text: content.altText } : {}),
    ...(content.linkAttachmentUrl != null
      ? { link_attachment_url: content.linkAttachmentUrl }
      : {}),
    ...(content.gifUrl != null ? { gif_url: content.gifUrl } : {}),
    ...(content.isSpoilerMedia != null
      ? { is_spoiler_media: content.isSpoilerMedia }
      : {}),
    ...(content.poll ? { poll: pollToApi(content.poll) } : {}),
    // Max-capture additive keys (all platforms) — same only-when-present
    // contract as the Threads block above. docs/max-capture-all-platforms.md
    // is the field map.
    ...(content.linkAttachmentTitle != null
      ? { link_attachment_title: content.linkAttachmentTitle }
      : {}),
    ...(content.mediaProductType != null
      ? { media_product_type: content.mediaProductType }
      : {}),
    ...(content.embedUrl != null ? { embed_url: content.embedUrl } : {}),
    ...(content.categoryId != null ? { category_id: content.categoryId } : {}),
    ...(content.defaultLanguage != null
      ? { default_language: content.defaultLanguage }
      : {}),
    ...(content.defaultAudioLanguage != null
      ? { default_audio_language: content.defaultAudioLanguage }
      : {}),
    ...(content.uploadStatus != null
      ? { upload_status: content.uploadStatus }
      : {}),
    ...(content.isCommentEnabled != null
      ? { is_comment_enabled: content.isCommentEnabled }
      : {}),
    ...(content.isSharedToFeed != null
      ? { is_shared_to_feed: content.isSharedToFeed }
      : {}),
    ...(content.definition != null ? { definition: content.definition } : {}),
    ...(content.dimension != null ? { dimension: content.dimension } : {}),
    // YouTube returns caption availability as the string "true"/"false".
    ...(content.hasCaptions != null
      ? { has_captions: content.hasCaptions === "true" }
      : {}),
    ...(content.licensedContent != null
      ? { licensed_content: content.licensedContent }
      : {}),
    ...(content.license != null ? { license: content.license } : {}),
    ...(content.embeddable != null ? { embeddable: content.embeddable } : {}),
    ...(content.publicStatsViewable != null
      ? { public_stats_viewable: content.publicStatsViewable }
      : {}),
    ...(content.madeForKids != null
      ? { made_for_kids: content.madeForKids }
      : {}),
    ...(content.liveBroadcastContent != null
      ? { live_broadcast_content: content.liveBroadcastContent }
      : {}),
    ...(content.topicCategories && content.topicCategories.length > 0
      ? { topic_categories: content.topicCategories }
      : {}),
    ...(content.recordingDate != null
      ? { recording_date: content.recordingDate }
      : {}),
    ...(content.recordingLocation
      ? {
          recording_location: {
            latitude: content.recordingLocation.latitude ?? null,
            longitude: content.recordingLocation.longitude ?? null,
            altitude: content.recordingLocation.altitude ?? null,
          },
        }
      : {}),
    ...(content.liveStreamingDetails
      ? { live_streaming_details: liveDetailsToApi(content.liveStreamingDetails) }
      : {}),
    ...(content.isFeatured != null ? { is_featured: content.isFeatured } : {}),
    ...(content.sourceVideoId != null
      ? { source_video_id: content.sourceVideoId }
      : {}),
  };
}

/** Live window + concurrent viewers → snake_case additive shape. */
function liveDetailsToApi(
  d: NonNullable<ContentData["liveStreamingDetails"]>,
): NonNullable<ApiContent["live_streaming_details"]> {
  const viewers = d.concurrentViewers;
  return {
    actual_start_time: d.actualStartTime ?? null,
    actual_end_time: d.actualEndTime ?? null,
    scheduled_start_time: d.scheduledStartTime ?? null,
    scheduled_end_time: d.scheduledEndTime ?? null,
    concurrent_viewers:
      viewers != null && /^\d+$/.test(viewers) ? parseInt(viewers, 10) : null,
  };
}

/**
 * Union platform-declared mentions (FB message_tags) with caption-derived
 * @mentions — declared first, duplicates dropped. Null when neither exists
 * (Phyllo parity: the field is null, not []).
 */
function mergeMentions(
  declared: string[] | null | undefined,
  derived: string[] | null,
): string[] | null {
  const base = declared ?? [];
  const seen = new Set(base);
  const out = [...base];
  for (const m of derived ?? []) {
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out.length > 0 ? out : null;
}

/** Map a tagged location to the additive /v1 shape. */
function locationToApi(loc: ContentLocation): ApiContentLocation {
  return {
    id: loc.id,
    name: loc.name ?? null,
    city: loc.city ?? null,
    country: loc.country ?? null,
    latitude: loc.latitude ?? null,
    longitude: loc.longitude ?? null,
    address: loc.address ?? null,
    postal_code: loc.postalCode ?? null,
  };
}

/** Map a poll attachment to the additive /v1 shape. */
function pollToApi(poll: ContentPoll): ApiContentPoll {
  return {
    options: poll.options.map((o) => ({
      label: o.label,
      votes_percentage: o.votesPercentage,
    })),
    expires_at: poll.expiresAt ?? null,
    total_votes: poll.totalVotes ?? null,
  };
}

/** Map a referenced (quoted/reposted) post to the additive /v1 shape. */
function referencedToApi(
  ref: ReferencedContent | null | undefined,
): ApiReferencedContent | null {
  if (!ref) return null;
  const { format, type } = contentTypeToFormatType(ref.contentType, {
    isVideo: ref.contentType === "video" || ref.contentType === "reel",
  });
  return {
    external_id: ref.platformContentId,
    url: ref.permalink,
    description: ref.caption,
    media_url: ref.mediaUrls[0] ?? null,
    thumbnail_url: ref.thumbnailUrl ?? null,
    type,
    format,
    platform_profile_name: ref.ownerHandle,
    published_at: naiveUtc(ref.publishedAt ?? null),
  };
}

function deriveTitle(content: ContentData): string | null {
  // YouTube carries a real title in caption-less form via tags/category; for
  // most platforms InsightIQ puts the caption excerpt in `title`. We mirror the
  // common case: first line of the caption, capped.
  if (!content.caption) return null;
  const firstLine = content.caption.split("\n")[0].trim();
  return firstLine.length > 0 ? firstLine.slice(0, 200) : null;
}

function extractTags(
  caption: string | null,
  prefix: "#" | "@",
): string[] | null {
  if (!caption) return null;
  const re = prefix === "#" ? /#([\p{L}\p{N}_]+)/gu : /@([\p{L}\p{N}_.]+)/gu;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(caption)) !== null) out.push(m[1]);
  return out.length > 0 ? out : null;
}
