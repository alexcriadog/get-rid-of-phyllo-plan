// IG-direct ("Instagram API with Instagram Login") helpers.
//
// Accounts connected through the direct flow carry metadata.oauth_flow =
// 'ig_direct' (set by connect-tool's instagram_direct PlatformDef). Their
// tokens only work against graph.instagram.com — graph.facebook.com rejects
// them — and, unlike FB-login Meta tokens, they ARE refreshable
// (grant_type=ig_refresh_token, see InstagramDirectTokenRefreshService).

export const IG_DIRECT_GRAPH_BASE = 'https://graph.instagram.com/v22.0';

export function isIgDirect(
  metadata?: Record<string, unknown> | null,
): boolean {
  return !!metadata && metadata['oauth_flow'] === 'ig_direct';
}
