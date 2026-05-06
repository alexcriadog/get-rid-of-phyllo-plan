import { Module } from '@nestjs/common';
import { GraphClient } from '../shared/meta-graph/graph-client';
import { MetaGraphModule } from '../shared/meta-graph/meta-graph.module';
import { FacebookAdapter } from './facebook.adapter';
import { FacebookRateLimitStrategy } from './facebook.rate-limit.strategy';
import { FACEBOOK_GRAPH_CLIENT } from './facebook.tokens';
import { FacebookProfileFetcher } from './fetcher/facebook-profile.fetcher';
import { FacebookAudienceFetcher } from './fetcher/facebook-audience.fetcher';
import { FacebookContentFetcher } from './fetcher/facebook-content.fetcher';
import { FacebookStoriesFetcher } from './fetcher/facebook-stories.fetcher';
import { FacebookMentionsFetcher } from './fetcher/facebook-mentions.fetcher';
import { FacebookCommentsFetcher } from './fetcher/facebook-comments.fetcher';
import { FacebookExtrasService } from './fetcher/facebook-extras.service';

/**
 * Facebook DI wiring. Shared infra deps (Mongo, Redis, Metrics, Prisma,
 * Config) come from the Global() modules in AppModule. We declare:
 *   - the FacebookAdapter facade (exported)
 *   - FacebookRateLimitStrategy
 *   - the 4 product fetchers
 *   - a per-platform BoundGraphClient bound via factory under
 *     FACEBOOK_GRAPH_CLIENT, consumed by the fetchers via @Inject.
 */
@Module({
  imports: [MetaGraphModule],
  providers: [
    FacebookAdapter,
    FacebookRateLimitStrategy,
    FacebookProfileFetcher,
    FacebookAudienceFetcher,
    FacebookContentFetcher,
    FacebookStoriesFetcher,
    FacebookMentionsFetcher,
    FacebookCommentsFetcher,
    FacebookExtrasService,
    {
      provide: FACEBOOK_GRAPH_CLIENT,
      useFactory: (client: GraphClient, strategy: FacebookRateLimitStrategy) =>
        client.bind('facebook', strategy),
      inject: [GraphClient, FacebookRateLimitStrategy],
    },
  ],
  exports: [FacebookAdapter, FacebookExtrasService],
})
export class FacebookModule {}
