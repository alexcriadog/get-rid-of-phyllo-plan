import { describe, expect, it } from 'vitest';
import { extractQueryParam } from '@/pages/admin/terminal';

/**
 * Unit tests for the permalink param-parsing helper exported from
 * pages/admin/terminal.tsx (spec §2.3 object permalinks).
 *
 * Placed outside pages/ so Next.js does not treat it as a route.
 */
describe('extractQueryParam', () => {
  it('returns a string value when param is a plain string', () => {
    expect(extractQueryParam('acme')).toBe('acme');
  });

  it('returns the first element when param is an array', () => {
    expect(extractQueryParam(['first', 'second'])).toBe('first');
  });

  it('returns null when param is undefined', () => {
    expect(extractQueryParam(undefined)).toBeNull();
  });

  it('returns null when param is an empty string', () => {
    expect(extractQueryParam('')).toBeNull();
  });

  it('returns null when param is an empty array', () => {
    expect(extractQueryParam([])).toBeNull();
  });

  it('returns null when the first array element is an empty string', () => {
    expect(extractQueryParam([''])).toBeNull();
  });

  it('preserves the exact value including hyphens and uuid-shaped ids', () => {
    expect(extractQueryParam('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });

  it('handles a workspace slug value', () => {
    expect(extractQueryParam('my-workspace')).toBe('my-workspace');
  });
});
