import { Module } from '@nestjs/common';
import { SharedDatabaseModule } from '@shared/database/database.module';
import { SyncModule } from '@modules/sync/sync.module';
import { PlatformsModule } from '@modules/platforms/platforms.module';
import { ManualRefreshController } from './manual-refresh.controller';

/**
 * API surface used by the public UI and the admin dashboard. Relies on
 * the Redis/BullMQ globals from shared modules so we don't have to
 * re-import them here.
 */
@Module({
  imports: [SharedDatabaseModule, SyncModule, PlatformsModule],
  controllers: [ManualRefreshController],
  providers: [ManualRefreshController],
  exports: [ManualRefreshController],
})
export class ApiModule {}
