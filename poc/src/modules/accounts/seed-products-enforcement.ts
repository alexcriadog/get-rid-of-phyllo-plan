import { BadRequestException } from '@nestjs/common';

/**
 * Intersect requested products with the workspace's allow-list.
 * - allowed === null → no restriction, return requested unchanged.
 * - allowed === []   → platform not offered → 400.
 * - else → requested ∩ allowed, guaranteeing identity is present.
 */
export function enforceWorkspaceProducts(
  requested: readonly string[],
  allowed: string[] | null,
): string[] {
  if (allowed === null) return [...requested];
  if (allowed.length === 0) {
    throw new BadRequestException('This platform is not enabled for this workspace.');
  }
  const allowSet = new Set(allowed);
  const trimmed = requested.filter((p) => allowSet.has(p));
  if (!trimmed.includes('identity') && allowSet.has('identity')) trimmed.unshift('identity');
  return trimmed.length > 0 ? trimmed : ['identity'];
}
