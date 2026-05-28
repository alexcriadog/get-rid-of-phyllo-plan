// Nest module exposing the YouTube chokepoint client + token refresh service.
// Imported by YoutubeModule. Shared deps (RateBucketService, MongoService,
// MetricsService, PrismaService, AesLocalService, ConfigService) come from
// Global() modules in AppModule.

import { Module } from '@nestjs/common';
import { YoutubeClient } from './youtube-client';
import { YoutubeTokenRefreshService } from './youtube-token-refresh.service';
import { OutboundWebhooksModule } from '@modules/outbound-webhooks/outbound-webhooks.module';

@Module({
  imports: [OutboundWebhooksModule],
  providers: [YoutubeClient, YoutubeTokenRefreshService],
  exports: [YoutubeClient, YoutubeTokenRefreshService],
})
export class YoutubeApiModule {}
