// Threads DI wiring. Mirrors facebook.module.ts.
//
// Shared infra deps (Mongo, Redis, Metrics, Prisma, Config) come from the
// Global() modules in AppModule. We declare:
//   - the ThreadsAdapter facade (exported)
//   - ThreadsRateLimitStrategy
//   - the per-product fetchers (profile + audience in Sprint 2; content in
//     Sprint 3; comments/mentions in Sprint 4)
//   - a per-platform BoundThreadsClient bound via factory under
//     THREADS_API_CLIENT, consumed by the fetchers via @Inject.

import { Module } from '@nestjs/common';
import { ThreadsApiModule } from '../shared/threads-api/threads-api.module';
import { ThreadsClient } from '../shared/threads-api/threads-client';
import { ThreadsAdapter } from './threads.adapter';
import { ThreadsRateLimitStrategy } from './threads.rate-limit.strategy';
import { THREADS_API_CLIENT } from './threads.tokens';
import { ThreadsProfileFetcher } from './fetcher/threads-profile.fetcher';
import { ThreadsAudienceFetcher } from './fetcher/threads-audience.fetcher';
import { ThreadsContentFetcher } from './fetcher/threads-content.fetcher';

@Module({
  imports: [ThreadsApiModule],
  providers: [
    ThreadsAdapter,
    ThreadsRateLimitStrategy,
    ThreadsProfileFetcher,
    ThreadsAudienceFetcher,
    ThreadsContentFetcher,
    {
      provide: THREADS_API_CLIENT,
      useFactory: (client: ThreadsClient, strategy: ThreadsRateLimitStrategy) =>
        client.bind(strategy),
      inject: [ThreadsClient, ThreadsRateLimitStrategy],
    },
  ],
  exports: [ThreadsAdapter],
})
export class ThreadsModule {}
