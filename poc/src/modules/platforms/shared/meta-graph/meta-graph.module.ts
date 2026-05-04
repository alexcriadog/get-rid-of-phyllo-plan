// Nest module exposing the unified Meta GraphClient. Phase B3.
// Imported by FB / IG modules; future Threads module will too. Shared deps
// (RateBucketService, MongoService, MetricsService) come from Global()
// modules registered in AppModule, so we only declare GraphClient here.

import { Module } from '@nestjs/common';
import { GraphClient } from './graph-client';
import { BucTelemetryService } from './buc-telemetry.service';

@Module({
  providers: [GraphClient, BucTelemetryService],
  exports: [GraphClient, BucTelemetryService],
})
export class MetaGraphModule {}
