// Mongo reads for the InsightIQ-compatible surface. The canonical docs are stored
// already in InsightIQ wire shape (dual-write), so this returns the embedded
// `doc` verbatim plus list paging. Tenancy is enforced by the controllers via
// ApiAccountResolver (account_pk → workspace).

import { Injectable } from "@nestjs/common";
import { MongoService } from "@shared/database/mongo.service";
import type {
  ApiProfile,
  ApiContent,
  ApiAudience,
  ApiComment,
} from "@modules/data-schema";

interface Wrapper<T> {
  id: string;
  account_pk: string;
  doc: T;
}

/** Per-account engagement totals over a window (used by the MCP overview). */
export interface EngagementSummary {
  accountPk: string;
  posts: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  views: number;
  impressions: number;
  reach: number;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

@Injectable()
export class ApiReadService {
  constructor(private readonly mongo: MongoService) {}

  async profileByAccountPk(accountPk: string): Promise<ApiProfile | null> {
    const row = await this.mongo
      .getCollection<Wrapper<ApiProfile>>("profiles")
      .findOne({ account_pk: accountPk });
    return row?.doc ?? null;
  }

  async profileById(
    id: string,
  ): Promise<{ doc: ApiProfile; accountPk: string } | null> {
    const row = await this.mongo
      .getCollection<Wrapper<ApiProfile>>("profiles")
      .findOne({ id });
    return row ? { doc: row.doc, accountPk: row.account_pk } : null;
  }

  async audienceByAccountPk(accountPk: string): Promise<ApiAudience | null> {
    const row = await this.mongo
      .getCollection<Wrapper<ApiAudience>>("audience")
      .findOne({ account_pk: accountPk });
    return row?.doc ?? null;
  }

  async contents(
    accountPk: string,
    opts: {
      offset: number;
      limit: number;
      fromDate?: Date;
      toDate?: Date;
      hashtag?: string;
      query?: string;
    },
  ): Promise<ApiContent[]> {
    const filter: Record<string, unknown> = { account_pk: accountPk };
    if (opts.fromDate || opts.toDate) {
      const range: Record<string, Date> = {};
      if (opts.fromDate) range.$gte = opts.fromDate;
      if (opts.toDate) range.$lte = opts.toDate;
      filter.published_at = range;
    }
    if (opts.hashtag) {
      // Hashtags are stored with the leading '#'; match case-insensitively and
      // tolerate the caller omitting it. $regex on an array field matches if any
      // element matches.
      const tag = escapeRegex(opts.hashtag.replace(/^#/, ""));
      filter["doc.hashtags"] = { $regex: `^#?${tag}$`, $options: "i" };
    }
    if (opts.query) {
      const q = escapeRegex(opts.query);
      filter.$or = [
        { "doc.title": { $regex: q, $options: "i" } },
        { "doc.description": { $regex: q, $options: "i" } },
      ];
    }
    const rows = await this.mongo
      .getCollection<Wrapper<ApiContent>>("contents")
      .find(filter)
      .sort({ published_at: -1 })
      .skip(opts.offset)
      .limit(opts.limit)
      .toArray();
    return rows.map((r) => r.doc);
  }

  async contentById(
    id: string,
  ): Promise<{ doc: ApiContent; accountPk: string } | null> {
    const row = await this.mongo
      .getCollection<Wrapper<ApiContent>>("contents")
      .findOne({ id });
    return row ? { doc: row.doc, accountPk: row.account_pk } : null;
  }

  async contentsByIds(
    ids: string[],
  ): Promise<Array<{ doc: ApiContent; accountPk: string }>> {
    const rows = await this.mongo
      .getCollection<Wrapper<ApiContent>>("contents")
      .find({ id: { $in: ids } })
      .toArray();
    return rows.map((r) => ({ doc: r.doc, accountPk: r.account_pk }));
  }

  async comments(
    accountPk: string,
    contentExternalId: string,
    opts: { offset: number; limit: number },
  ): Promise<ApiComment[]> {
    const rows = await this.mongo
      .getCollection<Wrapper<ApiComment>>("comments")
      .find({ account_pk: accountPk, content_external_id: contentExternalId })
      .sort({ updated_at: -1 })
      .skip(opts.offset)
      .limit(opts.limit)
      .toArray();
    return rows.map((r) => r.doc);
  }

  /**
   * Aggregate engagement totals per account over an optional date window. Uses a
   * Mongo $group so the database does the summing — no document transfer, so it
   * stays fast even across a workspace's full content history.
   */
  async engagementSummary(
    accountPks: string[],
    fromDate?: Date,
    toDate?: Date,
  ): Promise<EngagementSummary[]> {
    if (accountPks.length === 0) return [];
    const match: Record<string, unknown> = { account_pk: { $in: accountPks } };
    if (fromDate || toDate) {
      const range: Record<string, Date> = {};
      if (fromDate) range.$gte = fromDate;
      if (toDate) range.$lte = toDate;
      match.published_at = range;
    }
    const rows = await this.mongo
      .getCollection<Wrapper<ApiContent>>("contents")
      .aggregate<{
        _id: string;
        posts: number;
        likes: number;
        comments: number;
        shares: number;
        saves: number;
        views: number;
        impressions: number;
        reach: number;
      }>([
        { $match: match },
        {
          $group: {
            _id: "$account_pk",
            posts: { $sum: 1 },
            likes: { $sum: "$doc.engagement.like_count" },
            comments: { $sum: "$doc.engagement.comment_count" },
            shares: { $sum: "$doc.engagement.share_count" },
            saves: { $sum: "$doc.engagement.save_count" },
            views: { $sum: "$doc.engagement.view_count" },
            impressions: { $sum: "$doc.engagement.impression_organic_count" },
            reach: { $sum: "$doc.engagement.reach_organic_count" },
          },
        },
      ])
      .toArray();
    return rows.map((r) => ({
      accountPk: r._id,
      posts: r.posts,
      likes: r.likes,
      comments: r.comments,
      shares: r.shares,
      saves: r.saves,
      views: r.views,
      impressions: r.impressions,
      reach: r.reach,
    }));
  }
}
