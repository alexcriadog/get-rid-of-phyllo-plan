// LinkedInClient — single chokepoint for both LinkedIn API surfaces:
//   - legacy /v2 (identity, connections): NO LinkedIn-Version header
//   - versioned /rest (posts, analytics, orgs): LinkedIn-Version +
//     X-Restli-Protocol-Version 2.0.0 mandatory
//
// Restli structured query params (dateRange, List, timeIntervals) must keep
// parens/commas raw, so every method builds its query string by hand with
// linkedin-restli helpers and passes a fully-formed path; axios `params` is
// never used here.
//
// Mirrors twitch-client.ts: bind(strategy) → BoundLinkedInClient; each call
// acquires the rate bucket, archives the raw response, observes metrics and
// maps errors to typed adapter exceptions.

import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError, type AxiosInstance } from 'axios';
import { MongoService } from '@shared/database/mongo.service';
import { RateBucketService } from '@shared/redis/rate-bucket.service';
import { MetricsService } from '@shared/metrics/metrics.service';
import {
  PlatformAdapterContext,
  RateLimitedError,
} from '../platform-adapter.port';
import type { RateLimitStrategy } from '../meta-graph/rate-limit-strategy.port';
import { persistRaw } from '../meta-graph/graph-raw-archive';
import { mapLinkedInError } from './linkedin-errors';
import {
  encodeUrn,
  restliDateRange,
  restliList,
  restliTimeIntervals,
} from './linkedin-restli';
import type {
  LinkedInCollection,
  LinkedInConnectionsSize,
  LinkedInFollowerGainsElement,
  LinkedInMe,
  LinkedInMemberAnalyticsElement,
  LinkedInMemberFollowersElement,
  LinkedInNetworkSize,
  LinkedInOrganization,
  LinkedInOrganizationAcl,
  LinkedInPost,
  LinkedInShareStatsElement,
} from './linkedin-types';

const PLATFORM_NAME = 'linkedin';
const API_BASE = 'https://api.linkedin.com';
export const LINKEDIN_API_VERSION = '202605';
const REQUEST_TIMEOUT_MS = 15_000;

// LinkedIn quotas are flat per-call (no points system); every endpoint we
// hit costs one call against both the app and member daily buckets.
const COST_PER_CALL = 1;

export interface LinkedInCallContext {
  accessToken: string;
  context: PlatformAdapterContext;
  accountId?: bigint;
}

export interface GetMemberAnalyticsArgs extends LinkedInCallContext {
  queryType:
    | 'IMPRESSION'
    | 'MEMBERS_REACHED'
    | 'RESHARE'
    | 'REACTION'
    | 'COMMENT';
  aggregation: 'TOTAL' | 'DAILY';
  /** Optional date window; lifetime when omitted. */
  start?: Date;
  end?: Date;
}

export interface GetOrgPostsArgs extends LinkedInCallContext {
  orgUrn: string;
  start?: number;
  count?: number;
}

export interface GetShareStatsArgs extends LinkedInCallContext {
  orgUrn: string;
  /** urn:li:share:* ids — passed via shares=List(...) */
  shareUrns?: string[];
  /** urn:li:ugcPost:* ids — passed via ugcPosts=List(...) */
  ugcPostUrns?: string[];
}

@Injectable()
export class LinkedInClient {
  constructor(
    private readonly rateBucket: RateBucketService,
    private readonly mongo: MongoService,
    private readonly metrics: MetricsService,
  ) {}

  bind(strategy: RateLimitStrategy): BoundLinkedInClient {
    return new BoundLinkedInClient(
      strategy,
      this.rateBucket,
      this.mongo,
      this.metrics,
    );
  }
}

export class BoundLinkedInClient {
  private readonly logger = new Logger(`LinkedInClient[${PLATFORM_NAME}]`);
  private readonly http: AxiosInstance;

