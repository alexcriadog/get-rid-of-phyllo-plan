// Twitch-specific request-context builder.
//
// For Twitch the canonicalId IS the broadcaster_id (the numeric user_id
// Helix returns from /users). metadata.broadcaster_id may override when an
// operator re-seeded with explicit context (matches the YouTube pattern with
// metadata.channel_id).

import type { PlatformAdapterContext } from '../shared/platform-adapter.port';
import { tokenHash } from '../shared/meta-graph';

export function buildTwitchContext(
  accessToken: string,
  canonicalId: string,
  metadata?: Record<string, unknown>,
): PlatformAdapterContext {
  const metaBroadcasterId =
    metadata && typeof metadata['broadcaster_id'] === 'string'
      ? (metadata['broadcaster_id'] as string)
      : undefined;

  return {
    tokenHash: tokenHash(accessToken),
    // We re-use `channelId` as the per-request identifier the rate bucket
    // can key on. Same semantic role as YouTube's channelId.
    channelId: metaBroadcasterId ?? canonicalId,
  };
}
