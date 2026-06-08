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
// Returns a {itemsAdded, sampleIds} delta so the worker can fire data webhooks.
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
  type SchemaContext,
} from "@modules/data-schema";
import { deepToContentParts } from "@modules/data-schema/mappers/content.mapper";

/** {itemsAdded, sampleIds} delta used to fire data.<product>.updated webhooks. */
export interface PersistDelta {
  itemsAdded: number;
  sampleIds: string[];
}

const ZERO_DELTA: PersistDelta = { itemsAdded: 0, sampleIds: [] };
const SNAPSHOT_DELTA: PersistDelta = { itemsAdded: 1, sampleIds: [] };

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
          return this.writeContents(ctx, result.data as ContentData[]);
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
    const doc = toApiProfile(ctx, data);
    const now = new Date();
    await this.mongo.getCollection("profiles").updateOne(
      { account_pk: ctx.accountPk },
      {
        $set: { id: doc.id, account_pk: ctx.accountPk, doc, updated_at: now },
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    );
  }

  private async writeAudience(
    ctx: SchemaContext,
    data: AudienceData,
  ): Promise<void> {
    const doc = toApiAudience(ctx, data);
    const now = new Date();
    await this.mongo.getCollection("audience").updateOne(
      { account_pk: ctx.accountPk },
      {
        $set: { id: doc.id, account_pk: ctx.accountPk, doc, updated_at: now },
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    );
  }

  private async writeContents(
    ctx: SchemaContext,
    items: ContentData[],
  ): Promise<PersistDelta> {
    if (!Array.isArray(items) || items.length === 0) return ZERO_DELTA;
    const now = new Date();
    const ops: AnyBulkWriteOperation[] = [];
    const idByOpIndex: string[] = [];
    for (const item of items) {
      const externalId = item.platformContentId;
      if (!externalId) continue;
      idByOpIndex.push(externalId);
      const doc = toApiContent(ctx, item);
      ops.push({
        updateOne: {
          filter: { account_pk: ctx.accountPk, external_id: externalId },
          update: {
            $set: {
              id: doc.id,
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
    const res = await this.mongo
      .getCollection("contents")
      .bulkWrite(ops, { ordered: false });
    return this.deltaFromBulk(res, idByOpIndex);
  }

  private async writeComments(
    ctx: SchemaContext,
    items: CommentData[],
  ): Promise<PersistDelta> {
    if (!Array.isArray(items) || items.length === 0) return ZERO_DELTA;
    const now = new Date();
    const ops: AnyBulkWriteOperation[] = [];
    const idByOpIndex: string[] = [];
    for (const item of items) {
      const externalId = item.platformCommentId;
      if (!externalId) continue;
      idByOpIndex.push(externalId);
      const doc = toApiComment(ctx, item);
      ops.push({
        updateOne: {
          filter: {
            account_pk: ctx.accountPk,
            content_external_id: item.platformContentId,
            external_id: externalId,
          },
          update: {
            $set: {
              id: doc.id,
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
    const res = await this.mongo
      .getCollection("comments")
      .bulkWrite(ops, { ordered: false });
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