  constructor(
    private readonly strategy: RateLimitStrategy,
    private readonly rateBucket: RateBucketService,
    private readonly mongo: MongoService,
    private readonly metrics: MetricsService,
  ) {
    this.http = axios.create({
      baseURL: API_BASE,
      timeout: REQUEST_TIMEOUT_MS,
      // Same OrbStack HTTPS_PROXY hardening as the Twitch client — see
      // twitch-client.ts for the full story.
      proxy: false,
    });
  }

  // ─── /v2 surface (unversioned) ──────────────────────────────────────────

  async getMe(args: LinkedInCallContext): Promise<LinkedInMe> {
    const projection =
      '(id,localizedFirstName,localizedLastName,localizedHeadline,vanityName,' +
      'profilePicture(displayImage~:playableStreams))';
    return this.get(`/v2/me?projection=${projection}`, args, false);
  }

  async getConnectionsSize(
    args: LinkedInCallContext & { personId: string },
  ): Promise<LinkedInConnectionsSize> {
    // The URN in the path MUST be percent-encoded. The doc example shows raw
    // colons but the live API rejects them with 400 ILLEGAL_ARGUMENT
    // "Syntax exception in path variables" (verified in prod 2026-06-05).
    return this.get(
      `/v2/connections/${encodeUrn(`urn:li:person:${args.personId}`)}`,
      args,
      false,
    );
  }

  // ─── /rest surface (versioned) ──────────────────────────────────────────

  async getMemberFollowersCount(
    args: LinkedInCallContext,
  ): Promise<LinkedInCollection<LinkedInMemberFollowersElement>> {
    return this.get('/rest/memberFollowersCount?q=me', args, true, 'FINDER');
  }

  async getMemberFollowersDaily(
    args: LinkedInCallContext & { start: Date; end: Date },
  ): Promise<LinkedInCollection<LinkedInMemberFollowersElement>> {
    const range = restliDateRange(args.start, args.end);
    return this.get(
      `/rest/memberFollowersCount?q=dateRange&dateRange=${range}`,
      args,
      true,
      'FINDER',
    );
  }

  async getMemberPostAnalytics(
    args: GetMemberAnalyticsArgs,
  ): Promise<LinkedInCollection<LinkedInMemberAnalyticsElement>> {
    let path =
      `/rest/memberCreatorPostAnalytics?q=me` +
      `&queryType=${args.queryType}&aggregation=${args.aggregation}`;
    if (args.start && args.end) {
      path += `&dateRange=${restliDateRange(args.start, args.end)}`;
    }
    return this.get(path, args, true, 'FINDER');
  }

  async getOrganizationAcls(
    args: LinkedInCallContext,
  ): Promise<LinkedInCollection<LinkedInOrganizationAcl>> {
    return this.get(
      '/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=50',
      args,
      true,
      'FINDER',
    );
  }

  async getOrganization(
    args: LinkedInCallContext & { orgId: string },
  ): Promise<LinkedInOrganization> {
    return this.get(`/rest/organizations/${args.orgId}`, args, true);
  }

  async getOrganizationFollowerCount(
    args: LinkedInCallContext & { orgUrn: string },
  ): Promise<LinkedInNetworkSize> {
    return this.get(
      `/rest/networkSizes/${encodeUrn(args.orgUrn)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`,
      args,
      true,
    );
  }

  async getOrganizationFollowerGains(
    args: LinkedInCallContext & {
      orgUrn: string;
      startMs: number;
      endMs: number;
    },
  ): Promise<LinkedInCollection<LinkedInFollowerGainsElement>> {
    const intervals = restliTimeIntervals(args.startMs, args.endMs);
    return this.get(
      `/rest/organizationalEntityFollowerStatistics?q=organizationalEntity` +
        `&organizationalEntity=${encodeUrn(args.orgUrn)}&timeIntervals=${intervals}`,
      args,
      true,
      'FINDER',
    );
  }

  async getOrganizationPosts(
    args: GetOrgPostsArgs,
  ): Promise<LinkedInCollection<LinkedInPost>> {
    const start = args.start ?? 0;
    const count = args.count ?? 50;
    // sortBy=CREATED (newest first) so a `since`-filtered differential sync
    // can break at the first too-old post instead of paging through edits.
    return this.get(
      `/rest/posts?author=${encodeUrn(args.orgUrn)}&q=author` +
        `&count=${count}&start=${start}&sortBy=CREATED`,
      args,
      true,
      'FINDER',
    );
  }

