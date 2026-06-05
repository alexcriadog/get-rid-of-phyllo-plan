// LinkedIn profile fetcher — branches on account kind.
//
// Member (3 calls): /v2/me + /v2/connections/{personUrn} +
//   /rest/memberFollowersCount?q=me. Connections + followers are
//   best-effort: a missing scope must not fail identity.
// Organization (2 calls): /rest/organizations/{id} +
//   /rest/networkSizes/{orgUrn}. Follower count best-effort.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ProfileData } from '../../shared/platform-types';
import type {
  BoundLinkedInClient,
  LinkedInCallContext,
} from '../../shared/linkedin-api/linkedin-client';
import { extractAccountId } from '../../shared/meta-graph';
import { rethrowCritical } from '../../shared/fetch-guards';
import {
  buildLinkedInContext,
  linkedInKind,
  organizationUrn,
} from '../linkedin.context';
import {
  linkedInMemberToProfile,
  linkedInOrganizationToProfile,
} from '../mapper/linkedin-profile.mapper';
import { LINKEDIN_API_CLIENT } from '../linkedin.tokens';

@Injectable()
export class LinkedInProfileFetcher {
  private readonly logger = new Logger(LinkedInProfileFetcher.name);

  constructor(
    @Inject(LINKEDIN_API_CLIENT)
    private readonly client: BoundLinkedInClient,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ProfileData> {
    const accountId = extractAccountId(metadata);
    const ctx = buildLinkedInContext(accessToken, canonicalId);
    const callCtx: LinkedInCallContext = {
      accessToken,
      context: ctx,
      accountId,
    };

    if (linkedInKind(metadata) === 'organization') {
      return this.fetchOrganization(callCtx, canonicalId, metadata);
    }
    return this.fetchMember(callCtx, canonicalId);
  }

  private async fetchMember(
    callCtx: LinkedInCallContext,
    canonicalId: string,
  ): Promise<ProfileData> {
    const me = await this.client.getMe(callCtx);

    const connectionsSize = await this.client
      .getConnectionsSize({ ...callCtx, personId: me.id ?? canonicalId })
      .then((r) =>
        typeof r.firstDegreeSize === 'number' ? r.firstDegreeSize : null,
      )
      .catch((err) => {
        rethrowCritical(err);
        this.logger.warn(
          `getConnectionsSize failed for ${canonicalId}: ${msg(err)} — proceeding without connections`,
        );
        return null;
      });

    const followersCount = await this.client
      .getMemberFollowersCount(callCtx)
      .then((r) => {
        const v = r.elements?.[0]?.memberFollowersCount;
        return typeof v === 'number' ? v : null;
      })
      .catch((err) => {
        rethrowCritical(err);
        this.logger.warn(
          `getMemberFollowersCount failed for ${canonicalId}: ${msg(err)} — proceeding without followers`,
        );
        return null;
      });

    return linkedInMemberToProfile({ me, followersCount, connectionsSize });
  }

  private async fetchOrganization(
    callCtx: LinkedInCallContext,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ProfileData> {
    const org = await this.client.getOrganization({
      ...callCtx,
      orgId: canonicalId,
    });
    const orgUrn = organizationUrn(canonicalId, metadata);
    const followerCount = await this.client
      .getOrganizationFollowerCount({ ...callCtx, orgUrn })
      .then((r) =>
        typeof r.firstDegreeSize === 'number' ? r.firstDegreeSize : null,
      )
      .catch((err) => {
        rethrowCritical(err);
        this.logger.warn(
          `getOrganizationFollowerCount failed for ${orgUrn}: ${msg(err)} — proceeding without followers`,
        );
        return null;
      });
    return linkedInOrganizationToProfile({ org, followerCount });
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
