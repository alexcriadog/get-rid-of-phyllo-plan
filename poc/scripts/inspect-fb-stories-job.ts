/**
 * Diagnostic: prints the current state of the FB stories sync_job row.
 *
 * Usage:
 *   cd poc && npx ts-node -r tsconfig-paths/register scripts/inspect-fb-stories-job.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const now = new Date();
  const row = await prisma.syncJob.findFirst({
    where: { product: 'stories', account: { platform: 'facebook' } },
    select: {
      id: true,
      accountId: true,
      product: true,
      status: true,
      priority: true,
      lastSuccessAt: true,
      lastAttemptAt: true,
      nextRunAt: true,
      failureCount: true,
      lastError: true,
      updatedAt: true,
      account: { select: { handle: true, platform: true, syncTier: true, status: true } },
    },
  });

  console.log('--- FB stories sync_job ---');
  console.log(`now (host clock):  ${now.toISOString()}`);
  console.log(JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));

  if (row?.nextRunAt) {
    const dueInMs = row.nextRunAt.getTime() - now.getTime();
    console.log(
      `nextRunAt vs now:  ${
        dueInMs >= 0
          ? `due in ${Math.round(dueInMs / 1000)}s`
          : `overdue by ${Math.round(-dueInMs / 1000)}s`
      }`,
    );
  }
}

main()
  .catch((err) => {
    console.error('[inspect] Failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
