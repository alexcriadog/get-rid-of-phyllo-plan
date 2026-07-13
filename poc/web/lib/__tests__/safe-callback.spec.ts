import { describe, expect, it } from 'vitest';
import { safeCallback } from '../safe-callback';

describe('safeCallback', () => {
  it('accepts a same-origin relative path', () => {
    expect(safeCallback('/admin')).toBe('/admin');
    expect(safeCallback('/account/2/posts?x=1')).toBe('/account/2/posts?x=1');
  });
  it('rejects protocol-relative and absolute URLs', () => {
    expect(safeCallback('//evil.com')).toBe('/showroom');
    expect(safeCallback('https://evil.com')).toBe('/showroom');
    expect(safeCallback('http://evil.com')).toBe('/showroom');
  });
  it('rejects non-path junk and empty/undefined', () => {
    expect(safeCallback('javascript:alert(1)')).toBe('/showroom');
    expect(safeCallback('')).toBe('/showroom');
    expect(safeCallback(undefined)).toBe('/showroom');
  });
  it('takes the first value when given an array', () => {
    expect(safeCallback(['/admin', '/x'])).toBe('/admin');
    expect(safeCallback(['//evil.com'])).toBe('/showroom');
  });
});
