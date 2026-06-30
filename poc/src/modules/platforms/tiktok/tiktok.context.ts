// TikTok context builder (v1.3 flow).

import type { PlatformAdapterContext } from '../shared/platform-adapter.port';
import { extractBusinessId, tokenHash } from '../shared/tiktok-api';

export function buildTikTokContext(
  accessToken: string,
  canonicalId: string,
  metadata?: Record<string, unknown>,
): PlatformAdapterContext & { businessId: string } {
  return {
    tokenHash: tokenHash(accessToken),
    // canonicalId is the TikTok open_id (app-scoped, stable across this user's
    // tokens) — used as the per-user daily rate-bucket key. Same semantic role
    // as YouTube/Twitch/LinkedIn channelId.
    channelId: canonicalId,
    businessId: extractBusinessId(metadata),
  };
}
