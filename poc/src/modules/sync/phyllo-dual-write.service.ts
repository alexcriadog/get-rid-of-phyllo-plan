// Phyllo-compatible dual-write (§ PLAN-phyllo-schema-alignment.md, Phase 1).
//
// After the sync worker persists a fetch result into our internal collections,
// it also projects the data into Phyllo-shaped documents in the phyllo_*
// collections. The compat read layer (Phase 2) serves those verbatim, so the
// consumer can switch from Phyllo to us by changing only base URL + creds.
//
// Storage wrapper (so we can index/query without parsing the embedded doc):
//   { id, account_pk, external_id?, content_external_id?, published_at?,
//     doc: <exact Phyllo object>, created_at, updated_at }
// The read layer returns `doc` untouched.
//
// Best-effort: this NEVER throws into the sync path. A projection failure is
// logged and swallowed — the internal collections remain the source of truth.

import { Injectable, Logger } from "@nestjs/common";
import type { AnyBulkWriteOperation } from "mongodb";
import { MongoService } from "@shared/database/mongo.service";
import type {
  ContentData,
  CommentData,
  ProfileData,
  AudienceData,
  EngagementDeepSnapshot,
} from "@modules/platforms/shared/platform-types";
import {
  PLATFORM_IDS,
  type Platform,
} from "@modules/accounts/products.catalog";
import {
  toPhylloProfile,
  toPhylloAudience,
  toPhylloContent,
  toPhylloComment,
  type PhylloContext,
} from "@modules/phyllo-compat";
import { deepToContentParts } from "@modules/phyllo-compat/mappers/content.mapper";

/** Minimal account shape the dual-write needs (subset of the Prisma row). */
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
export class PhylloDualWriteService {
  private readonly logger = new Logger(PhylloDualWriteService.name);

  constructor(private readonly mongo: MongoService) {}

  /** Project a persisted fetch result into the phyllo_* collections. */
  async write(
    account: DualWriteAccount,
    result: DualWriteResult,
  ): Promise<void> {
    if (!KNOWN_PLATFORMS.has(account.platform)) return; // e.g. x/twitter — no Phyllo platform
    try {
      const ctx = this.buildContext(account);
      switch (result.kind) {
        case "identity":
          await this.writeProfile(ctx, result.data as ProfileData);
          break;
        case "audience":
          await this.writeAudience(ctx, result.data as AudienceData);
          break;
        case "content":
          await this.writeContents(ctx, result.data as ContentData[]);
          break;
        case "comments":
          await this.writeComments(ctx, result.data as CommentData[]);
          break;
        case "engagement_deep":
          await this.foldDeep(ctx, result.data as EngagementDeepSnapshot);
          break;
        default:
          break; // ads / ratings / noop — not part of the Phyllo surface (yet)
      }
    } catch (err) {
      this.logger.warn(
        `phyllo dual-write failed (account=${account.id.toString()}, kind=${result.kind}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private buildContext(account: DualWriteAccount): PhylloContext {
    return {
      accountPk: account.id.toString(),
      platform: account.platform as Platform,
      endUserId: account.endUserId,
      // We have no separate end-user display-name store; Phyllo's user.name
      // commonly equals the external_id, so mirror endUserId.
      endUserName: account.endUserId,
      platformUsername: account.handle,
      canonicalUserId: account.canonicalUserId,
      createdAt: account.connectedAt ?? account.createdAt,
      updatedAt: new Date(),
    };
  }

  private async writeProfile(
    ctx: PhylloContext,
    data: ProfileData,
  ): Promise<void> {
    const doc = toPhylloProfile(ctx, data);
    const now = new Date();
    await this.mongo.getCollection("phyllo_profiles").updateOne(
      { account_pk: ctx.accountPk },
      {
        $set: { id: doc.id, account_pk: ctx.accountPk, doc, updated_at: now },
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    );
  }

  private async writeAudience(
    ctx: PhylloContext,
    data: AudienceData,
  ): Promise<void> {
    const doc = toPhylloAudience(ctx, data);
    const now = new Date();
    await this.mongo.getCollection("phyllo_audience").updateOne(
      { account_pk: ctx.accountPk },
      {
        $set: { id: doc.id, account_pk: ctx.accountPk, doc, updated_at: now },
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    );
  }

  private async writeContents(
    ctx: PhylloContext,
    items: ContentData[],
  ): Promise<void> {
    if (!Array.isArray(items) || items.length === 0) return;
    const now = new Date();
    const ops: AnyBulkWriteOperation[] = [];
    for (const item of items) {
      const externalId = item.platformContentId;
      if (!externalId) continue;
      const doc = toPhylloContent(ctx, item);
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
    if (ops.length > 0) {
      await this.mongo
        .getCollection("phyllo_contents")
        .bulkWrite(ops, { ordered: false });
    }
  }

  private async writeComments(
    ctx: PhylloContext,
    items: CommentData[],
  ): Promise<void> {
    if (!Array.isArray(items) || items.length === 0) return;
    const now = new Date();
    const ops: AnyBulkWriteOperation[] = [];
    for (const item of items) {
      const externalId = item.platformCommentId;
      if (!externalId) continue;
      const doc = toPhylloComment(ctx, item);
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
    if (ops.length > 0) {
      await this.mongo
        .getCollection("phyllo_comments")
        .bulkWrite(ops, { ordered: false });
    }
  }

  /**
   * Fold a deep-analytics snapshot into existing phyllo_contents docs (§4.6).
   * Patches only `doc.audience` + `doc.insights` on the matching content,
   * keyed by external content id. Skips contents we haven't stored yet — the
   * next deep run after the content lands will fill them. Never overwrites a
   * populated doc with empties (partial snapshots cover only top-N videos).
   */
  private async foldDeep(
    ctx: PhylloContext,
    snap: EngagementDeepSnapshot,
  ): Promise<void> {
    if (!snap || !Array.isArray(snap.items) || snap.items.length === 0) return;
    const col = this.mongo.getCollection("phyllo_contents");
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
