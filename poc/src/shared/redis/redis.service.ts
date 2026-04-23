import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import { AppConfigService } from '@shared/config/config.module';

const DEFAULT_NS = 'connector-poc';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private clientInstance: Redis | null = null;
  private namespace: string = DEFAULT_NS;

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    const url = this.config.getOrThrow<string>('REDIS_URL');
    this.namespace = this.config.get<string>('REDIS_NS', DEFAULT_NS) ?? DEFAULT_NS;

    const options: RedisOptions = {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
      // BullMQ v5 requires maxRetriesPerRequest=null on the shared connection.
    };

    this.clientInstance = new Redis(url, options);

    this.clientInstance.on('error', (err) => {
      this.logger.error(`Redis error: ${err.message}`);
    });
    this.clientInstance.on('connect', () => {
      this.logger.log(`Redis connected (ns=${this.namespace})`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.clientInstance) {
      await this.clientInstance.quit().catch(() => {
        /* ignore quit errors on shutdown */
      });
      this.clientInstance = null;
      this.logger.log('Redis disconnected');
    }
  }

  get client(): Redis {
    if (!this.clientInstance) {
      throw new Error('Redis not initialised');
    }
    return this.clientInstance;
  }

  /**
   * Produce a fully-qualified Redis key prefixed with the configured
   * namespace. Parts are joined with ':'.
   *
   * @example
   *   key('rate', 'ig', 'app') → 'connector-poc:rate:ig:app'
   */
  key(...parts: string[]): string {
    if (parts.length === 0) {
      throw new Error('key() requires at least one part');
    }
    return [this.namespace, ...parts].join(':');
  }

  get ns(): string {
    return this.namespace;
  }
}
