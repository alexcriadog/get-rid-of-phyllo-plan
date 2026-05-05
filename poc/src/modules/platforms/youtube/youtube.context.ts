// YouTube-specific request-context builder.
//
// For YouTube the canonicalId is the channel id (UC...). We also stash a
// truncated token hash so per-user rate-limit buckets (qps_analytics_user)
// have a stable key. metadata.channel_id can override when an operator
// re-seeded with explicit context.

import type { PlatformAdapterContext } from '../shared/platform-adapter.port';
import { tokenHash } from '../shared/meta-graph';

export function buildYoutubeContext(
  accessToken: string,
  canonicalId: string,
  metadata?: Record<string, unknown>,
): PlatformAdapterContext {
  const metaChannelId =
    metadata && typeof metadata['channel_id'] === 'string'
      ? (metadata['channel_id'] as string)
      : undefined;

  return {
    tokenHash: tokenHash(accessToken),
    channelId: metaChannelId ?? canonicalId,
  };
}
