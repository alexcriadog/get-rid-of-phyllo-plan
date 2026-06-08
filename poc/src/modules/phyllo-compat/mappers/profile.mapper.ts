import type { ProfileData } from "@modules/platforms/shared/platform-types";
import type { PhylloContext } from "../context";
import type { PhylloProfile, PhylloReputation } from "../phyllo-types";
import { phylloProfileId } from "../ids";
import { buildEnvelope } from "./envelope.mapper";

// Core fields we map to first-class Phyllo profile fields; everything else on
// ProfileData is platform-specific extra (kept off the Phyllo shape, served
// only via additive keys if ever needed).
const REPUTATION_DEFAULT: PhylloReputation = {
  follower_count: null,
  following_count: null,
  subscriber_count: null,
  paid_subscriber_count: null,
  content_count: null,
  content_group_count: null,
  watch_time_in_hours: null,
  average_open_rate: null,
  average_click_rate: null,
  like_count: null,
  connection_count: null,
};

/** ProfileData → Phyllo profile document (§4.1). */
export function toPhylloProfile(
  ctx: PhylloContext,
  profile: ProfileData,
): PhylloProfile {
  const id = phylloProfileId(ctx.accountPk);
  const env = buildEnvelope(ctx, id, {
    updatedAt: profile.fetchedAt ?? ctx.updatedAt,
  });
  const external = ctx.canonicalUserId;
  const isBusiness =
    profile.accountType != null
      ? /business|creator|company|organization/i.test(profile.accountType)
      : null;

  return {
    ...env,
    username: profile.username,
    platform_username: profile.username ?? ctx.platformUsername,
    full_name: profile.displayName,
    first_name: null,
    last_name: null,
    nick_name: null,
    url: profile.profileUrl,
    introduction: profile.biography,
    image_url: profile.avatarUrl,
    date_of_birth: null,
    external_id: external,
    platform_account_type: profile.accountType ?? null,
    category: profile.category ?? null,
    website: profile.website ?? null,
    reputation: {
      ...REPUTATION_DEFAULT,
      follower_count: profile.followersCount,
      following_count: profile.followingCount,
      subscriber_count: profile.subscriberCount ?? null,
      content_count: profile.postsCount,
      connection_count: profile.connectionsCount ?? null,
    },
    emails: [],
    phone_numbers: [],
    addresses: [],
    gender: null,
    country: profile.country ?? null,
    platform_profile_name: profile.displayName ?? profile.username,
    platform_profile_id: external,
    platform_profile_published_at: profile.publishedAt ?? null,
    is_verified: profile.verified,
    is_business: isBusiness,
    work_experiences: null,
    education: null,
    publications: null,
    certifications: null,
    volunteer_experiences: null,
    honors: null,
    projects: null,
  };
}
