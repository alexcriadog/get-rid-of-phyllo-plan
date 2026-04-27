/**
 * Forces the FB stories sync_job to run on the next scheduler tick.
 * Sets nextRunAt = now and clears any failure backoff so the scheduler
 * picks it up within ~30s. Idempotent.
 *
 * Usage:
 *   cd poc && npx ts-node -r tsconfig-paths/register scripts/force-fb-stories-now.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const result = await prisma.syncJob.updateMany({
    where: { product: 'stories', account: { platform: 'facebook' } },
    data: {
      status: 'idle',
      nextRunAt: new Date(),
      failureCount: 0,
      lastError: null,
    },
  });
  console.log(`[force] Reset ${result.count} FB stories sync_job(s) to nextRunAt=now.`);
}

main()
  .catch((err) => {
    console.error('[force] Failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
