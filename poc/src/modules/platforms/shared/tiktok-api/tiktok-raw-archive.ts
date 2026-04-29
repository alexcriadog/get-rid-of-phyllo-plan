// MongoDB raw_platform_responses writer for TikTok v1.3.

import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { MongoService, MONGO_COLLECTIONS } from '@shared/database/mongo.service';

const logger = new Logger('TikTokRawArchive');

export async function persistRaw(
  mongo: MongoService,
  body: unknown,
  endpoint: string,
  accountId: bigint | null,
  httpStatus: number,
  tikTokCode: number | null,
): Promise<void> {
  try {
    const serialized = JSON.stringify(body);
    const hash = createHash('sha256').update(serialized).digest('hex');
    const col = mongo.getCollection(MONGO_COLLECTIONS.rawPlatformResponses);
    await col.insertOne({
      accountId: accountId ? accountId.toString() : null,
      platform: 'tiktok',
      endpoint,
      s3uri_stub: null,
      contentHash: hash,
      sizeBytes: Buffer.byteLength(serialized, 'utf8'),
      httpStatus,
      tikTokCode,
      fetchedAt: new Date(),
      body,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`raw_platform_responses write failed: ${msg}`);
  }
}
