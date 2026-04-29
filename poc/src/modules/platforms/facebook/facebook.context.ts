// Facebook-specific context builder. Phase C. Lifted from
// FacebookAdapter.context(). Behaviour identical: pageId defaults to
// canonicalId because for FB Pages the OAuth subject ID *is* the page id;
// metadata.page_id can override when an operator seeded the account
// differently.

import type { PlatformAdapterContext } from '../shared/platform-adapter.port';
import { tokenHash } from '../shared/meta-graph';

export function buildFacebookContext(
  accessToken: string,
  canonicalId: string,
  metadata?: Record<string, unknown>,
): PlatformAdapterContext {
  const metaPageId =
    metadata && typeof metadata['page_id'] === 'string'
      ? (metadata['page_id'] as string)
      : undefined;

  return {
    tokenHash: tokenHash(accessToken),
    pageId: metaPageId ?? canonicalId,
  };
}
