// Facebook "extras" service — CA-only data products that don't fit the
// standard PlatformAdapter port:
//
//   • syncRatings(accountId, accessToken, pageId)
//       /{page_id}/ratings (pages_read_user_content) → page_ratings
//
//   • syncAdInsights(accountId, accessToken)
//       /me/adaccounts + /{ad_acct}/insights (ads_read) → ad_insights
//
//   • snapshotPublicPage(ownerAccountId, accessToken, pageId)
//       /{any_page_id} + /{any_page_id}/posts (Page Public Content Access)
//       → public_page_snapshots
//
// Triggered on-demand from admin endpoints. Each method writes to Mongo
// directly because the sync worker is platform-agnostic and these products
// only exist for FB/CA today.

import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  MONGO_COLLECTIONS,
  MongoService,
} from '@shared/database/mongo.service';
import type { BoundGraphClient } from '../../shared/meta-graph/graph-client';
import type { GraphListResponse } from '../../shared/meta-graph';
import { parseNextUrl } from '../../shared/meta-graph';
import { buildFacebookContext } from '../facebook.context';
import { FACEBOOK_GRAPH_CLIENT } from '../facebook.tokens';
import type {
  FacebookAdAccount,
  FacebookAdInsightsRow,
  FacebookPost,
  FacebookPublicPage,
  FacebookRating,
} from '../facebook.types';
import { FacebookMentionsFetcher } from './facebook-mentions.fetcher';
import { FacebookCommentsFetcher } from './facebook-comments.fetcher';

const RATINGS_PAGE_SIZE = 25;
const PUBLIC_PAGE_POSTS_LIMIT = 12;

export interface RatingsSyncResult {
  reviewsFetched: number;
  reviewsStored: number;
}

export interface AdSyncResult {
  adAccounts: number;
  insightRows: number;
}

export interface PublicPageSnapshot {
  pageId: string;
  name: string | null;
  fanCount: number | null;
  recentPostsCount: number;
}

export interface MentionsSyncResult {
  mentionsFetched: number;
  mentionsStored: number;
}

export interface CommentsSyncResult {
  commentsFetched: number;
  commentsStored: number;
}

@Injectable()
export class FacebookExtrasService {
  private readonly logger = new Logger(FacebookExtrasService.name);

  constructor(
    @Inject(FACEBOOK_GRAPH_CLIENT)
    private readonly client: BoundGraphClient,
    private readonly mongo: MongoService,
    private readonly mentionsFetcher: FacebookMentionsFetcher,
    private readonly commentsFetcher: FacebookCommentsFetcher,
  ) {}

  // ───────────────────────────────────────────────────────────── ratings

  async syncRatings(
    accountId: bigint,
    accessToken: string,
    pageId: string,
  ): Promise<RatingsSyncResult> {
    const ctx = buildFacebookContext(accessToken, pageId, {
      accountId,
      page_id: pageId,
    });
    const ratings: FacebookRating[] = [];
    let nextEndpoint: string = `/${pageId}/ratings`;
    let nextParams: Record<string, string | number | undefined> = {
      fields:
        'created_time,rating,recommendation_type,review_text,has_review,has_rating,reviewer{id,name},open_graph_story{id,permalink_url}',
      limit: RATINGS_PAGE_SIZE,
    };

    for (let page = 0; page < 5; page++) {
      const body = await this.client.call<GraphListResponse<FacebookRating>>({
        endpoint: nextEndpoint,
        params: nextParams,
        accessToken,
        context: ctx,
        accountId,
      });
      ratings.push(...(body.data ?? []));
      const nextUrl = body.paging?.next;
      if (!nextUrl) break;
      const parsed = parseNextUrl(nextUrl);
      nextEndpoint = parsed.endpoint;
      nextParams = { ...parsed.params };
    }

    const collection = this.mongo.getCollection(MONGO_COLLECTIONS.pageRatings);
    let stored = 0;
    for (const r of ratings) {
      const reviewId =
        r.open_graph_story?.id ??
        createHash('sha256')
          .update(JSON.stringify(r))
          .digest('hex')
          .slice(0, 24);
      await collection.updateOne(
        { account_id: String(accountId), platform_review_id: reviewId },
        {
          $set: {
            account_id: String(accountId),
            platform: 'facebook',
            platform_review_id: reviewId,
            rating: r.rating ?? null,
            recommendation_type: r.recommendation_type ?? null,
            review_text: r.review_text ?? null,
            reviewer_id: r.reviewer?.id ?? null,
            reviewer_name: r.reviewer?.name ?? null,
            permalink_url: r.open_graph_story?.permalink_url ?? null,
            created_time: r.created_time ? new Date(r.created_time) : null,
            captured_at: new Date(),
          },
        },
        { upsert: true },
      );
      stored += 1;
    }
    return { reviewsFetched: ratings.length, reviewsStored: stored };
  }

