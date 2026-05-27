import { enforceWorkspaceProducts } from '../seed-products-enforcement';

describe('enforceWorkspaceProducts', () => {
  it('passes products through unchanged when there is no workspace restriction (null)', () => {
    expect(enforceWorkspaceProducts(['identity', 'audience', 'ads'], null)).toEqual(['identity', 'audience', 'ads']);
  });
  it('trims requested products to the allow-list', () => {
    expect(enforceWorkspaceProducts(['identity', 'audience', 'ads'], ['identity', 'audience'])).toEqual(['identity', 'audience']);
  });
  it('falls back to identity-only when the intersection is empty but identity is allowed', () => {
    expect(enforceWorkspaceProducts(['audience'], ['identity'])).toEqual(['identity']);
  });
  it('throws when the platform is not offered (allow-list is empty array)', () => {
    expect(() => enforceWorkspaceProducts(['identity'], [])).toThrow();
  });
});
