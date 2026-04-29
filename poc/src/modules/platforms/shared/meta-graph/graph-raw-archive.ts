// Mongo `raw_platform_responses` writer. Phase A6 of the platform refactor.
// See docs/platform-refactor.md §7 + §8.1 (intentional fixes D1, D4).
//
// Behaviour:
//   - Always persists, including 4xx/5xx responses (D1 fix — FB previously
//     skipped error bodies because its callGraph wrote AFTER the status
//     check; the new GraphClient calls this BEFORE the status throws).
//   - Always includes `httpStatus` (D4 fix — was IG-only).
//   - Failures are non-fatal: persistence errors log a warning and return
//     normally so a downstream Mongo blip never breaks a sync.

import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { MongoService, MONGO_COLLECTIONS } from '@shared/database/mongo.service';

const logger = new Logger('GraphRawArchive');

export async function persistRaw(
  mongo: MongoService,
  platform: string,
  body: unknown,
  endpoint: string,
  accountId: bigint | null,
  httpStatus = 200,
): Promise<void> {
  try {
    const serialized = JSON.stringify(body);
    const hash = createHash('sha256').update(serialized).digest('hex');
    const col = mongo.getCollection(MONGO_COLLECTIONS.rawPlatformResponses);
    await col.insertOne({
      accountId: accountId ? accountId.toString() : null,
      platform,
      endpoint,
      s3uri_stub: null,
      contentHash: hash,
      sizeBytes: Buffer.byteLength(serialized, 'utf8'),
      httpStatus,
      fetchedAt: new Date(),
      body,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`raw_platform_responses write failed: ${msg}`);
  }
}
