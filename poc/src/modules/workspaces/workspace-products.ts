/**
 * Resolve a workspace's product allow-list for one platform.
 * - `[]`    → platform NOT offered by this workspace.
 * - else    → ['identity', ...allowed-and-valid], identity always first.
 *
 * Since the Phase C migration `workspaces.products` is NOT NULL — every
 * workspace has an explicit allow-list — so the legacy `null = no
 * restriction` branch is gone. A workspace that wants the previous
 * "unrestricted" behaviour now stores the full catalog explicitly
 * (the migration backfills pre-existing rows with that exact value).
 */
export function resolveWorkspaceProducts(
  config: Record<string, string[]>,
  platform: string,
  catalog: Record<string, readonly string[]>,
): string[] {
  if (!Object.prototype.hasOwnProperty.call(config, platform)) return [];
  const valid = new Set(catalog[platform] ?? []);
  const picked = (config[platform] ?? []).filter((p) => valid.has(p) && p !== 'identity');
  return ['identity', ...picked];
}
