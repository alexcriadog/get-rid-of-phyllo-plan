import { Module } from '@nestjs/common';
import { SharedDatabaseModule } from '@shared/database/database.module';
import { SharedRedisModule } from '@shared/redis/redis.module';
import { AccountsModule } from '@modules/accounts/accounts.module';
import { WebhooksIngestController } from './webhooks-ingest.controller';
import { WebhooksIngestThreadsController } from './webhooks-ingest-threads.controller';
import { WebhooksIngestTikTokController } from './webhooks-ingest-tiktok.controller';
import { WebhooksRetentionService } from './webhooks-retention.service';
import { InboundWebhookLogService } from './inbound-webhook-log.service';

@Module({
  imports: [SharedDatabaseModule, SharedRedisModule, AccountsModule],
  controllers: [
    WebhooksIngestController,
    WebhooksIngestThreadsController,
    WebhooksIngestTikTokController,
  ],
  providers: [WebhooksRetentionService, InboundWebhookLogService],
})
export class WebhooksModule {}
