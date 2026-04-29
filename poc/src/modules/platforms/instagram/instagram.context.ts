// Instagram-specific context builder. Phase E.
// Lifted from InstagramAdapter.context(). For IG the canonical id is the
// IG Business user id, NOT a page id; pageId comes via metadata.page_id
// only when the operator linked an IG account to a Page in seed data.

import type { PlatformAdapterContext } from '../shared/platform-adapter.port';
import { tokenHash } from '../shared/meta-graph';

export function buildInstagramContext(
  accessToken: string,
  metadata?: Record<string, unknown>,
): PlatformAdapterContext {
  return {
    tokenHash: tokenHash(accessToken),
    pageId:
      metadata && typeof metadata['page_id'] === 'string'
        ? (metadata['page_id'] as string)
        : undefined,
  };
}
