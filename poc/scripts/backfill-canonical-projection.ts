/**
 * Backfills the InsightIQ-compatible projection (phyllo_* collections) from the
 * existing internal collections. Phase 1 of PLAN-canonical-data-api.md.
 *
 * Replays:
 *   identity_snapshots        → profiles
 *   audience_snapshots        → audience
 *   posts                     → contents
 *   comments                  → comments
 *   engagement_deep_snapshots → folded into contents (insights/audience)
 *
 * Idempotent — uses the same deterministic UUIDv5 ids + upsert keys as the
 * live dual-write (CanonicalWriteService), so re-runs converge. The fold step
 * runs AFTER contents so it patches docs that already exist.
 *
 * Usage:
 *   cd poc && npx ts-node -r tsconfig-paths/register scripts/backfill-the standard API-projection.ts
 *   cd poc && DRY_RUN=1 ACCOUNT_ID=13 npx ts-node -r tsconfig-paths/register scripts/backfill-the standard API-projection.ts
 */
import { MongoClient, Db, AnyBulkWriteOperation } from 'mongodb';
import { PrismaClient } from '@prisma/client';
import type {
  ProfileData,
  AudienceData,
  ContentData,
  CommentData,
  EngagementDeepSnapshot,
} from '../src/modules/platforms/shared/platform-types';
import { PLATFORM_IDS, type Platform } from '../src/modules/accounts/products.catalog';
import {
  toApiProfile,
  toApiAudience,
  toApiContent,
  toApiComment,
  type SchemaContext,
} from '../src/modules-compat';
import { deepToContentParts } from '../src/modules-compat/mappers/content.mapper';

const KNOWN = new Set<string>(PLATFORM_IDS);
const dryRun = process.env.DRY_RUN === '1';
const onlyAccount = process.env.ACCOUNT_ID ? process.env.ACCOUNT_ID : null;

interface AccountRow {
  id: bigint;
  platform: string;
  canonicalUserId: string;
  handle: string | null;
  endUserId: string | null;
  connectedAt: Date;
  createdAt: Date;
}

function ctxOf(a: AccountRow): SchemaContext {
  return {
    accountPk: a.id.toString(),
    platform: a.platform as Platform,
    endUserId: a.endUserId,
    endUserName: a.endUserId,
    platformUsername: a.handle,
    canonicalUserId: a.canonicalUserId,
    createdAt: a.connectedAt ?? a.createdAt,
    updatedAt: new Date(),
  };
}

