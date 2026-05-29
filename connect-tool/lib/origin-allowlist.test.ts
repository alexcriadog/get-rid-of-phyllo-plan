import { describe, it, expect } from 'vitest';
import { normalizeOrigin, isOriginAllowed } from './origin-allowlist';

describe('normalizeOrigin', () => {
  it('canonicalises valid http(s) origins', () => {
    expect(normalizeOrigin('https://App.Example.com')).toBe('https://app.example.com');
    expect(normalizeOrigin('https://app.example.com/')).toBe('https://app.example.com');
    expect(normalizeOrigin('  http://localhost:4000  ')).toBe('http://localhost:4000');
    expect(normalizeOrigin('https://x.io:443')).toBe('https://x.io');
  });

  it('rejects non-origins and junk', () => {
    expect(normalizeOrigin('https://app.example.com/path')).toBeNull();
    expect(normalizeOrigin('https://app.example.com?q=1')).toBeNull();
    expect(normalizeOrigin('ftp://x.io')).toBeNull();
    expect(normalizeOrigin('not a url')).toBeNull();
    expect(normalizeOrigin('')).toBeNull();
    expect(normalizeOrigin(null)).toBeNull();
    expect(normalizeOrigin(undefined)).toBeNull();
    expect(normalizeOrigin('https://app.example.com.')).toBeNull();
  });
});

describe('isOriginAllowed', () => {
  it('allows any origin when no allow-list is configured (backward-compat)', () => {
    expect(isOriginAllowed('https://anything.com', undefined)).toBe(true);
    expect(isOriginAllowed('https://anything.com', [])).toBe(true);
    expect(isOriginAllowed(undefined, undefined)).toBe(true);
  });

  it('enforces membership when an allow-list is present', () => {
    const list = ['http://localhost:4000', 'https://app.example.com'];
    expect(isOriginAllowed('http://localhost:4000', list)).toBe(true);
    expect(isOriginAllowed('https://app.example.com', list)).toBe(true);
    expect(isOriginAllowed('https://evil.com', list)).toBe(false);
    expect(isOriginAllowed(undefined, list)).toBe(false);
    expect(isOriginAllowed('', list)).toBe(false);
  });

  it('compares canonically (case/port/trailing-slash insensitive)', () => {
    expect(isOriginAllowed('HTTP://LOCALHOST:4000', ['http://localhost:4000'])).toBe(true);
    expect(isOriginAllowed('https://app.example.com/', ['https://app.example.com'])).toBe(true);
    expect(isOriginAllowed('https://app.example.com:443', ['https://app.example.com'])).toBe(true);
  });

  it('does not allow a path-bearing origin to slip past membership', () => {
    expect(isOriginAllowed('https://app.example.com/evil', ['https://app.example.com'])).toBe(false);
  });
});
