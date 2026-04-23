import { Module } from '@nestjs/common';
import { SharedDatabaseModule } from '@shared/database/database.module';
import { WebhooksIngestController } from './webhooks-ingest.controller';

@Module({
  imports: [SharedDatabaseModule],
  controllers: [WebhooksIngestController],
})
export class WebhooksModule {}
