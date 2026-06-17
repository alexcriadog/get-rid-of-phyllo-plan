/**
 * Prisma seed script — Day 1 PoC.
 *
 * Seeds:
 *   - `cadences` table with platform defaults (IG + FB).
 *   - Optionally: one Account (+ OAuthToken + sync_jobs) if SEED_IG_* or SEED_FB_*
 *     env vars are set.
 *
 * Idempotent via upsert on unique keys.
 *
 * Run:
 *   SEED_IG_TOKEN="..." SEED_IG_BUSINESS_ID="..." SEED_IG_HANDLE="@..." \
 *   SEED_IG_PAGE_ID="..." npm run seed
 *
 *   SEED_FB_TOKEN="..." SEED_FB_PAGE_ID="..." SEED_FB_HANDLE="..." \
 *   SEED_PLATFORM=facebook npm run seed
 */

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { resolveBackfillProducts } from '../src/modules/accounts/backfill-products';
import { connectionFlowFor } from '../src/modules/accounts/connection-flow';

// Load .env manually (no external dep); ignore if missing.
function loadDotenv(): void {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotenv();

const prisma = new PrismaClient();

// ---------- AES-256-GCM (local, PoC-only) ----------

const AES_KEY_ENV = 'LOCAL_AES_KEY';

function getAesKey(): Buffer {
  const hex = process.env[AES_KEY_ENV];
  if (!hex) {
    throw new Error(
      `${AES_KEY_ENV} is missing. Generate with \`openssl rand -hex 32\` and set in .env.`,
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      `${AES_KEY_ENV} must be a 64-char hex string (32 bytes). Got length ${hex.length}.`,
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypts plaintext -> `iv(12) || tag(16) || ciphertext` as Bytes.
 * Must match the layout expected by `AesLocalService.decrypt()` in
 * src/shared/crypto/aes-local.service.ts.
 */
function encryptToken(plaintext: string): Buffer {
  const key = getAesKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

// ---------- Cadence defaults (IMPLEMENTATION.md §2.5) ----------

type CadenceRow = {
  platform: string;
  product: string;
  defaultIntervalSeconds: number;
};

const CADENCE_DEFAULTS: CadenceRow[] = [
  { platform: 'instagram', product: 'identity', defaultIntervalSeconds: 21600 },
  { platform: 'instagram', product: 'audience', defaultIntervalSeconds: 86400 },
  { platform: 'instagram', product: 'engagement_new', defaultIntervalSeconds: 7200 },
  { platform: 'instagram', product: 'stories', defaultIntervalSeconds: 3600 },
  { platform: 'facebook', product: 'identity', defaultIntervalSeconds: 21600 },
  { platform: 'facebook', product: 'audience', defaultIntervalSeconds: 86400 },
  { platform: 'facebook', product: 'engagement_new', defaultIntervalSeconds: 7200 },
  // Page Stories API: stories expire 24h after publish, so cadence mirrors IG.
  { platform: 'facebook', product: 'stories', defaultIntervalSeconds: 3600 },
  // pages_read_user_content (May 2026 grant). /tagged is rare so 6h is
  // plenty; user comments rotate faster on viral posts so 4h.
  { platform: 'facebook', product: 'mentions', defaultIntervalSeconds: 21600 },
  { platform: 'facebook', product: 'comments', defaultIntervalSeconds: 14400 },
  // Reviews/ratings change rarely; daily is generous.
  { platform: 'facebook', product: 'ratings', defaultIntervalSeconds: 86400 },
  // Ads spend snapshot — daily window, daily refresh is the natural cadence.
  { platform: 'facebook', product: 'ads', defaultIntervalSeconds: 86400 },
  // YouTube — Data API v3 has a 10k unit/day project quota so identity stays
  // cheap (1u/refresh) and engagement_new is conservative (1 channels +
  // 20 playlistItems + 20 videos for a 1k-video channel ≈ 41u/refresh).
  // Audience uses Analytics API (no quota units, just QPS) so it can run
  // daily without burning Data API budget.
  { platform: 'youtube', product: 'identity', defaultIntervalSeconds: 21600 },
  { platform: 'youtube', product: 'audience', defaultIntervalSeconds: 86400 },
  { platform: 'youtube', product: 'engagement_new', defaultIntervalSeconds: 14400 },
  { platform: 'youtube', product: 'comments', defaultIntervalSeconds: 43200 },
  // Per-video Analytics drill-down + retention curve. 6h cadence — data
  // moves slowly and the batched fan-out costs 7 Analytics units per sync.
  { platform: 'youtube', product: 'engagement_deep', defaultIntervalSeconds: 21600 },
  // Google Ads campaigns (advertiser side). 6h cadence; expects a Basic
  // developer token via GOOGLE_ADS_DEVELOPER_TOKEN.
  { platform: 'youtube', product: 'ads', defaultIntervalSeconds: 21600 },
  // Twitch — Helix points budget is 800/min and our two products combined
  // cost ≈4 points per sync (1× /users + 1× /channels + 1× /channels/
  // followers + 1-N× /subscriptions for identity; 1× /videos + 1× /clips
  // for engagement_new). Cadence mirrors YouTube — identity every 6h,
  // content every 4h.
  { platform: 'twitch', product: 'identity', defaultIntervalSeconds: 21600 },
  { platform: 'twitch', product: 'engagement_new', defaultIntervalSeconds: 14400 },
  // LinkedIn — dev tier is a HARD ~500 calls/app/day (midnight UTC reset).
  // A full org sync cycle is call-heavy (posts pagination + per-post share
  // statistics + socialMetadata + media + facet-name decodes; comments hits
  // ~1 call per recent post). At the old 6h cadence the daily quota was
  // exhausted before noon, so later syncs got 429s and wrote nulls over good
  // data. Cadences are now stretched to fit comfortably inside 500/day:
  //   identity 12h (2/day), engagement_new/comments/mentions/audience 24h.
  // Raise these once the LinkedIn app is upgraded off the development tier.
  { platform: 'linkedin', product: 'identity', defaultIntervalSeconds: 43200 },
  { platform: 'linkedin', product: 'audience', defaultIntervalSeconds: 86400 },
  { platform: 'linkedin', product: 'engagement_new', defaultIntervalSeconds: 86400 },
  // Comments is the heaviest product (≈1 socialActions call per recent post),
  // so daily; mentions daily too.
  { platform: 'linkedin', product: 'comments', defaultIntervalSeconds: 86400 },
  { platform: 'linkedin', product: 'mentions', defaultIntervalSeconds: 86400 },
];

async function seedCadences(): Promise<number> {
  let count = 0;
  for (const row of CADENCE_DEFAULTS) {
    await prisma.cadence.upsert({
      where: {
        platform_product: { platform: row.platform, product: row.product },
      },
      create: row,
      update: { defaultIntervalSeconds: row.defaultIntervalSeconds },
    });
    count += 1;
  }
  return count;
}

// ---------- Account seeding ----------

type SeedAccountInput = {
  platform: 'instagram' | 'facebook';
  canonicalUserId: string;
  handle?: string;
  token: string;
  scopes: string[];
  products: string[];
};

async function seedAccount(input: SeedAccountInput): Promise<{
  accountId: bigint;
  created: boolean;
  syncJobsCreated: number;
}> {
  const ciphertext = encryptToken(input.token);

  // Seed script always lands on the auto-created "demo" workspace. Real
  // multi-tenant seeding goes through the /v1/sdk-tokens path in Phase 3+.
  const workspaceId = 'wkspc_demo';
  const connectionFlow = connectionFlowFor(input.platform);

  const existing = await prisma.account.findUnique({
    where: {
      workspaceId_platform_canonicalUserId_connectionFlow: {
        workspaceId,
        platform: input.platform,
        canonicalUserId: input.canonicalUserId,
        connectionFlow,
      },
    },
  });

  const account = await prisma.account.upsert({
    where: {
      workspaceId_platform_canonicalUserId_connectionFlow: {
        workspaceId,
        platform: input.platform,
        canonicalUserId: input.canonicalUserId,
        connectionFlow,
      },
    },
    create: {
      workspaceId,
      platform: input.platform,
      canonicalUserId: input.canonicalUserId,
      connectionFlow,
      handle: input.handle ?? null,
      displayName: input.handle ?? null,
      status: 'ready',
      syncTier: 'standard',
      owningOrganizationId: 'demo',
    },
    update: {
      handle: input.handle ?? null,
      displayName: input.handle ?? null,
      status: 'ready',
    },
  });

  await prisma.oAuthToken.upsert({
    where: { accountId: account.id },
    create: {
      accountId: account.id,
      accessTokenCiphertext: ciphertext,
      scopes: input.scopes,
    },
    update: {
      accessTokenCiphertext: ciphertext,
      scopes: input.scopes,
      lastRefreshedAt: new Date(),
    },
  });

  const now = new Date();
  let syncJobsCreated = 0;
  for (const product of input.products) {
    const result = await prisma.syncJob.upsert({
      where: {
        accountId_product: { accountId: account.id, product },
      },
      create: {
        accountId: account.id,
        product,
        status: 'idle',
        priority: 'NORMAL',
        nextRunAt: now,
      },
      update: {
        // If a prior run left the job queued/failed, reset it to idle so it
        // re-runs immediately on the next scheduler tick.
        status: 'idle',
        nextRunAt: now,
        failureCount: 0,
        lastError: null,
      },
    });
    if (result) syncJobsCreated += 1;
  }

  return {
    accountId: account.id,
    created: !existing,
    syncJobsCreated,
  };
}

// ---------- Env dispatch ----------

const IG_PRODUCTS = ['identity', 'audience', 'engagement_new', 'stories'];
const FB_PRODUCTS = ['identity', 'audience', 'engagement_new', 'stories'];

const IG_SCOPES = [
  'instagram_basic',
  'instagram_manage_insights',
  'pages_show_list',
  'pages_read_engagement',
  'business_management',
];

const FB_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
  'business_management',
  // `read_insights` unlocks demographic Page Insights metrics (page_fans_country,
  // page_fans_gender_age, page_fans_city). Without it Meta rejects them with the
  // generic `(#100) The value must be a valid insights metric` error — the same
  // wording it uses for invalid metric names, which is misleading.
  // Confirmed by comparing scopes against Phyllo's OAuth URL.
  'read_insights',
];

// Per-platform default product lists. Must mirror accounts.service.ts
// `PRODUCTS_BY_PLATFORM` — kept here so the seed has zero dependency on
// the Nest module graph. When a new product is added, update both files.
const PRODUCTS_BY_PLATFORM_FOR_BACKFILL: Record<string, string[]> = {
  instagram: ['identity', 'audience', 'engagement_new', 'stories'],
  facebook: [
    'identity',
    'audience',
    'engagement_new',
    'stories',
    'mentions',
    'comments',
    'ratings',
    'ads',
  ],
  tiktok: ['identity', 'audience', 'engagement_new', 'comments'],
  threads: ['identity', 'audience', 'engagement_new', 'comments', 'mentions'],
  youtube: [
    'identity',
    'audience',
    'engagement_new',
    'engagement_deep',
    'comments',
    'ads',
  ],
  // Twitch — see accounts.service.ts PRODUCTS_BY_PLATFORM for rationale.
  twitch: ['identity', 'engagement_new'],
  linkedin: ['identity', 'audience', 'engagement_new', 'comments', 'mentions'],
};

/**
 * Backfill SyncJob rows for accounts that pre-date a product addition.
 * Idempotent — keyed on the (accountId, product) composite unique. Safe to
 * run on every deploy.
 *
 * Bounded by resolveBackfillProducts: only products inside the workspace
 * allow-list AND the account's persisted connection scope
 * (`account.metadata.products`) are ensured. Without this bound the backfill
 * silently resurrected products that an admin or a narrower re-connect had
 * pruned — e.g. a Twitch account scoped to identity-only regained
 * engagement_new on the next deploy.
 */
async function backfillSyncJobs(): Promise<{ created: number; existing: number }> {
  const now = new Date();
  let created = 0;
  let existing = 0;
  const workspaces = await prisma.workspace.findMany({
    select: { id: true, products: true },
  });
  const wsProducts = new Map<string, Record<string, string[]>>(
    workspaces.map((w) => [w.id, (w.products ?? {}) as Record<string, string[]>]),
  );
  const accounts = await prisma.account.findMany({
    select: { id: true, platform: true, workspaceId: true, metadata: true },
  });
  for (const acc of accounts) {
    const catalog = PRODUCTS_BY_PLATFORM_FOR_BACKFILL[acc.platform];
    if (!catalog) continue;
    const allowed = wsProducts.get(acc.workspaceId)?.[acc.platform];
    const metaRaw =
      acc.metadata && typeof acc.metadata === 'object' && !Array.isArray(acc.metadata)
        ? (acc.metadata as Record<string, unknown>)['products']
        : undefined;
    const metaProducts = Array.isArray(metaRaw)
      ? (metaRaw as unknown[]).filter((p): p is string => typeof p === 'string')
      : undefined;
    const products = resolveBackfillProducts(catalog, allowed, metaProducts);
    for (const product of products) {
      const exists = await prisma.syncJob.findUnique({
        where: { accountId_product: { accountId: acc.id, product } },
        select: { id: true },
      });
      if (exists) {
        existing += 1;
        continue;
      }
      await prisma.syncJob.create({
        data: {
          accountId: acc.id,
          product,
          status: 'idle',
          priority: 'NORMAL',
          nextRunAt: now,
        },
      });
      created += 1;
    }
  }
  return { created, existing };
}

async function main(): Promise<void> {
  console.log('[seed] Starting Prisma seed (PoC Day 1)…');

  const cadenceCount = await seedCadences();
  console.log(`[seed] Upserted ${cadenceCount} cadence rows.`);

  const backfill = await backfillSyncJobs();
  console.log(
    `[seed] SyncJob backfill: created ${backfill.created} new, ${backfill.existing} already existed.`,
  );

  const seedPlatform = (process.env.SEED_PLATFORM ?? '').toLowerCase();

  // Instagram — if SEED_IG_TOKEN is set (default when SEED_PLATFORM is unset or 'instagram').
  const igToken = process.env.SEED_IG_TOKEN;
  const igShouldRun =
    igToken && (seedPlatform === '' || seedPlatform === 'instagram');

  if (igShouldRun) {
    const igBusinessId = process.env.SEED_IG_BUSINESS_ID;
    if (!igBusinessId) {
      console.error(
        '[seed] SEED_IG_TOKEN provided but SEED_IG_BUSINESS_ID is missing — skipping IG seed.',
      );
    } else {
      const result = await seedAccount({
        platform: 'instagram',
        canonicalUserId: igBusinessId,
        handle: process.env.SEED_IG_HANDLE,
        token: igToken,
        scopes: IG_SCOPES,
        products: IG_PRODUCTS,
      });
      console.log(
        `[seed] Instagram account id=${result.accountId} (${
          result.created ? 'created' : 'updated'
        }); ${result.syncJobsCreated} sync_jobs upserted (${IG_PRODUCTS.join(', ')}).`,
      );
      if (process.env.SEED_IG_PAGE_ID) {
        console.log(`[seed] IG linked page_id=${process.env.SEED_IG_PAGE_ID}`);
      }
    }
  } else {
    console.log(
      '[seed] SEED_IG_TOKEN not set (or SEED_PLATFORM != instagram) — skipping Instagram account seed.',
    );
  }

  // Facebook — only when SEED_PLATFORM=facebook and SEED_FB_TOKEN present.
  const fbToken = process.env.SEED_FB_TOKEN;
  const fbShouldRun = fbToken && seedPlatform === 'facebook';

  if (fbShouldRun) {
    const fbPageId = process.env.SEED_FB_PAGE_ID;
    if (!fbPageId) {
      console.error(
        '[seed] SEED_FB_TOKEN provided but SEED_FB_PAGE_ID is missing — skipping FB seed.',
      );
    } else {
      const result = await seedAccount({
        platform: 'facebook',
        canonicalUserId: fbPageId,
        handle: process.env.SEED_FB_HANDLE,
        token: fbToken,
        scopes: FB_SCOPES,
        products: FB_PRODUCTS,
      });
      console.log(
        `[seed] Facebook account id=${result.accountId} (${
          result.created ? 'created' : 'updated'
        }); ${result.syncJobsCreated} sync_jobs upserted (${FB_PRODUCTS.join(', ')}).`,
      );
    }
  } else if (seedPlatform === 'facebook') {
    console.log('[seed] SEED_PLATFORM=facebook but SEED_FB_TOKEN missing — skipping FB seed.');
  }

  console.log('[seed] Done.');
}

main()
  .catch((err) => {
    console.error('[seed] Failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
