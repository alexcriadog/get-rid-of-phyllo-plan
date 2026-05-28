// Nest module exposing the Twitch Helix chokepoint client + token refresh
// service. Imported by TwitchModule. Shared deps (RateBucketService,
// MongoService, MetricsService, PrismaService, AesLocalService,
// ConfigService) come from Global() modules in AppModule.

import { Module } from '@nestjs/common';
import { TwitchClient } from './twitch-client';
import { TwitchTokenRefreshService } from './twitch-token-refresh.service';
import { OutboundWebhooksModule } from '@modules/outbound-webhooks/outbound-webhooks.module';

@Module({
  imports: [OutboundWebhooksModule],
  providers: [TwitchClient, TwitchTokenRefreshService],
  exports: [TwitchClient, TwitchTokenRefreshService],
})
export class TwitchApiModule {}
