// ThreadsAdapter — facade implementing the PlatformAdapter port.
//
// Sprint 2 ships profile + audience. Sprint 3 adds the content fetcher (and
// post mapper) and Sprint 4 adds replies/comments + mentions. Each capability
// is wired in here as it lands; the worker only ever sees this facade.
//
// All HTTP, rate-limit, persistence, parsing live in:
//   - shared/threads-api/  (chokepoint + types)
//   - threads/fetcher/     (per-product orchestration)
//   - threads/mapper/      (pure transforms)
//   - threads.rate-limit.strategy.ts
//   - threads.support-matrix.ts

import { Inject, Injectable } from '@nestjs/common';
import type { RateLimitHint } from '@shared/redis/rate-bucket.service';
import {
  PlatformAdapter,
  PlatformAdapterContext,
} from '../shared/platform-adapter.port';
import type {
  AudienceData,
  ContentData,
  FetchOpts,
  ProfileData,
  SupportMatrix,
} from '../shared/platform-types';
import type { BoundThreadsClient } from '../shared/threads-api/threads-client';
import { ThreadsRateLimitStrategy } from './threads.rate-limit.strategy';
import { THREADS_SUPPORT_MATRIX } from './threads.support-matrix';
import { THREADS_API_CLIENT } from './threads.tokens';
import { ThreadsProfileFetcher } from './fetcher/threads-profile.fetcher';
import { ThreadsAudienceFetcher } from './fetcher/threads-audience.fetcher';
import { ThreadsContentFetcher } from './fetcher/threads-content.fetcher';

@Injectable()
export class ThreadsAdapter implements PlatformAdapter {
  readonly platform = 'threads';

  constructor(
    @Inject(THREADS_API_CLIENT)
    private readonly threadsClient: BoundThreadsClient,
    private readonly strategy: ThreadsRateLimitStrategy,
    private readonly profileFetcher: ThreadsProfileFetcher,
    private readonly audienceFetcher: ThreadsAudienceFetcher,
    private readonly contentFetcher: ThreadsContentFetcher,
  ) {
    // threadsClient is held so BoundThreadsClient stays alive in the DI
    // container alongside the fetchers (they consume it under the same
    // THREADS_API_CLIENT token).
    void this.threadsClient;
  }

  rateLimitHints(context?: PlatformAdapterContext): RateLimitHint[] {
    return this.strategy.hints(context ?? {});
  }

  supportMatrix(): SupportMatrix {
    return THREADS_SUPPORT_MATRIX;
  }

  fetchProfile(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ProfileData> {
    return this.profileFetcher.fetch(accessToken, canonicalId, metadata);
  }

  fetchAudience(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AudienceData> {
    return this.audienceFetcher.fetch(accessToken, canonicalId, metadata);
  }

  fetchContents(
    accessToken: string,
    canonicalId: string,
    opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    return this.contentFetcher.fetch(accessToken, canonicalId, opts, metadata);
  }

  // Sprint 4 adds fetchComments + fetchMentions wiring.
}
