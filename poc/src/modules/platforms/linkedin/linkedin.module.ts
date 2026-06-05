// LinkedIn DI wiring. Mirrors twitch.module.ts.
//
// Shared infra deps (Mongo, Redis, Metrics, Prisma, Config, AesLocal) come
// from Global() modules in AppModule. We declare:
//   - the LinkedInAdapter facade (exported)
//   - LinkedInRateLimitStrategy
//   - the per-product fetchers (profile, audience, content)
//   - a per-platform BoundLinkedInClient bound via factory under
//     LINKEDIN_API_CLIENT, consumed by the fetchers via @Inject.

import { Module } from '@nestjs/common';
import { LinkedInApiModule } from '../shared/linkedin-api/linkedin-api.module';
import { LinkedInClient } from '../shared/linkedin-api/linkedin-client';
import { LinkedInAdapter } from './linkedin.adapter';
import { LinkedInRateLimitStrategy } from './linkedin.rate-limit.strategy';
import { LINKEDIN_API_CLIENT } from './linkedin.tokens';
import { LinkedInProfileFetcher } from './fetcher/linkedin-profile.fetcher';
import { LinkedInAudienceFetcher } from './fetcher/linkedin-audience.fetcher';
import { LinkedInContentFetcher } from './fetcher/linkedin-content.fetcher';
import { LinkedInCommentsFetcher } from './fetcher/linkedin-comments.fetcher';
import { LinkedInMentionsFetcher } from './fetcher/linkedin-mentions.fetcher';

@Module({
  imports: [LinkedInApiModule],
  providers: [
    LinkedInAdapter,
    LinkedInRateLimitStrategy,
    LinkedInProfileFetcher,
    LinkedInAudienceFetcher,
    LinkedInContentFetcher,
    LinkedInCommentsFetcher,
    LinkedInMentionsFetcher,
    {
      provide: LINKEDIN_API_CLIENT,
      useFactory: (client: LinkedInClient, strategy: LinkedInRateLimitStrategy) =>
        client.bind(strategy),
      inject: [LinkedInClient, LinkedInRateLimitStrategy],
    },
  ],
  exports: [LinkedInAdapter, LinkedInApiModule],
})
export class LinkedInModule {}
