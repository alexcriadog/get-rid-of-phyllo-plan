import { resolveWorkspaceProducts } from '../workspace-products';

const CATALOG = {
  instagram: ['identity', 'audience', 'engagement_new', 'stories'],
  facebook: ['identity', 'audience', 'ads'],
} as Record<string, readonly string[]>;

describe('resolveWorkspaceProducts', () => {
  it('returns [] when the platform is not offered by the workspace', () => {
    expect(resolveWorkspaceProducts({ facebook: ['ads'] }, 'instagram', CATALOG)).toEqual([]);
  });
  it('returns [] for an empty allow-list (no platforms offered)', () => {
    expect(resolveWorkspaceProducts({}, 'instagram', CATALOG)).toEqual([]);
  });
  it('always includes identity and filters to the platform catalog', () => {
    expect(
      resolveWorkspaceProducts({ instagram: ['audience', 'bogus', 'ads'] }, 'instagram', CATALOG),
    ).toEqual(['identity', 'audience']);
  });
  it('identity-only when the platform is offered with an empty list', () => {
    expect(resolveWorkspaceProducts({ tiktok: [] }, 'tiktok', { tiktok: ['identity', 'audience'] })).toEqual(['identity']);
  });
});
