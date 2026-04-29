// TikTok mentions fetcher. F3-pivot. PROBE PENDING.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ContentData, FetchOpts } from '../../shared/platform-types';
import type { BoundTikTokClient } from '../../shared/tiktok-api';
import { buildTikTokContext } from '../tiktok.context';
import { TIKTOK_API_CLIENT } from '../tiktok.tokens';

@Injectable()
export class TikTokMentionsFetcher {
  private readonly logger = new Logger(TikTokMentionsFetcher.name);

  constructor(
    @Inject(TIKTOK_API_CLIENT) private readonly client: BoundTikTokClient,
  ) {
    void this.client;
  }

  async fetch(
    accessToken: string,
    _canonicalId: string,
    _opts: FetchOpts,
    metadata?: Record<string, unknown>,
  ): Promise<ContentData[]> {
    void buildTikTokContext(accessToken, metadata);
    this.logger.debug('TikTok mentions endpoint not yet probed — returning []');
    return [];
  }
}
