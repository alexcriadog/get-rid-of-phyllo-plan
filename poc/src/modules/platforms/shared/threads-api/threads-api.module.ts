// Nest module exposing the Threads chokepoint client.
// Imported by ThreadsModule. Shared deps (RateBucketService, MongoService,
// MetricsService) come from Global() modules registered in AppModule.

import { Module } from '@nestjs/common';
import { ThreadsClient } from './threads-client';

@Module({
  providers: [ThreadsClient],
  exports: [ThreadsClient],
})
export class ThreadsApiModule {}
