// One-shot seed for a TikTok Business account via the account-holder
// OAuth flow tokens. Inserts/upserts:
//   - accounts row (canonical_user_id = open_id, metadata.business_id = open_id)
//   - oauth_tokens row (encrypted with AesLocalService)
//   - sync_jobs rows (5: identity, audience, engagement_new, comments, mentions)
// Usage:
//   ts-node scripts/seed-tiktok-account.ts <open_id> <access_token> <refresh_token> <handle> <display_name> <expires_at_iso>

import { PrismaClient } from '@prisma/client';
import * as crypto from 'node:crypto';

const KEY_HEX = process.env.LOCAL_AES_KEY ?? '';
if (!KEY_HEX || KEY_HEX.length !== 64) {
  console.error('LOCAL_AES_KEY env not set or wrong length (expect 64 hex chars).');
  process.exit(2);
}
const KEY = Buffer.from(KEY_HEX, 'hex');

function encrypt(plain: string): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

async function main() {
  const [, , openId, accessToken, refreshToken, handle, displayName, expiresAtIso] = process.argv;
  if (!openId || !accessToken || !refreshToken || !handle || !displayName || !expiresAtIso) {
    console.error(
      'usage: ts-node scripts/seed-tiktok-account.ts <open_id> <access_token> <refresh_token> <handle> <display_name> <expires_at_iso>',
    );
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    const account = await prisma.account.upsert({
      where: { platform_canonicalUserId: { platform: 'tiktok', canonicalUserId: openId } },
      create: {
        platform: 'tiktok',
        canonicalUserId: openId,
        handle,
        displayName,
        status: 'ready',
        syncTier: 'standard',
        metadata: { business_id: openId },
      },
      update: {
        handle,
        displayName,
        status: 'ready',
        metadata: { business_id: openId },
      },
    });
    console.log(`account_id=${account.id} platform=tiktok handle=${handle}`);

    await prisma.oAuthToken.upsert({
      where: { accountId: account.id },
      create: {
        accountId: account.id,
        accessTokenCiphertext: encrypt(accessToken),
        refreshTokenCiphertext: encrypt(refreshToken),
        scopes: [],
        expiresAt: new Date(expiresAtIso),
        lastRefreshedAt: new Date(),
      },
      update: {
        accessTokenCiphertext: encrypt(accessToken),
        refreshTokenCiphertext: encrypt(refreshToken),
        expiresAt: new Date(expiresAtIso),
        lastRefreshedAt: new Date(),
      },
    });
    console.log('oauth_token rows upserted (encrypted)');

    // Seed sync_jobs at "very-far-future" nextRunAt so scheduler doesn't pick them up
    // until WE explicitly trigger via manual enqueue.
    const FAR_FUTURE = new Date('2099-01-01T00:00:00Z');
    for (const product of ['identity', 'audience', 'engagement_new', 'comments', 'mentions']) {
      await prisma.syncJob.upsert({
        where: { accountId_product: { accountId: account.id, product } },
        create: {
          accountId: account.id,
          product,
          status: 'idle',
          priority: 'NORMAL',
          nextRunAt: FAR_FUTURE,
        },
        update: { status: 'idle', nextRunAt: FAR_FUTURE },
      });
      console.log(`sync_job ${product}: idle, nextRunAt=2099 (manual-only)`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
