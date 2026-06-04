// Nest module exposing the LinkedIn chokepoint client + token refresh
// service. Imported by LinkedInModule + TokenRefreshModule. Shared deps
// (RateBucketService, MongoService, MetricsService, PrismaService,
// AesLocalService, ConfigService) come from Global() modules in AppModule;
// OutboundWebhooksModule provides the TokenLifecycleEmitter the refresh
// service emits token.refreshed / token.expired through.

import { Module } from '@nestjs/common';
import { OutboundWebhooksModule } from '@modules/outbound-webhooks/outbound-webhooks.module';
import { LinkedInClient } from './linkedin-client';
import { LinkedInTokenRefreshService } from './linkedin-token-refresh.service';

@Module({
  imports: [OutboundWebhooksModule],
  providers: [LinkedInClient, LinkedInTokenRefreshService],
  exports: [LinkedInClient, LinkedInTokenRefreshService],
})
export class LinkedInApiModule {}
