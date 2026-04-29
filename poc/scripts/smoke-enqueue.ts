// One-shot BullMQ enqueue for the post-refactor smoke test.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';

const NS = process.env.REDIS_NS || 'connector-poc';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function main() {
  const accountId = BigInt(process.argv[2]);
  const product = process.argv[3];
  if (!accountId || !product) {
    console.error('usage: ts-node scripts/smoke-enqueue.ts <accountId> <product>');
    process.exit(2);
  }

  const prisma = new PrismaClient();
  const syncJob = await prisma.syncJob.findUniqueOrThrow({
    where: { accountId_product: { accountId, product } },
    select: { id: true },
  });

  const conn = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue('sync', { connection: conn, prefix: `${NS}:bullmq` });

  const payload = {
    jobId: syncJob.id.toString(),
    accountId: accountId.toString(),
    product,
  };

  const job = await queue.add('sync', payload, { priority: 1 });
  console.log(`enqueued bullmq job ${job.id} payload=${JSON.stringify(payload)}`);

  await queue.close();
  await conn.quit();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
