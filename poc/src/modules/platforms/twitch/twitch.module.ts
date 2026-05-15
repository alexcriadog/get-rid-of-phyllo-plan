// Twitch DI wiring. Mirrors youtube.module.ts.
//
// Shared infra deps (Mongo, Redis, Metrics, Prisma, Config, AesLocal) come
// from Global() modules in AppModule. We declare:
//   - the TwitchAdapter facade (exported)
//   - TwitchRateLimitStrategy
//   - the per-product fetchers (profile, content)
//   - a per-platform BoundTwitchClient bound via factory under
//     TWITCH_API_CLIENT, consumed by the fetchers via @Inject.

import { Module } from '@nestjs/common';
import { TwitchApiModule } from '../shared/twitch-api/twitch-api.module';
import { TwitchClient } from '../shared/twitch-api/twitch-client';
import { TwitchAdapter } from './twitch.adapter';
import { TwitchRateLimitStrategy } from './twitch.rate-limit.strategy';
import { TWITCH_API_CLIENT } from './twitch.tokens';
import { TwitchProfileFetcher } from './fetcher/twitch-profile.fetcher';
import { TwitchContentFetcher } from './fetcher/twitch-content.fetcher';

@Module({
  imports: [TwitchApiModule],
  providers: [
    TwitchAdapter,
    TwitchRateLimitStrategy,
    TwitchProfileFetcher,
    TwitchContentFetcher,
    {
      provide: TWITCH_API_CLIENT,
      useFactory: (client: TwitchClient, strategy: TwitchRateLimitStrategy) =>
        client.bind(strategy),
      inject: [TwitchClient, TwitchRateLimitStrategy],
    },
  ],
  exports: [TwitchAdapter, TwitchApiModule],
})
export class TwitchModule {}
