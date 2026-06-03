import { BadRequestException } from '@nestjs/common';

const IDENTITY = 'identity';

/**
 * Validate + normalise a client-requested per-connection product scope against
 * the workspace's allow-list (the ceiling). Used at SDK-token mint time so the
 * scope baked into the signed JWT can never exceed what the workspace permits.
 *
 * For each platform key in `requested`:
 *   - the platform MUST be offered by the workspace (a key in
 *     `workspaceProducts`) — else 400.
 *   - every requested product MUST be within the workspace allow-list for that
 *     platform — else 400 (the client is trying to widen past the ceiling).
 *   - `identity` is always injected first (it is required on every platform and
 *     the workspace allow-list always contains it post-Phase-C). An empty list
 *     therefore yields `['identity']` — the "basic, nothing else" connection.
 *
 * Returns the normalised map (identity-first, de-duped, request key order).
 * Platforms the client did NOT list are absent from the result — the connection
 * inherits the full workspace allow-list for those (the connect-tool consumer
 * merges this scope over the workspace config).
 */
export function buildConnectionProductScope(
  requested: Record<string, string[]>,
  workspaceProducts: Record<string, string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [platform, products] of Object.entries(requested)) {
    const allowed = workspaceProducts[platform];
    if (!allowed) {
      throw new BadRequestException(
        `Product scope references platform "${platform}" which is not enabled for this workspace`,
      );
    }
    const allowSet = new Set(allowed);
    const picked: string[] = [];
    for (const p of products) {
      if (p === IDENTITY) continue;
      if (!allowSet.has(p)) {
        throw new BadRequestException(
          `Product "${p}" is not enabled for platform "${platform}" in this workspace`,
        );
      }
      if (!picked.includes(p)) picked.push(p);
    }
    out[platform] = [IDENTITY, ...picked];
  }
  return out;
}
