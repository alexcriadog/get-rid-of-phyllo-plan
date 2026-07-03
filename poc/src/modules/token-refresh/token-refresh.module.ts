import { Module } from '@nestjs/common';
import { OutboundWebhooksModule } from '@modules/outbound-webhooks/outbound-webhooks.module';
import { PlatformsModule } from '@modules/platforms/platforms.module';
import { TikTokApiModule } from '@modules/platforms/shared/tiktok-api/tiktok-api.module';
import { TwitchApiModule } from '@modules/platforms/shared/twitch-api/twitch-api.module';
import { YoutubeApiModule } from '@modules/platforms/shared/youtube-api/youtube-api.module';
import { ThreadsApiModule } from '@modules/platforms/shared/threads-api/threads-api.module';
import { InstagramApiModule } from '@modules/platforms/shared/instagram-api/instagram-api.module';
import { LinkedInApiModule } from '@modules/platforms/shared/linkedin-api/linkedin-api.module';
import { TokenRefreshCronService } from './token-refresh.cron.service';
import { TokenHealthCronService } from './token-health.cron.service';
import { TokenCanaryCronService } from './token-canary.cron.service';

/**
 * B-1: hosts the proactive token-refresh cron. Prisma / Redis / Aes / Metrics
 * come from the @Global shared modules; we import the 4 platform-api modules
 * for their refresh services and OutboundWebhooksModule for the lifecycle
 * emitter (token.expired). The @Cron only actually fires on the api process
 * (see TokenRefreshCronService.onApplicationBootstrap).
 *
 * Also hosts TokenHealthCronService — the daily `data_access_expires_at`
 * sweep (C-Token lifecycle hygiene). Exported so AdminController can serve
 * GET /admin/token-health from its snapshot.
 *
 * Also hosts TokenCanaryCronService — the daily selective liveness probe +
 * needs_reauth self-heal. Needs PlatformsModule for its exported
 * ADAPTER_REGISTRY (the full per-platform adapter map with fetchProfile),
 * distinct from the narrower *ApiModule clients used by the refresh cron.
 */
@Module({
  imports: [
    OutboundWebhooksModule,
    PlatformsModule,
    TikTokApiModule,
    TwitchApiModule,
    YoutubeApiModule,
    ThreadsApiModule,
    InstagramApiModule,
    LinkedInApiModule,
  ],
  providers: [TokenRefreshCronService, TokenHealthCronService, TokenCanaryCronService],
  exports: [TokenRefreshCronService, TokenHealthCronService, TokenCanaryCronService],
})
export class TokenRefreshModule {}
