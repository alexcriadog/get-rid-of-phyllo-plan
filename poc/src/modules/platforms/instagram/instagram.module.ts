import { Module } from '@nestjs/common';
import { GraphClient } from '../shared/meta-graph/graph-client';
import { MetaGraphModule } from '../shared/meta-graph/meta-graph.module';
import { InstagramAdapter } from './instagram.adapter';
import { InstagramRateLimitStrategy } from './instagram.rate-limit.strategy';
import { INSTAGRAM_GRAPH_CLIENT } from './instagram.tokens';
import { InstagramProfileFetcher } from './fetcher/instagram-profile.fetcher';
import { InstagramAudienceFetcher } from './fetcher/instagram-audience.fetcher';
import { InstagramContentFetcher } from './fetcher/instagram-content.fetcher';
import { InstagramStoriesFetcher } from './fetcher/instagram-stories.fetcher';

@Module({
  imports: [MetaGraphModule],
  providers: [
    InstagramAdapter,
    InstagramRateLimitStrategy,
    InstagramProfileFetcher,
    InstagramAudienceFetcher,
    InstagramContentFetcher,
    InstagramStoriesFetcher,
    {
      provide: INSTAGRAM_GRAPH_CLIENT,
      useFactory: (client: GraphClient, strategy: InstagramRateLimitStrategy) =>
        client.bind('instagram', strategy),
      inject: [GraphClient, InstagramRateLimitStrategy],
    },
  ],
  exports: [InstagramAdapter],
})
export class InstagramModule {}
