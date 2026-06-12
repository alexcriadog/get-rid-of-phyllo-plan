// Canonical persistence (single source of truth). The sync worker hands every
// fetch result here; we map it to the InsightIQ-standard shape and store it
// directly in the served collections (profiles / contents / audience /
// comments). The read API serves the embedded `doc` verbatim — no per-request
// parsing.
//
// Storage wrapper (so we can index/query without parsing the embedded doc):
//   { id, account_pk, external_id?, content_external_id?, published_at?,
//     doc: <exact API object>, created_at, updated_at }
//
// Returns a {itemsAdded, sampleIds, itemsUpdated, updatedSampleIds} delta so
// the worker can fire data webhooks — `itemsAdded`/`sampleIds` cover newly
// upserted items, `itemsUpdated`/`updatedSampleIds` cover in-window existing
// items whose engagement metrics changed (drives data.<product>.updated).
// Best-effort on the canonical write itself: a mapping failure is logged and
// swallowed (returns a zero delta) so a projection bug never breaks the sync.

import { Injectable, Logger } from "@nestjs/common";
import type { AnyBulkWriteOperation } from "mongodb";
import { MongoService } from "@shared/database/mongo.service";
import type {
  ContentData,
  CommentData,
  ProfileData,
  AudienceData,
  AdsSnapshot,
  EngagementDeepSnapshot,
} from "@modules/platforms/shared/platform-types";
import {
  PLATFORM_IDS,
  type Platform,
} from "@modules/accounts/products.catalog";
import {
  toApiProfile,
  toApiAudience,
  toApiContent,
  toApiComment,
  coalesceMerge,
  type SchemaContext,
} from "@modules/data-schema";
import { deepToContentParts } from "@modules/data-schema/mappers/content.mapper";

const ENGAGEMENT_KEYS = [
  "like_count",
  "comment_count",
  "view_count",
  "share_count",
  "save_count",
  "dislike_count",
] as const;

/** True if any engagement metric differs between the stored doc and the fresh doc. */
export function engagementChanged(prev: unknown, fresh: unknown): boolean {
  const p =
    (prev as { engagement?: Record<string, unknown> } | null)?.engagement ?? {};
  const f =
    (fresh as { engagement?: Record<string, unknown> } | null)?.engagement ?? {};
  for (const k of ENGAGEMENT_KEYS) {
    if ((p[k] ?? null) !== (f[k] ?? null)) return true;
  }
  return false;
}

/** Delta used to fire data.<product>.updated webhooks (added + engagement-updated). */
export interface PersistDelta {
  itemsAdded: number;
  sampleIds: string[];
  itemsUpdated: number;
  updatedSampleIds: string[];
}

const ZERO_DELTA: PersistDelta = {
  itemsAdded: 0,
  sampleIds: [],
  itemsUpdated: 0,
  updatedSampleIds: [],
};
const SNAPSHOT_DELTA: PersistDelta = {
  itemsAdded: 1,
  sampleIds: [],
  itemsUpdated: 0,
  updatedSampleIds: [],
};

/** Minimal account shape the persist path needs (subset of the Prisma row). */
export interface DualWriteAccount {
  id: bigint;
  platform: string;
  canonicalUserId: string;
  handle: string | null;
  endUserId: string | null;
  connectedAt: Date;
  createdAt: Date;
}

/** The fetch result kinds the worker hands us (mirrors FetchResult). */
export type DualWriteResult =
  | { kind: "identity"; data: ProfileData }
  | { kind: "audience"; data: AudienceData }
  | { kind: "content"; data: ContentData[] }
  | { kind: "comments"; data: CommentData[] }
  | { kind: "engagement_deep"; data: EngagementDeepSnapshot }
  | { kind: string; data: unknown };

const KNOWN_PLATFORMS = new Set<string>(PLATFORM_IDS);

@Injectable()
export class CanonicalWriteService {
  private readonly logger = new Logger(CanonicalWriteService.name);

  constructor(private readonly mongo: MongoService) {}

