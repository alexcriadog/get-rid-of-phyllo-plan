import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Collection, Db, Document, MongoClient } from 'mongodb';
import { AppConfigService } from '@shared/config/config.module';

/**
 * Mongo collections used by the PoC. Centralised here so all adapters /
 * workers import from a single source of truth.
 */
export const MONGO_COLLECTIONS = {
  posts: 'posts',
  audienceSnapshots: 'audience_snapshots',
  identitySnapshots: 'identity_snapshots',
  rawPlatformResponses: 'raw_platform_responses',
  eventLog: 'event_log',
  bucketHistorySnapshots: 'bucket_history_snapshots',
  // CA-only Meta extras (pages_read_user_content / ads_read / PPCA)
  pageRatings: 'page_ratings',
  pageComments: 'page_comments',
  adInsights: 'ad_insights',
  publicPageSnapshots: 'public_page_snapshots',
} as const;

export type MongoCollectionKey = keyof typeof MONGO_COLLECTIONS;

const DEFAULT_DB_NAME = 'connector_ui';

@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MongoService.name);
  private client!: MongoClient;
  private database!: Db;

  constructor(private readonly config: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.getOrThrow<string>('MONGO_URL');
    // Bound the per-process connection pool (Week 3). The driver default is
    // 100/process — across api + worker + scheduler that's 300 potential
    // Mongo connections. 20/process (overridable) is ample for our query
    // volume and keeps the total well within a single-node Mongo's limits.
    const maxPoolSize = Number(process.env.MONGO_MAX_POOL_SIZE) || 20;
    this.client = new MongoClient(url, {
      serverSelectionTimeoutMS: 5000,
      monitorCommands: false,
      maxPoolSize,
    });
    await this.client.connect();

    const dbName = this.extractDbName(url) ?? DEFAULT_DB_NAME;
    this.database = this.client.db(dbName);

    this.logger.log(`Mongo connected (db=${dbName})`);

    await this.ensureIndexes();
  }

  /**
   * Create the indexes the sync worker + /v1 read path rely on.
   * Idempotent — createIndex is a no-op when the index already exists.
   *
   * Without these every upsert (keyed by account_id + a platform id) and
   * every /v1 snapshot read is a collection scan, which degrades silently
   * as the collections grow into the millions of documents.
   *
   * Snapshot collections store exactly one doc per (account[,platform]) by
   * design, so a unique index is safe. The list collections (posts,
   * comments, page_ratings) could in theory hold pre-existing duplicates,
   * so their lookup index is created NON-unique to guarantee the boot
   * never fails on legacy data; a unique constraint there is a follow-up
   * that needs a dedup pass first.
   */
  private async ensureIndexes(): Promise<void> {
    const specs: Array<{
      collection: string;
      keys: Record<string, 1 | -1>;
      options?: { unique?: boolean };
    }> = [
      // ── list collections (upsert key non-unique; read by recency) ──
      { collection: 'posts', keys: { account_id: 1, platform_content_id: 1 } },
      { collection: 'posts', keys: { account_id: 1, updated_at: -1 } },
      { collection: 'comments', keys: { account_id: 1, platform_comment_id: 1 } },
      { collection: 'comments', keys: { account_id: 1, updated_at: -1 } },
      { collection: 'page_ratings', keys: { account_id: 1, platform_review_id: 1 } },
      { collection: 'page_ratings', keys: { account_id: 1, updated_at: -1 } },
      { collection: 'ad_insights', keys: { account_id: 1, ad_account_id: 1 } },
      // ── snapshot collections (one doc per account[,platform]) ──
      { collection: 'identity_snapshots', keys: { account_id: 1 }, options: { unique: true } },
      { collection: 'audience_snapshots', keys: { account_id: 1 }, options: { unique: true } },
      { collection: 'engagement_deep_snapshots', keys: { account_id: 1, platform: 1 }, options: { unique: true } },
      { collection: 'ads_campaigns', keys: { account_id: 1, platform: 1 }, options: { unique: true } },
      // ── append-only logs (read/purged by recency) ──
      { collection: 'event_log', keys: { account_id: 1, emitted_at: -1 } },
      // raw_platform_responses writers (graph/tiktok raw-archive) store
      // camelCase accountId + fetchedAt — match them so the recency purge
      // (webhooks-retention) and admin listing are index-backed.
      { collection: 'raw_platform_responses', keys: { accountId: 1, fetchedAt: -1 } },
    ];

    let created = 0;
    for (const spec of specs) {
      try {
        await this.database
          .collection(spec.collection)
          .createIndex(spec.keys, spec.options ?? {});
        created += 1;
      } catch (err) {
        // A unique index can fail if legacy data already holds duplicates.
        // Log and continue — a missing index degrades performance but must
        // never block startup.
        this.logger.warn(
          `Index ensure failed for ${spec.collection} ${JSON.stringify(spec.keys)}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    this.logger.log(`Mongo indexes ensured (${created}/${specs.length})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.logger.log('Mongo disconnected');
    }
  }

  getDb(): Db {
    if (!this.database) {
      throw new Error('Mongo not initialised');
    }
    return this.database;
  }

  getCollection<T extends Document = Document>(name: string): Collection<T> {
    return this.getDb().collection<T>(name);
  }

  /**
   * Extract the database name from a Mongo connection URL. Falls back to
   * undefined when no path segment is present (caller supplies default).
   */
  private extractDbName(url: string): string | undefined {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.replace(/^\//, '');
      return path.length > 0 ? path : undefined;
    } catch {
      return undefined;
    }
  }
}
