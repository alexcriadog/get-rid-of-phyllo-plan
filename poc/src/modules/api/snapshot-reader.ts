// Reads the synced snapshots that the sync worker persists to MongoDB,
// so the /v1 read endpoints serve stored data instead of hitting the
// platform API live on every request.
//
// Collection shapes (written by sync.worker.persistToMongo):
//   snapshot collections (1 doc per account[,platform]):
//     identity_snapshots / audience_snapshots /
//     engagement_deep_snapshots / ads_campaigns
//     → { account_id, platform, data, updated_at, created_at }
//   list collections (N docs per account):
//     posts (engagement_new / stories / mentions share this one),
//     comments
//     → { account_id, platform, platform_content_id|platform_comment_id,
//         data, updated_at, created_at }
//
// `data` is exactly the adapter output that was synced, so the existing
// view transformers (toIdentityView, toEngagementView, …) apply unchanged.

import { Injectable } from '@nestjs/common';
import { MongoService } from '@shared/database/mongo.service';

interface SnapshotDoc {
  data: unknown;
  updated_at?: Date | string;
}

@Injectable()
export class SnapshotReader {
  constructor(private readonly mongo: MongoService) {}

  /**
   * Single-document snapshot (identity, audience, engagement_deep, ads).
   * Returns null when the account hasn't been synced for this product yet.
   */
  async readSnapshot(
    collection: string,
    accountId: bigint,
  ): Promise<{ data: unknown; syncedAt: string | null } | null> {
    const doc = await this.mongo
      .getCollection<SnapshotDoc>(collection)
      .findOne({ account_id: accountId.toString() });
    if (!doc) return null;
    return { data: doc.data, syncedAt: toIso(doc.updated_at) };
  }

  /**
   * List snapshot (posts, comments). Returns the most-recent `limit`
   * documents' `data`, newest first, plus the freshest updated_at as
   * `syncedAt`. `extraFilter` lets callers narrow within a shared
   * collection (e.g. stories = posts where data.contentType = 'story').
   */
  async readList(
    collection: string,
    accountId: bigint,
    opts: { limit: number; extraFilter?: Record<string, unknown> },
  ): Promise<{ items: unknown[]; syncedAt: string | null }> {
    const docs = await this.mongo
      .getCollection<SnapshotDoc>(collection)
      .find({ account_id: accountId.toString(), ...(opts.extraFilter ?? {}) })
      .sort({ updated_at: -1 })
      .limit(opts.limit)
      .toArray();
    return {
      items: docs.map((d) => d.data),
      syncedAt: docs.length > 0 ? toIso(docs[0].updated_at) : null,
    };
  }
}

function toIso(v: Date | string | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