  /**
   * Read the most-recent ratings the worker has captured for an account.
   * Always returns from Mongo — the live FB call only runs during a scheduled
   * sync (or on `manual-refresh`), so consumers see whatever the worker
   * stored on its last pass.
   *
   * Date fields come back as ISO 8601 strings so the JSON response is
   * idempotent across Node versions.
   */
  async listRatings(
    accountId: bigint,
    limit: number,
  ): Promise<{
    sample_size: number;
    average_rating: number | null;
    captured_at: string | null;
    data: NormalizedRatingView[];
  }> {
    const collection = this.mongo.getCollection(MONGO_COLLECTIONS.pageRatings);
    const rows = await collection
      .find({ account_id: String(accountId) })
      .sort({ created_time: -1 })
      .limit(limit)
      .toArray();

    const numeric = rows
      .map((r) => (typeof r.rating === 'number' ? r.rating : null))
      .filter((n): n is number => n !== null);
    const averageRating = numeric.length
      ? Number((numeric.reduce((a, b) => a + b, 0) / numeric.length).toFixed(2))
      : null;

    const newestCapturedAt =
      rows
        .map((r) =>
          r.captured_at instanceof Date ? r.captured_at.toISOString() : null,
        )
        .filter((s): s is string => !!s)
        .sort()
        .pop() ?? null;

    return {
      sample_size: rows.length,
      average_rating: averageRating,
      captured_at: newestCapturedAt,
      data: rows.map(toRatingView),
    };
  }

  // ───────────────────────────────────────────────────────────── ads

