// Nest module exposing the TikTokClient + token refresh.

import { Module } from '@nestjs/common';
import { TikTokClient } from './tiktok-client';
import { TikTokTokenRefreshService } from './tiktok-token-refresh.service';
import { OutboundWebhooksModule } from '@modules/outbound-webhooks/outbound-webhooks.module';

@Module({
  imports: [OutboundWebhooksModule],
  providers: [TikTokClient, TikTokTokenRefreshService],
  exports: [TikTokClient, TikTokTokenRefreshService],
})
export class TikTokApiModule {}