  /**
   * Persist a fetch result into the canonical served collections and return a
   * {itemsAdded, sampleIds} delta. Single source of truth — the worker calls
   * only this. `noop` (side-channel products like FB ratings/ad_insights) and
   * unsupported platforms return a zero delta.
   */
  async persist(
    account: DualWriteAccount,
    result: DualWriteResult,
    windowDays = 90,
  ): Promise<PersistDelta> {
    if (!KNOWN_PLATFORMS.has(account.platform)) return ZERO_DELTA;
    try {
      const ctx = this.buildContext(account);
      switch (result.kind) {
        case "identity":
          await this.writeProfile(ctx, result.data as ProfileData);
          return SNAPSHOT_DELTA;
        case "audience":
          await this.writeAudience(ctx, result.data as AudienceData);
          return SNAPSHOT_DELTA;
        case "content":
          return this.writeContents(
            ctx,
            result.data as ContentData[],
            windowDays,
          );
        case "comments":
          return this.writeComments(ctx, result.data as CommentData[]);
        case "engagement_deep":
          await this.foldDeep(ctx, result.data as EngagementDeepSnapshot);
          return SNAPSHOT_DELTA;
        case "ads":
          await this.writeAds(ctx, result.data as AdsSnapshot);
          return SNAPSHOT_DELTA;
        default:
          return ZERO_DELTA; // noop side-channel (ratings/ad_insights) persists itself
      }
    } catch (err) {
      this.logger.warn(
        `canonical persist failed (account=${account.id.toString()}, kind=${result.kind}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return ZERO_DELTA;
    }
  }

  /** Ads snapshot (YouTube via Google Ads). Kept internal — not InsightIQ-shaped. */
  private async writeAds(ctx: SchemaContext, data: AdsSnapshot): Promise<void> {
    const now = new Date();
    await this.mongo.getCollection("ads_campaigns").updateOne(
      { account_id: ctx.accountPk, platform: ctx.platform },
      {
        $set: {
          account_id: ctx.accountPk,
          platform: ctx.platform,
          data,
          updated_at: now,
        },
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    );
  }

  /** Derive {itemsAdded, sampleIds} from a bulkWrite result (new upserts only). */
  private deltaFromBulk(
    res: { upsertedCount: number; upsertedIds?: Record<number, unknown> },
    idByOpIndex: ReadonlyArray<string>,
  ): PersistDelta {
    const upsertedIndices = Object.keys(res.upsertedIds ?? {});
    const sampleIds: string[] = [];
    for (const idxStr of upsertedIndices) {
      const id = idByOpIndex[Number(idxStr)];
      if (id && sampleIds.length < 20) sampleIds.push(id);
    }
    return {
      itemsAdded: res.upsertedCount ?? upsertedIndices.length,
      sampleIds,
      itemsUpdated: 0,
      updatedSampleIds: [],
    };
  }

  private buildContext(account: DualWriteAccount): SchemaContext {
    return {
      accountPk: account.id.toString(),
      platform: account.platform as Platform,
      endUserId: account.endUserId,
      // We have no separate end-user display-name store; InsightIQ's user.name
      // commonly equals the external_id, so mirror endUserId.
      endUserName: account.endUserId,
      platformUsername: account.handle,
      canonicalUserId: account.canonicalUserId,
      createdAt: account.connectedAt ?? account.createdAt,
      updatedAt: new Date(),
    };
  }

  private async writeProfile(
    ctx: SchemaContext,
    data: ProfileData,
  ): Promise<void> {
    const fresh = toApiProfile(ctx, data);
    const now = new Date();
    const col = this.mongo.getCollection<{ doc?: unknown }>("profiles");
    // Keep last-known-good: merge over the stored doc so a partial fetch
    // (e.g. a rate-limited stats sub-call → null fields) never clobbers data.
    const existing = await col.findOne({ account_pk: ctx.accountPk });
    const doc = existing?.doc ? coalesceMerge(existing.doc, fresh) : fresh;
    await col.updateOne(
      { account_pk: ctx.accountPk },
      {
        $set: { id: fresh.id, account_pk: ctx.accountPk, doc, updated_at: now },
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    );
  }

  private async writeAudience(
    ctx: SchemaContext,
    data: AudienceData,
  ): Promise<void> {
    const fresh = toApiAudience(ctx, data);
    const now = new Date();
    const col = this.mongo.getCollection<{ doc?: unknown }>("audience");
    const existing = await col.findOne({ account_pk: ctx.accountPk });
    const doc = existing?.doc ? coalesceMerge(existing.doc, fresh) : fresh;
    await col.updateOne(
      { account_pk: ctx.accountPk },
      {
        $set: { id: fresh.id, account_pk: ctx.accountPk, doc, updated_at: now },
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    );
  }

  private async writeContents(
    ctx: SchemaContext,
    items: ContentData[],
    windowDays = 90,
  ): Promise<PersistDelta> {
    if (!Array.isArray(items) || items.length === 0) return ZERO_DELTA;
    const now = new Date();
    const col = this.mongo.getCollection<{
      external_id?: string;
      doc?: unknown;
    }>("contents");
    // Bulk-load the stored docs once so we can keep last-known-good per post
    // (e.g. engagement comes back null when share-stats are rate-limited).
    const externalIds = items
      .map((i) => i.platformContentId)
      .filter((x): x is string => typeof x === "string" && x.length > 0);
    const existingDocs = await col
      .find({ account_pk: ctx.accountPk, external_id: { $in: externalIds } })
      .toArray();
    const prevByExt = new Map<string, unknown>();
    for (const d of existingDocs) {
      if (d.external_id) prevByExt.set(d.external_id, d.doc);
    }
    // Engagement-update delta (window-scoped): an existing post within the
    // recent window whose engagement metrics changed counts as "updated" so
    // the worker can fire a data.<product>.updated webhook for refreshed stats.
    const updatedSampleIds: string[] = [];
    let itemsUpdatedCount = 0;
    const cutoff = Date.now() - windowDays * 86_400_000;
    const ops: AnyBulkWriteOperation[] = [];
    const idByOpIndex: string[] = [];
    for (const item of items) {
      const externalId = item.platformContentId;
      if (!externalId) continue;
      idByOpIndex.push(externalId);
      const fresh = toApiContent(ctx, item);
      const prev = prevByExt.get(externalId);
      const doc = prev ? coalesceMerge(prev, fresh) : fresh;
      const publishedMs = item.publishedAt
        ? new Date(item.publishedAt).getTime()
        : 0;
      // Compare against `doc` (the merged value we actually persist), NOT raw
      // `fresh`: coalesceMerge keeps last-known-good when a fresh metric is
      // null, so a partial fetch (e.g. rate-limited share-stats) must not
      // register as a change just because `fresh` dropped a field to null.
      if (prev && publishedMs >= cutoff && engagementChanged(prev, doc)) {
        if (updatedSampleIds.length < 20) updatedSampleIds.push(externalId);
        itemsUpdatedCount++;
      }
      ops.push({
        updateOne: {
          filter: { account_pk: ctx.accountPk, external_id: externalId },
          update: {
            $set: {
              id: fresh.id,
              account_pk: ctx.accountPk,
              external_id: externalId,
              published_at: item.publishedAt ?? null,
              doc,
              updated_at: now,
            },
            $setOnInsert: { created_at: now },
          },
          upsert: true,
        },
      });
    }
    if (ops.length === 0) return ZERO_DELTA;
    const res = await col.bulkWrite(ops, { ordered: false });
    const base = this.deltaFromBulk(res, idByOpIndex);
    return { ...base, itemsUpdated: itemsUpdatedCount, updatedSampleIds };
  }

  private async writeComments(
    ctx: SchemaContext,
    items: CommentData[],
  ): Promise<PersistDelta> {
    if (!Array.isArray(items) || items.length === 0) return ZERO_DELTA;
    const now = new Date();
    const col = this.mongo.getCollection<{
      external_id?: string;
      doc?: unknown;
    }>("comments");
    const externalIds = items
      .map((i) => i.platformCommentId)
      .filter((x): x is string => typeof x === "string" && x.length > 0);
    const existingDocs = await col
      .find({ account_pk: ctx.accountPk, external_id: { $in: externalIds } })
      .toArray();
    const prevByExt = new Map<string, unknown>();
    for (const d of existingDocs) {
      if (d.external_id) prevByExt.set(d.external_id, d.doc);
    }
    const ops: AnyBulkWriteOperation[] = [];
    const idByOpIndex: string[] = [];
    for (const item of items) {
      const externalId = item.platformCommentId;
      if (!externalId) continue;
      idByOpIndex.push(externalId);
      const fresh = toApiComment(ctx, item);
      const prev = prevByExt.get(externalId);
      const doc = prev ? coalesceMerge(prev, fresh) : fresh;
      ops.push({
        updateOne: {
          filter: {
            account_pk: ctx.accountPk,
            content_external_id: item.platformContentId,
            external_id: externalId,
          },
          update: {
            $set: {
              id: fresh.id,
              account_pk: ctx.accountPk,
              content_external_id: item.platformContentId,
              external_id: externalId,
              doc,
              updated_at: now,
            },
            $setOnInsert: { created_at: now },
          },
          upsert: true,
        },
      });
    }
    if (ops.length === 0) return ZERO_DELTA;
    const res = await col.bulkWrite(ops, { ordered: false });
    return this.deltaFromBulk(res, idByOpIndex);
  }

  /**
   * Fold a deep-analytics snapshot into existing contents docs (§4.6).
   * Patches only `doc.audience` + `doc.insights` on the matching content,
   * keyed by external content id. Skips contents we haven't stored yet — the
   * next deep run after the content lands will fill them. Never overwrites a
   * populated doc with empties (partial snapshots cover only top-N videos).
   */
  private async foldDeep(
    ctx: SchemaContext,
    snap: EngagementDeepSnapshot,
  ): Promise<void> {
    if (!snap || !Array.isArray(snap.items) || snap.items.length === 0) return;
    const col = this.mongo.getCollection("contents");
    const now = new Date();
    const ops: AnyBulkWriteOperation[] = [];
    for (const item of snap.items) {
      const externalId = item.contentId;
      if (!externalId) continue;
      const retention =
        snap.retention && snap.retention.contentId === externalId
          ? snap.retention
          : null;
      const { audience, insights } = deepToContentParts({ item, retention });
      if (!audience && !insights) continue;
      const set: Record<string, unknown> = { updated_at: now };
      if (audience) set["doc.audience"] = audience;
      if (insights) set["doc.insights"] = insights;
      ops.push({
        updateOne: {
          filter: { account_pk: ctx.accountPk, external_id: externalId },
          update: { $set: set },
          upsert: false,
        },
      });
    }
    if (ops.length > 0) {
      await col.bulkWrite(ops, { ordered: false });
    }
  }
}