  async syncAdInsights(
    accountId: bigint,
    accessToken: string,
    datePreset: string = 'last_30d',
  ): Promise<AdSyncResult> {
    const ctx = buildFacebookContext(accessToken, String(accountId), {
      accountId,
    });
    const accountsBody = await this.client.call<
      GraphListResponse<FacebookAdAccount>
    >({
      endpoint: '/me/adaccounts',
      params: {
        fields:
          'id,account_id,name,account_status,currency,timezone_name,amount_spent,balance,business{id,name}',
        limit: 25,
      },
      accessToken,
      context: ctx,
      accountId,
    });

    const adAccounts = accountsBody.data ?? [];
    const collection = this.mongo.getCollection(MONGO_COLLECTIONS.adInsights);
    let totalRows = 0;

    for (const ad of adAccounts) {
      const accountSummary = await this.client
        .call<GraphListResponse<FacebookAdInsightsRow>>({
          endpoint: `/${ad.id}/insights`,
          params: {
            fields:
              'date_start,date_stop,spend,impressions,reach,frequency,clicks,ctr,cpc,cpm,cpp,unique_clicks',
            date_preset: datePreset,
          },
          accessToken,
          context: ctx,
          accountId,
        })
        .catch((err) => {
          this.logger.warn(
            `account insights failed for ${ad.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          return { data: [] } as GraphListResponse<FacebookAdInsightsRow>;
        });

      for (const row of accountSummary.data ?? []) {
        await collection.updateOne(
          {
            account_id: String(accountId),
            ad_account_id: ad.id,
            level: 'account',
            date_start: row.date_start,
            date_stop: row.date_stop,
          },
          {
            $set: {
              account_id: String(accountId),
              ad_account_id: ad.id,
              ad_account_name: ad.name ?? null,
              currency: ad.currency ?? null,
              level: 'account',
              date_start: row.date_start ?? null,
              date_stop: row.date_stop ?? null,
              spend: numStr(row.spend),
              impressions: numStr(row.impressions),
              reach: numStr(row.reach),
              frequency: numStr(row.frequency),
              clicks: numStr(row.clicks),
              ctr: numStr(row.ctr),
              cpc: numStr(row.cpc),
              cpm: numStr(row.cpm),
              cpp: numStr(row.cpp),
              unique_clicks: numStr(row.unique_clicks),
              captured_at: new Date(),
            },
          },
          { upsert: true },
        );
        totalRows += 1;
      }

      const campaignBreakdown = await this.client
        .call<GraphListResponse<FacebookAdInsightsRow>>({
          endpoint: `/${ad.id}/insights`,
          params: {
            level: 'campaign',
            fields:
              'campaign_id,campaign_name,date_start,date_stop,spend,impressions,reach,clicks,ctr,cpm',
            date_preset: datePreset,
            limit: 50,
          },
          accessToken,
          context: ctx,
          accountId,
        })
        .catch(() => ({ data: [] }) as GraphListResponse<FacebookAdInsightsRow>);

      for (const row of campaignBreakdown.data ?? []) {
        await collection.updateOne(
          {
            account_id: String(accountId),
            ad_account_id: ad.id,
            level: 'campaign',
            campaign_id: row.campaign_id,
            date_start: row.date_start,
            date_stop: row.date_stop,
          },
          {
            $set: {
              account_id: String(accountId),
              ad_account_id: ad.id,
              currency: ad.currency ?? null,
              level: 'campaign',
              campaign_id: row.campaign_id ?? null,
              campaign_name: row.campaign_name ?? null,
              date_start: row.date_start ?? null,
              date_stop: row.date_stop ?? null,
              spend: numStr(row.spend),
              impressions: numStr(row.impressions),
              reach: numStr(row.reach),
              clicks: numStr(row.clicks),
              ctr: numStr(row.ctr),
              cpm: numStr(row.cpm),
              captured_at: new Date(),
            },
          },
          { upsert: true },
        );
        totalRows += 1;
      }
    }

    return { adAccounts: adAccounts.length, insightRows: totalRows };
  }

  // ───────────────────────────────────────────────────────────── public pages

  async snapshotPublicPage(
    ownerAccountId: bigint,
    accessToken: string,
    targetPageId: string,
  ): Promise<PublicPageSnapshot> {
    const ctx = buildFacebookContext(accessToken, targetPageId, {
      accountId: ownerAccountId,
    });

    const meta = await this.client.call<FacebookPublicPage>({
      endpoint: `/${targetPageId}`,
      params: {
        fields:
          'id,name,fan_count,followers_count,about,category,link,verification_status,picture.width(720).height(720)',
      },
      accessToken,
      context: ctx,
      accountId: ownerAccountId,
    });

    const postsBody = await this.client
      .call<GraphListResponse<FacebookPost>>({
        endpoint: `/${targetPageId}/posts`,
        params: {
          fields:
            'id,message,created_time,permalink_url,full_picture,reactions.summary(total_count),comments.summary(total_count)',
          limit: PUBLIC_PAGE_POSTS_LIMIT,
        },
        accessToken,
        context: ctx,
        accountId: ownerAccountId,
      })
      .catch((err) => {
        this.logger.warn(
          `public posts failed for ${targetPageId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return { data: [] } as GraphListResponse<FacebookPost>;
      });

    const recentPosts = (postsBody.data ?? []).map((p) => ({
      id: p.id,
      message: p.message ?? null,
      created_time: p.created_time ? new Date(p.created_time) : null,
      permalink_url: p.permalink_url ?? null,
      full_picture: p.full_picture ?? null,
      reactions_total: p.reactions?.summary?.total_count ?? 0,
      comments_total: p.comments?.summary?.total_count ?? 0,
    }));

    const collection = this.mongo.getCollection(
      MONGO_COLLECTIONS.publicPageSnapshots,
    );
    await collection.updateOne(
      { owner_account_id: String(ownerAccountId), page_id: targetPageId },
      {
        $set: {
          owner_account_id: String(ownerAccountId),
          page_id: targetPageId,
          name: meta.name ?? null,
          fan_count: meta.fan_count ?? null,
          followers_count: meta.followers_count ?? null,
          about: meta.about ?? null,
          category: meta.category ?? null,
          link: meta.link ?? null,
          verification_status: meta.verification_status ?? null,
          picture_url: meta.picture?.data?.url ?? null,
          recent_posts: recentPosts,
          captured_at: new Date(),
        },
      },
      { upsert: true },
    );

    return {
      pageId: targetPageId,
      name: meta.name ?? null,
      fanCount: meta.fan_count ?? null,
      recentPostsCount: recentPosts.length,
    };
  }

  // ───────────────────────────────────────────────────────────── mentions

  async syncMentions(
    accountId: bigint,
    accessToken: string,
    pageId: string,
    limit = 25,
  ): Promise<MentionsSyncResult> {
    const items = await this.mentionsFetcher.fetch(
      accessToken,
      pageId,
      { limit },
      { accountId, page_id: pageId },
    );
    const collection = this.mongo.getCollection(MONGO_COLLECTIONS.posts);
    let stored = 0;
    for (const item of items) {
      await collection.updateOne(
        {
          account_id: String(accountId),
          platform_content_id: item.platformContentId,
        },
        {
          $set: {
            account_id: String(accountId),
            platform: 'facebook',
            platform_content_id: item.platformContentId,
            data: serializeContent(item),
            updated_at: new Date(),
          },
        },
        { upsert: true },
      );
      stored += 1;
    }
    return { mentionsFetched: items.length, mentionsStored: stored };
  }

  // ───────────────────────────────────────────────────────────── comments

  async syncComments(
    accountId: bigint,
    accessToken: string,
    pageId: string,
    limit = 10,
  ): Promise<CommentsSyncResult> {
    const items = await this.commentsFetcher.fetch(
      accessToken,
      pageId,
      { limit },
      { accountId, page_id: pageId },
    );
    const collection = this.mongo.getCollection(MONGO_COLLECTIONS.pageComments);
    let stored = 0;
    for (const c of items) {
      await collection.updateOne(
        {
          account_id: String(accountId),
          platform_comment_id: c.platformCommentId,
        },
        {
          $set: {
            account_id: String(accountId),
            platform: 'facebook',
            platform_post_id: c.platformContentId,
            platform_comment_id: c.platformCommentId,
            parent_comment_id: c.parentCommentId ?? null,
            message: c.text ?? '',
            author_id: c.authorHandle ?? null,
            author_name: c.authorDisplayName ?? null,
            like_count: c.metrics?.likes ?? null,
            replies_count: c.metrics?.replies ?? null,
            is_owner_reply: c.isOwnerReply ?? false,
            created_time: c.publishedAt ?? null,
            captured_at: new Date(),
          },
        },
        { upsert: true },
      );
      stored += 1;
    }
    return { commentsFetched: items.length, commentsStored: stored };
  }
}

// Serialize a ContentData onto the on-disk shape the public UI expects
// (matches what the sync worker writes from fetchContents). Keeping it
// inline here avoids cross-module coupling with the worker.
function serializeContent(item: {
  platformContentId: string;
  contentType: string;
  caption: string | null;
  permalink: string | null;
  mediaUrls: string[];
  thumbnailUrl?: string | null;
  metrics: { likes?: number; comments?: number; shares?: number; views?: number };
  publishedAt: Date | null;
  fetchedAt: Date;
  ownerHandle?: string | null;
}): Record<string, unknown> {
  return {
    platformContentId: item.platformContentId,
    contentType: item.contentType,
    caption: item.caption,
    permalink: item.permalink,
    mediaUrls: item.mediaUrls,
    thumbnailUrl: item.thumbnailUrl ?? null,
    metrics: item.metrics,
    publishedAt: item.publishedAt,
    fetchedAt: item.fetchedAt,
    ownerHandle: item.ownerHandle ?? null,
  };
}

function numStr(v: string | undefined): number | null {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Public-API view of a single FB Page rating row. */
interface NormalizedRatingView {
  platform_review_id: string;
  rating: number | null;
  recommendation_type: string | null;
  review_text: string | null;
  reviewer_name: string | null;
  permalink_url: string | null;
  created_time: string | null;
}

function toRatingView(
  row: Record<string, unknown>,
): NormalizedRatingView {
  const created = row.created_time;
  const createdIso =
    created instanceof Date
      ? created.toISOString()
      : typeof created === 'string'
        ? created
        : null;
  return {
    platform_review_id: String(row.platform_review_id ?? ''),
    rating: typeof row.rating === 'number' ? row.rating : null,
    recommendation_type:
      typeof row.recommendation_type === 'string'
        ? row.recommendation_type
        : null,
    review_text: typeof row.review_text === 'string' ? row.review_text : null,
    reviewer_name:
      typeof row.reviewer_name === 'string' ? row.reviewer_name : null,
    permalink_url:
      typeof row.permalink_url === 'string' ? row.permalink_url : null,
    created_time: createdIso,
  };
}
