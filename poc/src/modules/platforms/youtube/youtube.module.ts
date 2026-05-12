// YouTube DI wiring. Mirrors threads.module.ts.
//
// Shared infra deps (Mongo, Redis, Metrics, Prisma, Config, AesLocal) come
// from Global() modules in AppModule. We declare:
//   - the YoutubeAdapter facade (exported)
//   - YoutubeRateLimitStrategy
//   - the per-product fetchers (profile, content, audience, comments)
//   - a per-platform BoundYoutubeClient bound via factory under
//     YOUTUBE_API_CLIENT, consumed by the fetchers via @Inject.

import { Module } from '@nestjs/common';
import { YoutubeApiModule } from '../shared/youtube-api/youtube-api.module';
import { YoutubeClient } from '../shared/youtube-api/youtube-client';
import { GoogleAdsApiModule } from '../shared/google-ads-api/google-ads-api.module';
import { YoutubeAdapter } from './youtube.adapter';
import { YoutubeRateLimitStrategy } from './youtube.rate-limit.strategy';
import { YOUTUBE_API_CLIENT } from './youtube.tokens';
import { YoutubeProfileFetcher } from './fetcher/youtube-profile.fetcher';
import { YoutubeContentFetcher } from './fetcher/youtube-content.fetcher';
import { YoutubeAudienceFetcher } from './fetcher/youtube-audience.fetcher';
import { YoutubeCommentsFetcher } from './fetcher/youtube-comments.fetcher';
import { YoutubeEngagementDeepFetcher } from './fetcher/youtube-engagement-deep.fetcher';
import { YoutubeAdsFetcher } from './fetcher/youtube-ads.fetcher';

@Module({
  imports: [YoutubeApiModule, GoogleAdsApiModule],
  providers: [
    YoutubeAdapter,
    YoutubeRateLimitStrategy,
    YoutubeProfileFetcher,
    YoutubeContentFetcher,
    YoutubeAudienceFetcher,
    YoutubeCommentsFetcher,
    YoutubeEngagementDeepFetcher,
    YoutubeAdsFetcher,
    {
      provide: YOUTUBE_API_CLIENT,
      useFactory: (client: YoutubeClient, strategy: YoutubeRateLimitStrategy) =>
        client.bind(strategy),
      inject: [YoutubeClient, YoutubeRateLimitStrategy],
    },
  ],
  exports: [YoutubeAdapter, YoutubeApiModule],
})
export class YoutubeModule {}
