/**
 * Resolve a workspace's product allow-list for one platform.
 * - `null`  → no restriction; caller uses the full platform catalog.
 * - `[]`    → platform NOT offered by this workspace.
 * - else    → ['identity', ...allowed-and-valid], identity always first.
 */
export function resolveWorkspaceProducts(
  config: Record<string, string[]> | null | undefined,
  platform: string,
  catalog: Record<string, readonly string[]>,
): string[] | null {
  if (config == null) return null;
  if (!Object.prototype.hasOwnProperty.call(config, platform)) return [];
  const valid = new Set(catalog[platform] ?? []);
  const picked = (config[platform] ?? []).filter((p) => valid.has(p) && p !== 'identity');
  return ['identity', ...picked];
}
