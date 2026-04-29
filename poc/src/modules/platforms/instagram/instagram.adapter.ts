// InstagramAdapter — facade implementing the PlatformAdapter port.
//
// All HTTP, rate-limit, persistence, parsing and Graph quirks live in:
//   - shared/meta-graph/  (chokepoint + utilities)
//   - instagram/fetcher/  (per-product orchestration)
//   - instagram/mapper/   (pure transforms)
//   - instagram.rate-limit.strategy.ts
//   - instagram.support-matrix.ts
//
// This file just wires them together. Phase E.

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
import type { BoundGraphClient } from '../shared/meta-graph/graph-client';
import { InstagramRateLimitStrategy } from './instagram.rate-limit.strategy';
import { INSTAGRAM_SUPPORT_MATRIX } from './instagram.support-matrix';
import { INSTAGRAM_GRAPH_CLIENT } from './instagram.tokens';
import { InstagramProfileFetcher } from './fetcher/instagram-profile.fetcher';
import { InstagramAudienceFetcher } from './fetcher/instagram-audience.fetcher';
import { InstagramContentFetcher } from './fetcher/instagram-content.fetcher';
import { InstagramStoriesFetcher } from './fetcher/instagram-stories.fetcher';

@Injectable()
export class InstagramAdapter implements PlatformAdapter {
  readonly platform = 'instagram';

  constructor(
    @Inject(INSTAGRAM_GRAPH_CLIENT)
    private readonly graphClient: BoundGraphClient,
    private readonly strategy: InstagramRateLimitStrategy,
    private readonly profileFetcher: InstagramProfileFetcher,
    private readonly audienceFetcher: InstagramAudienceFetcher,
    private readonly contentFetcher: InstagramContentFetcher,
    private readonly storiesFetcher: InstagramStoriesFetcher,
  ) {
    void this.graphClient;
  }

  rateLimitHints(context?: PlatformAdapterContext): RateLimitHint[] {
    return this.strategy.hints(context ?? {});
  }

  supportMatrix(): SupportMatrix {
    return INSTAGRAM_SUPPORT_MATRIX;
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

  fetchStories(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    return this.storiesFetcher.fetch(accessToken, canonicalId, metadata);
  }
}
