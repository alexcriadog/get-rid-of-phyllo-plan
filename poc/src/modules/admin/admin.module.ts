import { Module } from '@nestjs/common';
import { AccountsModule } from '@modules/accounts/accounts.module';
import { ApiModule } from '@modules/api/api.module';
import { SyncModule } from '@modules/sync/sync.module';
import { PlatformsModule } from '@modules/platforms/platforms.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/**
 * Admin surface. Imports from AccountsModule + ApiModule so we can reuse
 * their services (ManualRefreshController for refresh-now, AccountsService
 * for list/get). Redis, Mongo, BullMQ, Metrics are provided globally.
 */
@Module({
  imports: [AccountsModule, ApiModule, SyncModule, PlatformsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
