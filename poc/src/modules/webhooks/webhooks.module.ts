import { Module } from '@nestjs/common';
import { SharedDatabaseModule } from '@shared/database/database.module';
import { SharedRedisModule } from '@shared/redis/redis.module';
import { WebhooksIngestController } from './webhooks-ingest.controller';
import { WebhooksRetentionService } from './webhooks-retention.service';

@Module({
  imports: [SharedDatabaseModule, SharedRedisModule],
  controllers: [WebhooksIngestController],
  providers: [WebhooksRetentionService],
})
export class WebhooksModule {}
