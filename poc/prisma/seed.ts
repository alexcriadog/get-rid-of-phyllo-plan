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

/** Encrypts plaintext -> `iv(12) || ciphertext || authTag(16)` as Bytes. */
function encryptToken(plaintext: string): Buffer {
  const key = getAesKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]);
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

  const existing = await prisma.account.findUnique({
    where: {
      platform_canonicalUserId: {
        platform: input.platform,
        canonicalUserId: input.canonicalUserId,
      },
    },
  });

  const account = await prisma.account.upsert({
    where: {
      platform_canonicalUserId: {
        platform: input.platform,
        canonicalUserId: input.canonicalUserId,
      },
    },
    create: {
      platform: input.platform,
      canonicalUserId: input.canonicalUserId,
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
const FB_PRODUCTS = ['identity', 'audience', 'engagement_new'];

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
];

async function main(): Promise<void> {
  console.log('[seed] Starting Prisma seed (PoC Day 1)…');

  const cadenceCount = await seedCadences();
  console.log(`[seed] Upserted ${cadenceCount} cadence rows.`);

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
