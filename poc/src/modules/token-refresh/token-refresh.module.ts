import { Module } from '@nestjs/common';
import { OutboundWebhooksModule } from '@modules/outbound-webhooks/outbound-webhooks.module';
import { TikTokApiModule } from '@modules/platforms/shared/tiktok-api/tiktok-api.module';
import { TwitchApiModule } from '@modules/platforms/shared/twitch-api/twitch-api.module';
import { YoutubeApiModule } from '@modules/platforms/shared/youtube-api/youtube-api.module';
import { ThreadsApiModule } from '@modules/platforms/shared/threads-api/threads-api.module';
import { TokenRefreshCronService } from './token-refresh.cron.service';

/**
 * B-1: hosts the proactive token-refresh cron. Prisma / Redis / Aes / Metrics
 * come from the @Global shared modules; we import the 4 platform-api modules
 * for their refresh services and OutboundWebhooksModule for the lifecycle
 * emitter (token.expired). The @Cron only actually fires on the api process
 * (see TokenRefreshCronService.onApplicationBootstrap).
 */
@Module({
  imports: [
    OutboundWebhooksModule,
    TikTokApiModule,
    TwitchApiModule,
    YoutubeApiModule,
    ThreadsApiModule,
  ],
  providers: [TokenRefreshCronService],
  exports: [TokenRefreshCronService],
})
export class TokenRefreshModule {}
