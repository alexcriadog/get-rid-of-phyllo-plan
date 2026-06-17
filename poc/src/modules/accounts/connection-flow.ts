import { isIgDirect } from '@modules/platforms/shared/meta-graph/ig-direct';

/**
 * Connection-flow discriminator persisted on `accounts.connection_flow` and
 * carried in the account uniqueness key
 * `(workspace, platform, canonical_user_id, connection_flow)`.
 *
 * It exists so the SAME canonical Instagram identity can coexist as two
 * separate accounts instead of the second connect overwriting the first:
 *   - 'ig_direct' — Instagram API with Instagram Login (graph.instagram.com,
 *                   refreshable ig_refresh_token, no Page involved)
 *   - 'fb_login'  — Instagram reached via Facebook Login (Page token)
 *
 * Every other platform — and Facebook itself — has a single connection per
 * canonical id, so it always resolves to 'default' and the uniqueness key
 * behaves exactly as it did before (one row per canonical id).
 */
export const CONNECTION_FLOW_DEFAULT = 'default';
export const CONNECTION_FLOW_IG_DIRECT = 'ig_direct';
export const CONNECTION_FLOW_IG_VIA_FB = 'fb_login';

export function connectionFlowFor(
  platform: string,
  metadata?: Record<string, unknown> | null,
): string {
  if (platform !== 'instagram') return CONNECTION_FLOW_DEFAULT;
  return isIgDirect(metadata)
    ? CONNECTION_FLOW_IG_DIRECT
    : CONNECTION_FLOW_IG_VIA_FB;
}
