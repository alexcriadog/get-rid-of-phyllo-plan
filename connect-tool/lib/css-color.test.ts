import { describe, it, expect } from 'vitest';
import { sanitizeAccent } from './css-color';

describe('sanitizeAccent', () => {
  it('accepts valid hex colours (#rgb, #rgba, #rrggbb, #rrggbbaa)', () => {
    expect(sanitizeAccent('#fff')).toBe('#fff');
    expect(sanitizeAccent('#9146ff')).toBe('#9146ff');
    expect(sanitizeAccent('#11223344')).toBe('#11223344');
    expect(sanitizeAccent('#abcd')).toBe('#abcd');
    expect(sanitizeAccent('  #9146FF  ')).toBe('#9146FF'); // trims
  });

  it('rejects CSS-injection payloads', () => {
    expect(sanitizeAccent('red;background:url(//evil/x)')).toBeNull();
    expect(sanitizeAccent('#fff;--x:url(//evil)')).toBeNull();
    expect(sanitizeAccent('rgb(1,2,3)')).toBeNull();
    expect(sanitizeAccent('url(//evil)')).toBeNull();
    expect(sanitizeAccent('expression(alert(1))')).toBeNull();
  });

  it('rejects malformed hex and non-strings', () => {
    expect(sanitizeAccent('#12')).toBeNull(); // too short
    expect(sanitizeAccent('#12345')).toBeNull(); // 5 digits
    expect(sanitizeAccent('9146ff')).toBeNull(); // missing #
    expect(sanitizeAccent('#gggggg')).toBeNull(); // non-hex
    expect(sanitizeAccent('')).toBeNull();
    expect(sanitizeAccent(null)).toBeNull();
    expect(sanitizeAccent(undefined)).toBeNull();
  });
});
