// Nest module exposing the Threads chokepoint client.
// Imported by ThreadsModule. Shared deps (RateBucketService, MongoService,
// MetricsService) come from Global() modules registered in AppModule.

import { Module } from '@nestjs/common';
import { ThreadsClient } from './threads-client';
import { ThreadsTokenRefreshService } from './threads-token-refresh.service';
import { MetaGraphModule } from '../meta-graph/meta-graph.module';

@Module({
  imports: [MetaGraphModule],
  providers: [ThreadsClient, ThreadsTokenRefreshService],
  exports: [ThreadsClient, ThreadsTokenRefreshService],
})
export class ThreadsApiModule {}