  async getShareStatistics(
    args: GetShareStatsArgs,
  ): Promise<LinkedInCollection<LinkedInShareStatsElement>> {
    let path =
      `/rest/organizationalEntityShareStatistics?q=organizationalEntity` +
      `&organizationalEntity=${encodeUrn(args.orgUrn)}`;
    if (args.shareUrns?.length) path += `&shares=${restliList(args.shareUrns)}`;
    if (args.ugcPostUrns?.length)
      path += `&ugcPosts=${restliList(args.ugcPostUrns)}`;
    return this.get(path, args, true, 'FINDER');
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private async get<T>(
    pathWithQuery: string,
    args: LinkedInCallContext,
    versioned: boolean,
    restliMethod?: 'FINDER',
  ): Promise<T> {
    const endpoint = pathWithQuery.split('?')[0];
    const acquired = await this.acquire(args.context, COST_PER_CALL);
    const started = Date.now();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${args.accessToken}`,
      'X-Restli-Protocol-Version': '2.0.0',
    };
    if (versioned) headers['LinkedIn-Version'] = LINKEDIN_API_VERSION;
    if (restliMethod) headers['X-RestLi-Method'] = restliMethod;
    try {
      const res = await this.http.get<T>(pathWithQuery, { headers });
      await this.observeAndPersist(
        endpoint,
        args.accountId,
        acquired.bucketKey,
        acquired.tokensRemaining,
        res.status,
        Date.now() - started,
        res.data,
      );
      return res.data;
    } catch (err: unknown) {
      const ax = err as AxiosError;
      const status = ax.response?.status ?? 0;
      await this.observeAndPersist(
        endpoint,
        args.accountId,
        acquired.bucketKey,
        acquired.tokensRemaining,
        status,
        Date.now() - started,
        ax.response?.data ?? { error: messageOf(err) },
      );
      throw mapLinkedInError(PLATFORM_NAME, endpoint, err, acquired.bucketKey);
    }
  }

  private async acquire(
    context: PlatformAdapterContext,
    cost: number,
  ): Promise<{ bucketKey: string; tokensRemaining: number }> {
    const hints = this.strategy.hints(context).map((h) => ({
      ...h,
      costPerCall: cost,
    }));
    const acquireCtx: Record<string, string> = {};
    if (context.tokenHash) acquireCtx['hash'] = context.tokenHash;
    if (context.channelId) acquireCtx['channel_id'] = context.channelId;
    const acquired = await this.rateBucket.acquire(hints, acquireCtx);
    if (!acquired.allowed) {
      this.metrics.incr('acquire_total', {
        scope: acquired.bucketKey,
        result: 'denied',
      });
      throw new RateLimitedError(
        PLATFORM_NAME,
        acquired.resetInMs,
        acquired.bucketKey,
      );
    }
    this.metrics.incr('acquire_total', {
      scope: acquired.bucketKey,
      result: 'allowed',
    });
    return {
      bucketKey: acquired.bucketKey,
      tokensRemaining: acquired.tokensRemaining,
    };
  }

  private async observeAndPersist(
    endpoint: string,
    accountId: bigint | undefined,
    bucketKey: string,
    bucketBefore: number,
    status: number,
    durationMs: number,
    body: unknown,
  ): Promise<void> {
    const bucketAfterState = await this.rateBucket.getState(bucketKey);
    const bucketAfter = bucketAfterState?.tokens ?? null;
    this.metrics.observeApiCall({
      platform: PLATFORM_NAME,
      endpoint,
      method: 'GET',
      status,
      durationMs,
      bucketBefore,
      bucketAfter,
      usageHeader: null,
      accountId: accountId ?? null,
      rateBucketKey: bucketKey,
    });
    await persistRaw(
      this.mongo,
      PLATFORM_NAME,
      body,
      endpoint,
      accountId ?? null,
      status,
    );
  }
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : JSON.stringify(err);
}
