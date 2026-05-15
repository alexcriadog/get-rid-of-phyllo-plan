import { Module } from '@nestjs/common';
import { FacebookAdapter } from './facebook/facebook.adapter';
import { FacebookModule } from './facebook/facebook.module';
import { InstagramAdapter } from './instagram/instagram.adapter';
import { InstagramModule } from './instagram/instagram.module';
import { TikTokAdapter } from './tiktok/tiktok.adapter';
import { TikTokModule } from './tiktok/tiktok.module';
import { ThreadsAdapter } from './threads/threads.adapter';
import { ThreadsModule } from './threads/threads.module';
import { TwitchAdapter } from './twitch/twitch.adapter';
import { TwitchModule } from './twitch/twitch.module';
import { YoutubeAdapter } from './youtube/youtube.adapter';
import { YoutubeModule } from './youtube/youtube.module';
import {
  ADAPTER_REGISTRY,
  AdapterRegistry,
} from './shared/platform-adapter.port';

// Re-export the DI token + type so consumers can @Inject from this module path.
export { ADAPTER_REGISTRY };
export type { AdapterRegistry };

/**
 * Central platform registry. Add a new adapter by:
 *   1. Creating the adapter file + module under src/modules/platforms/<name>/.
 *   2. Adding the module to `imports` here.
 *   3. Adding one line to the factory below.
 *
 * Nothing else in the worker, scheduler, admin, or UI needs to change.
 */
@Module({
  imports: [
    InstagramModule,
    FacebookModule,
    TikTokModule,
    ThreadsModule,
    YoutubeModule,
    TwitchModule,
  ],
  providers: [
    {
      provide: ADAPTER_REGISTRY,
      useFactory: (
        ig: InstagramAdapter,
        fb: FacebookAdapter,
        tt: TikTokAdapter,
        th: ThreadsAdapter,
        yt: YoutubeAdapter,
        tw: TwitchAdapter,
      ): AdapterRegistry => ({
        instagram: ig,
        facebook: fb,
        tiktok: tt,
        threads: th,
        youtube: yt,
        twitch: tw,
      }),
      inject: [
        InstagramAdapter,
        FacebookAdapter,
        TikTokAdapter,
        ThreadsAdapter,
        YoutubeAdapter,
        TwitchAdapter,
      ],
    },
  ],
  exports: [
    ADAPTER_REGISTRY,
    InstagramModule,
    FacebookModule,
    TikTokModule,
    ThreadsModule,
    YoutubeModule,
    TwitchModule,
  ],
})
export class PlatformsModule {}
