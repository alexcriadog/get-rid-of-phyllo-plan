// Nest module exposing the YouTube chokepoint client + token refresh service.
// Imported by YoutubeModule. Shared deps (RateBucketService, MongoService,
// MetricsService, PrismaService, AesLocalService, ConfigService) come from
// Global() modules in AppModule.

import { Module } from '@nestjs/common';
import { YoutubeClient } from './youtube-client';
import { YoutubeTokenRefreshService } from './youtube-token-refresh.service';

@Module({
  providers: [YoutubeClient, YoutubeTokenRefreshService],
  exports: [YoutubeClient, YoutubeTokenRefreshService],
})
export class YoutubeApiModule {}
