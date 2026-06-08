import { Module } from '@nestjs/common';
import { SharedDatabaseModule } from '@shared/database/database.module';
import { SharedRedisModule } from '@shared/redis/redis.module';
import { SyncModule } from '@modules/sync/sync.module';
import { PlatformsModule } from '@modules/platforms/platforms.module';
import { AccountsModule } from '@modules/accounts/accounts.module';
import { ApiKeysModule } from '@modules/api-keys/api-keys.module';
import { RateLimitInterceptor } from '@/common/interceptors/rate-limit.interceptor';
import { V1CacheInterceptor } from '@/common/interceptors/cache.interceptor';
import { ManualRefreshController } from './manual-refresh.controller';

/**
 * Internal API surface: the manual-refresh trigger used by the dashboard. The
 * public data read API (InsightIQ-standard, /v1/*) now lives in
 * `@modules/data-api`; the old custom-shape /v1 read controller was removed
 * when the canonical format became the only served format.
 */
@Module({
  imports: [
    SharedDatabaseModule,
    SharedRedisModule,
    SyncModule,
    PlatformsModule,
    AccountsModule,
    ApiKeysModule,
  ],
  controllers: [ManualRefreshController],
  providers: [ManualRefreshController, RateLimitInterceptor, V1CacheInterceptor],
  exports: [ManualRefreshController],
})
export class ApiModule {}
