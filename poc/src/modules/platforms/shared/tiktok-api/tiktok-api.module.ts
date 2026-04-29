// Nest module exposing the TikTokClient. F1.

import { Module } from '@nestjs/common';
import { TikTokClient } from './tiktok-client';

@Module({
  providers: [TikTokClient],
  exports: [TikTokClient],
})
export class TikTokApiModule {}
