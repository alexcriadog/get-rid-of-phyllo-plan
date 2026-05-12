// DI wiring for the Google Ads chokepoint client. Mirrors YoutubeApiModule.
// Shared deps (Mongo, Metrics) come from Global() modules in AppModule.

import { Module } from '@nestjs/common';
import { GoogleAdsClient } from './google-ads-client';

@Module({
  providers: [GoogleAdsClient],
  exports: [GoogleAdsClient],
})
export class GoogleAdsApiModule {}
