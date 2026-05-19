import { Module } from '@nestjs/common';
import { SharedDatabaseModule } from '@shared/database/database.module';
import { SyncModule } from '@modules/sync/sync.module';
import { PlatformsModule } from '@modules/platforms/platforms.module';
import { AccountsModule } from '@modules/accounts/accounts.module';
import { ApiKeysModule } from '@modules/api-keys/api-keys.module';
import { ManualRefreshController } from './manual-refresh.controller';
import { V1AccountsController } from './v1-accounts.controller';

/**
 * API surface used by the public UI and the admin dashboard. Relies on
 * the Redis/BullMQ globals from shared modules so we don't have to
 * re-import them here.
 */
@Module({
  imports: [
    SharedDatabaseModule,
    SyncModule,
    PlatformsModule,
    AccountsModule,
    ApiKeysModule,
  ],
  controllers: [ManualRefreshController, V1AccountsController],
  providers: [ManualRefreshController],
  exports: [ManualRefreshController],
})
export class ApiModule {}
