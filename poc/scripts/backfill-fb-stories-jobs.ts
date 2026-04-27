/**
 * Backfills the `stories` sync_job for every existing Facebook account.
 *
 * Run after pulling the change that added `'stories'` to FB_PRODUCTS, when
 * you can't (or don't want to) re-run the full seed because SEED_FB_TOKEN
 * isn't around. Idempotent — uses upsert on (accountId, product).
 *
 * Usage:
 *   cd poc && npx ts-node -r tsconfig-paths/register scripts/backfill-fb-stories-jobs.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const accounts = await prisma.account.findMany({
    where: { platform: 'facebook' },
    select: { id: true, handle: true, displayName: true },
  });

  if (accounts.length === 0) {
    console.log('[backfill] No facebook accounts found — nothing to do.');
    return;
  }

  const now = new Date();
  let upserted = 0;

  for (const account of accounts) {
    await prisma.syncJob.upsert({
      where: { accountId_product: { accountId: account.id, product: 'stories' } },
      create: {
        accountId: account.id,
        product: 'stories',
        status: 'idle',
        priority: 'NORMAL',
        nextRunAt: now,
      },
      update: {
        // No-op on rerun: don't reset a job already picked up by the worker.
      },
    });
    upserted += 1;
    console.log(
      `[backfill] account=${account.id.toString()} handle=${
        account.handle ?? account.displayName ?? '—'
      } → ensured stories sync_job`,
    );
  }

  console.log(`[backfill] Done. Ensured stories sync_job for ${upserted} facebook account(s).`);
}

main()
  .catch((err) => {
    console.error('[backfill] Failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
