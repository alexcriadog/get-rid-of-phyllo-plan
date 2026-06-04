// Nest module exposing the Instagram Direct token-refresh service.
// Imported by TokenRefreshCronModule (Task 8). Shared deps (PrismaService,
// AesLocalService) come from Global() modules registered in AppModule.

import { Module } from '@nestjs/common';
import { OutboundWebhooksModule } from '@modules/outbound-webhooks/outbound-webhooks.module';
import { InstagramDirectTokenRefreshService } from './instagram-direct-token-refresh.service';

@Module({
  imports: [OutboundWebhooksModule],
  providers: [InstagramDirectTokenRefreshService],
  exports: [InstagramDirectTokenRefreshService],
})
export class InstagramApiModule {}
