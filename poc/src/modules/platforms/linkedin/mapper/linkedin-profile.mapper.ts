// /v2/me (+ memberFollowersCount + connections) → canonical ProfileData,
// and /rest/organizations/{id} (+ networkSizes) → canonical ProfileData.
//
// Mapping decisions:
//  - member `username` is vanityName (the /in/{slug} URL handle).
//  - `connectionsCount` (1st-degree, bidirectional) is platform-specific and
//    distinct from followersCount — both surfaced.
//  - org `username` is the company vanityName (/company/{slug}).
//  - accountType distinguishes 'member' vs 'organization' rows downstream.

import type { ProfileData } from '../../shared/platform-types';
import type {
  LinkedInMe,
  LinkedInOrganization,
} from '../../shared/linkedin-api/linkedin-types';

export interface LinkedInMemberProfileSource {
  me: LinkedInMe;
  followersCount: number | null;
  connectionsSize: number | null;
}

export interface LinkedInOrgProfileSource {
  org: LinkedInOrganization;
  followerCount: number | null;
}

function pictureUrl(me: LinkedInMe): string | null {
  const elements = me.profilePicture?.['displayImage~']?.elements;
  if (!elements?.length) return null;
  // Last element is typically the largest rendition; any works for an avatar.
  const last = elements[elements.length - 1];
  return last?.identifiers?.[0]?.identifier ?? null;
}

export function linkedInMemberToProfile(
  src: LinkedInMemberProfileSource,
): ProfileData {
  const { me, followersCount, connectionsSize } = src;
  const name = [me.localizedFirstName, me.localizedLastName]
    .filter(Boolean)
    .join(' ');
  return {
    username: me.vanityName ?? null,
    displayName: name.length > 0 ? name : null,
    biography: me.localizedHeadline ?? null,
    avatarUrl: pictureUrl(me),
    profileUrl: me.vanityName
      ? `https://www.linkedin.com/in/${me.vanityName}`
      : null,
    followersCount,
    followingCount: null,
    postsCount: null,
    verified: null,
    accountType: 'member',
    connectionsCount: connectionsSize,
    fetchedAt: new Date(),
  };
}

export function linkedInOrganizationToProfile(
  src: LinkedInOrgProfileSource,
): ProfileData {
  const { org, followerCount } = src;
  return {
    username: org.vanityName ?? null,
    displayName: org.localizedName ?? null,
    biography: org.localizedDescription ?? null,
    avatarUrl: null, // logoV2 needs digitalmediaAsset decoration — follow-up
    profileUrl: org.vanityName
      ? `https://www.linkedin.com/company/${org.vanityName}`
      : null,
    followersCount: followerCount,
    followingCount: null,
    postsCount: null,
    verified: null,
    accountType: 'organization',
    website: org.localizedWebsite ?? null,
    fetchedAt: new Date(),
  };
}
