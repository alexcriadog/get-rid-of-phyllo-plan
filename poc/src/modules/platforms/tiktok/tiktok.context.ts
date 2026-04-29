// TikTok context builder (v1.3 flow).

import type { PlatformAdapterContext } from '../shared/platform-adapter.port';
import { extractBusinessId, tokenHash } from '../shared/tiktok-api';

export function buildTikTokContext(
  accessToken: string,
  metadata?: Record<string, unknown>,
): PlatformAdapterContext & { businessId: string } {
  return {
    tokenHash: tokenHash(accessToken),
    businessId: extractBusinessId(metadata),
  };
}
