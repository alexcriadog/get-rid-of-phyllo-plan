// TikTok DI wiring. F3.

import { Module } from '@nestjs/common';
import { TikTokApiModule, TikTokClient } from '../shared/tiktok-api';
import { TikTokAdapter } from './tiktok.adapter';
import { TikTokRateLimitStrategy } from './tiktok.rate-limit.strategy';
import { TIKTOK_API_CLIENT } from './tiktok.tokens';
import { TikTokProfileFetcher } from './fetcher/tiktok-profile.fetcher';
import { TikTokAudienceFetcher } from './fetcher/tiktok-audience.fetcher';
import { TikTokContentFetcher } from './fetcher/tiktok-content.fetcher';
import { TikTokCommentsFetcher } from './fetcher/tiktok-comments.fetcher';
import { TikTokMentionsFetcher } from './fetcher/tiktok-mentions.fetcher';

@Module({
  imports: [TikTokApiModule],
  providers: [
    TikTokAdapter,
    TikTokRateLimitStrategy,
    TikTokProfileFetcher,
    TikTokAudienceFetcher,
    TikTokContentFetcher,
    TikTokCommentsFetcher,
    TikTokMentionsFetcher,
    {
      provide: TIKTOK_API_CLIENT,
      useFactory: (client: TikTokClient, strategy: TikTokRateLimitStrategy) =>
        client.bind(strategy),
      inject: [TikTokClient, TikTokRateLimitStrategy],
    },
  ],
  exports: [TikTokAdapter],
})
export class TikTokModule {}
