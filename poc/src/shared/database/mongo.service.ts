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
    this.client = new MongoClient(url, {
      serverSelectionTimeoutMS: 5000,
      monitorCommands: false,
    });
    await this.client.connect();

    const dbName = this.extractDbName(url) ?? DEFAULT_DB_NAME;
    this.database = this.client.db(dbName);

    this.logger.log(`Mongo connected (db=${dbName})`);
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
