import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { InternalAuthGuard } from '@shared/auth/internal-auth.guard';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule } from '@shared/config/config.module';
import { PlatformErrorFilter } from '@/common/filters/platform-error.filter';
import { SharedDatabaseModule } from '@shared/database/database.module';
import { SharedMongoModule } from '@shared/database/mongo.module';
import { SharedCryptoModule } from '@shared/crypto/crypto.module';
import { SharedRedisModule } from '@shared/redis/redis.module';
import { SharedMetricsModule } from '@shared/metrics/metrics.module';
import { AccountsModule } from '@modules/accounts/accounts.module';
import { AdminModule } from '@modules/admin/admin.module';
import { PlatformsModule } from '@modules/platforms/platforms.module';
import { SyncModule } from '@modules/sync/sync.module';
import { ApiModule } from '@modules/api/api.module';
import { WebhooksModule } from '@modules/webhooks/webhooks.module';
import { WorkspacesModule } from '@modules/workspaces/workspaces.module';
import { ApiKeysModule } from '@modules/api-keys/api-keys.module';
import { SdkTokensModule } from '@modules/sdk-tokens/sdk-tokens.module';
import { OutboundWebhooksModule } from '@modules/outbound-webhooks/outbound-webhooks.module';
import { AdminSaasModule } from '@modules/admin-saas/admin-saas.module';
import { TokenRefreshModule } from '@modules/token-refresh/token-refresh.module';
import { DataApiModule } from '@modules/data-api/data-api.module';

@Module({
  imports: [
    AppConfigModule,
    // Enable @Cron decorators throughout the app. Currently used by
    // WebhooksModule for retention sweeps (webhooks-retention.service.ts).
    ScheduleModule.forRoot(),
    SharedDatabaseModule,
    SharedMongoModule,
    SharedCryptoModule,
    SharedRedisModule,
    SharedMetricsModule,
    PlatformsModule,
    WorkspacesModule,
    ApiKeysModule,
    SdkTokensModule,
    OutboundWebhooksModule,
    AccountsModule,
    AdminModule,
    AdminSaasModule,
    SyncModule,
    ApiModule,
    WebhooksModule,
    TokenRefreshModule,
    DataApiModule,
  ],
  providers: [
    {
      // Global filter — catches platform-adapter exceptions thrown anywhere
      // in the request pipeline (live /v1/* fetches, manual refresh, admin
      // discover, etc.) and surfaces them as proper 401 / 502 / 503.
      provide: APP_FILTER,
      useClass: PlatformErrorFilter,
    },
    {
      // Global guard — enforces the connect-tool service bearer on every
      // /internal/* route (no-op on all other paths). See InternalAuthGuard.
      provide: APP_GUARD,
      useClass: InternalAuthGuard,
    },
  ],
})
export class AppModule {}
