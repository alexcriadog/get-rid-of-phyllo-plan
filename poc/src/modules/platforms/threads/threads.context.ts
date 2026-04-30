// Threads-specific request-context builder. Mirrors facebook.context.ts.
// For Threads the OAuth subject ID *is* the user id (`/me` resolves to the
// connected Threads user), so canonicalId doubles as pageId for rate-bucket
// scoping. metadata.user_id can override when an operator seeded the account
// differently.

import type { PlatformAdapterContext } from '../shared/platform-adapter.port';
import { tokenHash } from '../shared/meta-graph';

export function buildThreadsContext(
  accessToken: string,
  canonicalId: string,
  metadata?: Record<string, unknown>,
): PlatformAdapterContext {
  const metaUserId =
    metadata && typeof metadata['user_id'] === 'string'
      ? (metadata['user_id'] as string)
      : undefined;

  return {
    tokenHash: tokenHash(accessToken),
    pageId: metaUserId ?? canonicalId,
  };
}
