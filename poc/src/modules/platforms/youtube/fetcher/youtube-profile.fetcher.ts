// YouTube profile fetcher.
//
// Single Data API call: channels.list(part=snippet,statistics,
// contentDetails,brandingSettings,topicDetails,status, mine=true). Cost: 1
// quota unit.
//
// Side effect: caches the uploads playlist ID into account.metadata so the
// content fetcher can skip its own channels.list lookup. mine=true returns
// the channel the OAuth token belongs to (with brand-account selection
// already resolved server-side at consent time).

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import type { ProfileData } from '../../shared/platform-types';
import type { BoundYoutubeClient } from '../../shared/youtube-api/youtube-client';
import { extractAccountId } from '../../shared/meta-graph';
import { buildYoutubeContext } from '../youtube.context';
import { channelToProfile } from '../mapper/channel-to-profile.mapper';
import { YOUTUBE_API_CLIENT } from '../youtube.tokens';

const PROFILE_PARTS = [
  'snippet',
  'statistics',
  'contentDetails',
  'brandingSettings',
  'topicDetails',
  'status',
];

@Injectable()
export class YoutubeProfileFetcher {
  private readonly logger = new Logger(YoutubeProfileFetcher.name);

  constructor(
    @Inject(YOUTUBE_API_CLIENT)
    private readonly client: BoundYoutubeClient,
    private readonly prisma: PrismaService,
  ) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ProfileData> {
    const accountId = extractAccountId(metadata);
    const ctx = buildYoutubeContext(accessToken, canonicalId, metadata);

    const body = await this.client.listChannels({
      parts: PROFILE_PARTS,
      mine: true,
      accessToken,
      context: ctx,
      accountId,
    });

    const channel = body.items?.[0];
    if (!channel) {
      throw new Error(
        `youtube channels.list returned no items for canonicalId=${canonicalId}`,
      );
    }

    const uploads = channel.contentDetails?.relatedPlaylists?.uploads ?? null;
    if (accountId != null && uploads) {
      await this.cacheUploadsPlaylistId(accountId, uploads).catch((err) => {
        this.logger.warn(
          `failed to cache uploads_playlist_id for account ${accountId.toString()}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }

    return channelToProfile(channel);
  }

  private async cacheUploadsPlaylistId(
    accountId: bigint,
    uploadsPlaylistId: string,
  ): Promise<void> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { metadata: true },
    });
    const existing =
      account?.metadata && typeof account.metadata === 'object'
        ? (account.metadata as Prisma.JsonObject)
        : {};
    if (existing['uploads_playlist_id'] === uploadsPlaylistId) return;
    const next: Prisma.JsonObject = {
      ...existing,
      uploads_playlist_id: uploadsPlaylistId,
    };
    await this.prisma.account.update({
      where: { id: accountId },
      data: { metadata: next as Prisma.InputJsonValue },
    });
  }
}