function mongoDbName(url: string): string {
  try {
    const p = new URL(url).pathname.replace(/^\//, '');
    return p.length > 0 ? p : 'connector_ui';
  } catch {
    return 'connector_ui';
  }
}

async function run(): Promise<void> {
  const prisma = new PrismaClient();
  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) throw new Error('MONGO_URL not set');
  const client = new MongoClient(mongoUrl);
  await client.connect();
  const db: Db = client.db(mongoDbName(mongoUrl));

  // Account context map (PK string → row).
  const accounts = await prisma.account.findMany({
    where: onlyAccount ? { id: BigInt(onlyAccount) } : {},
    select: {
      id: true, platform: true, canonicalUserId: true, handle: true,
      endUserId: true, connectedAt: true, createdAt: true,
    },
  });
  const byPk = new Map<string, AccountRow>();
  for (const a of accounts) {
    if (KNOWN.has(a.platform)) byPk.set(a.id.toString(), a as AccountRow);
  }
  console.log(`[backfill] ${byPk.size} eligible accounts${onlyAccount ? ` (filtered to ${onlyAccount})` : ''}`);

  const tally = { profiles: 0, audience: 0, contents: 0, comments: 0, folded: 0 };
  const now = new Date();

  const accFilter = onlyAccount ? { account_id: onlyAccount } : {};

  // ── profiles ──
  for await (const snap of db.collection('identity_snapshots').find(accFilter)) {
    const acc = byPk.get(String(snap.account_id));
    if (!acc) continue;
    const doc = toApiProfile(ctxOf(acc), snap.data as ProfileData);
    if (!dryRun) {
      await db.collection('profiles').updateOne(
        { account_pk: acc.id.toString() },
        { $set: { id: doc.id, account_pk: acc.id.toString(), doc, updated_at: now }, $setOnInsert: { created_at: now } },
        { upsert: true },
      );
    }
    tally.profiles++;
  }

  // ── audience ──
  for await (const snap of db.collection('audience_snapshots').find(accFilter)) {
    const acc = byPk.get(String(snap.account_id));
    if (!acc) continue;
    const doc = toApiAudience(ctxOf(acc), snap.data as AudienceData);
    if (!dryRun) {
      await db.collection('audience').updateOne(
        { account_pk: acc.id.toString() },
        { $set: { id: doc.id, account_pk: acc.id.toString(), doc, updated_at: now }, $setOnInsert: { created_at: now } },
        { upsert: true },
      );
    }
    tally.audience++;
  }

  // ── contents ──
  let ops: AnyBulkWriteOperation[] = [];
  const flush = async (col: string): Promise<void> => {
    if (ops.length === 0 || dryRun) { ops = []; return; }
    await db.collection(col).bulkWrite(ops, { ordered: false });
    ops = [];
  };
  for await (const row of db.collection('posts').find(accFilter)) {
    const acc = byPk.get(String(row.account_id));
    if (!acc) continue;
    const data = row.data as ContentData;
    const externalId = data?.platformContentId ?? String(row.platform_content_id ?? '');
    if (!externalId) continue;
    const doc = toApiContent(ctxOf(acc), data);
    ops.push({
      updateOne: {
        filter: { account_pk: acc.id.toString(), external_id: externalId },
        update: {
          $set: { id: doc.id, account_pk: acc.id.toString(), external_id: externalId, published_at: data.publishedAt ?? null, doc, updated_at: now },
          $setOnInsert: { created_at: now },
        },
        upsert: true,
      },
    });
    tally.contents++;
    if (ops.length >= 500) await flush('contents');
  }
  await flush('contents');

  // ── comments ──
  for await (const row of db.collection('comments').find(accFilter)) {
    const acc = byPk.get(String(row.account_id));
    if (!acc) continue;
    const data = row.data as CommentData;
    const externalId = data?.platformCommentId ?? String(row.platform_comment_id ?? '');
    if (!externalId) continue;
    const doc = toApiComment(ctxOf(acc), data);
    ops.push({
      updateOne: {
        filter: { account_pk: acc.id.toString(), content_external_id: data.platformContentId, external_id: externalId },
        update: {
          $set: { id: doc.id, account_pk: acc.id.toString(), content_external_id: data.platformContentId, external_id: externalId, doc, updated_at: now },
          $setOnInsert: { created_at: now },
        },
        upsert: true,
      },
    });
    tally.comments++;
    if (ops.length >= 500) await flush('comments');
  }
  await flush('comments');

  // ── engagement_deep fold (after contents exist) ──
  for await (const snap of db.collection('engagement_deep_snapshots').find(accFilter)) {
    const acc = byPk.get(String(snap.account_id));
    if (!acc) continue;
    const deepSnap = snap.data as EngagementDeepSnapshot;
    if (!deepSnap || !Array.isArray(deepSnap.items)) continue;
    for (const item of deepSnap.items) {
      const externalId = item.contentId;
      if (!externalId) continue;
      const retention = deepSnap.retention && deepSnap.retention.contentId === externalId ? deepSnap.retention : null;
      const { audience, insights } = deepToContentParts({ item, retention });
      if (!audience && !insights) continue;
      const set: Record<string, unknown> = { updated_at: now };
      if (audience) set['doc.audience'] = audience;
      if (insights) set['doc.insights'] = insights;
      ops.push({
        updateOne: {
          filter: { account_pk: acc.id.toString(), external_id: externalId },
          update: { $set: set },
          upsert: false,
        },
      });
      tally.folded++;
      if (ops.length >= 500) await flush('contents');
    }
  }
  await flush('contents');

  console.log(`[backfill]${dryRun ? ' DRY-RUN' : ''} done:`, tally);
  await client.close();
  await prisma.$disconnect();
}

run().catch((err) => {
  console.error('[backfill] failed:', err);
  process.exit(1);
});
