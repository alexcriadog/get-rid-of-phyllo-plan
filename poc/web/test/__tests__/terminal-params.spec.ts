import { describe, expect, it } from 'vitest';
import { extractQueryParam } from '@/pages/admin';
import { isPanelId } from '@/components/term/panels/registry';

/**
 * Unit tests for the permalink param-parsing helper exported from
 * pages/admin/index.tsx (spec §2.3 object permalinks + Phase 5b ?panel).
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

/**
 * ?panel=<PanelId> permalink parsing (spec §1 cutover). The shell parses the
 * raw query value with extractQueryParam, then validates it against the panel
 * registry via isPanelId — only a known panel id opens. This mirrors the
 * exact expression used in WorkbenchShell's permalink effect.
 */
function parsePanelParam(value: string | string[] | undefined): string | null {
  const raw = extractQueryParam(value);
  return raw && isPanelId(raw) ? raw : null;
}

describe('?panel= permalink parsing', () => {
  it('resolves a known panel id', () => {
    expect(parsePanelParam('live-activity')).toBe('live-activity');
  });

  it('resolves every shipped redirect-target panel id', () => {
    for (const id of [
      'live-activity',
      'raw-inspector',
      'usage',
      'capability-matrix',
      'runtime-settings',
      'vitals',
    ]) {
      expect(parsePanelParam(id)).toBe(id);
    }
  });

  it('resolves the first array element when it is a known panel id', () => {
    expect(parsePanelParam(['vitals', 'usage'])).toBe('vitals');
  });

  it('returns null for an unknown panel id', () => {
    expect(parsePanelParam('not-a-panel')).toBeNull();
  });

  it('returns null when the param is absent', () => {
    expect(parsePanelParam(undefined)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parsePanelParam('')).toBeNull();
  });
});
