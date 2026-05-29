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
import { V1AccountsController } from './v1-accounts.controller';
import { SnapshotReader } from './snapshot-reader';

/**
 * API surface used by the public UI and the admin dashboard. Relies on
 * the Redis/BullMQ globals from shared modules so we don't have to
 * re-import them here.
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
  controllers: [ManualRefreshController, V1AccountsController],
  providers: [ManualRefreshController, RateLimitInterceptor, V1CacheInterceptor, SnapshotReader],
  exports: [ManualRefreshController],
})
export class ApiModule {}
