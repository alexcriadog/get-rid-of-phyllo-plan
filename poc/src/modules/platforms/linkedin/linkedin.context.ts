// LinkedIn request-context builder. canonicalId is the person id (member
// rows) or org id (organization rows). channelId keys the per-account rate
// bucket dimension, same semantic role as YouTube's channelId.

import type { PlatformAdapterContext } from '../shared/platform-adapter.port';
import { tokenHash } from '../shared/meta-graph';

export function buildLinkedInContext(
  accessToken: string,
  canonicalId: string,
): PlatformAdapterContext {
  return {
    tokenHash: tokenHash(accessToken),
    channelId: canonicalId,
  };
}

/** Account kind discriminator persisted by the connect-tool seed. */
export function linkedInKind(
  metadata: Record<string, unknown> | undefined,
): 'member' | 'organization' {
  return metadata?.['kind'] === 'organization' ? 'organization' : 'member';
}

/** urn:li:organization:{id} — prefer the seeded URN, fall back to canonicalId. */
export function organizationUrn(
  canonicalId: string,
  metadata: Record<string, unknown> | undefined,
): string {
  const fromMeta = metadata?.['organization_urn'];
  return typeof fromMeta === 'string' && fromMeta.length > 0
    ? fromMeta
    : `urn:li:organization:${canonicalId}`;
}
