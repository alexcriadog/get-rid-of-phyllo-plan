import { Module } from '@nestjs/common';
import { AccountsModule } from '@modules/accounts/accounts.module';
import { ApiModule } from '@modules/api/api.module';
import { SyncModule } from '@modules/sync/sync.module';
import { PlatformsModule } from '@modules/platforms/platforms.module';
import { MetaGraphModule } from '@modules/platforms/shared/meta-graph/meta-graph.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { OauthCallbackController } from './oauth-callback.controller';
import { FacebookExtrasController } from './facebook-extras.controller';
import { WatchlistController } from './watchlist.controller';
import { WatchlistService } from './watchlist.service';
import { ConnectToolGuard } from './connect-tool.guard';

/**
 * Admin surface. Imports from AccountsModule + ApiModule so we can reuse
 * their services (ManualRefreshController for refresh-now, AccountsService
 * for list/get). MetaGraphModule is imported explicitly so AdminService can
 * inject BucTelemetryService for the rate-limit snapshot endpoint — it's
 * not re-exported through PlatformsModule. Redis, Mongo, BullMQ, Metrics
 * are provided globally.
 */
@Module({
  imports: [
    AccountsModule,
    ApiModule,
    SyncModule,
    PlatformsModule,
    MetaGraphModule,
  ],
  controllers: [
    AdminController,
    OauthCallbackController,
    FacebookExtrasController,
    WatchlistController,
  ],
  providers: [AdminService, ConnectToolGuard, WatchlistService],
})
export class AdminModule {}
