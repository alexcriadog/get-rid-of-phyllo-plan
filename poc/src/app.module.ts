import { Module } from '@nestjs/common';
import { AppConfigModule } from '@shared/config/config.module';
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

@Module({
  imports: [
    AppConfigModule,
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
    SyncModule,
    ApiModule,
    WebhooksModule,
  ],
})
export class AppModule {}
