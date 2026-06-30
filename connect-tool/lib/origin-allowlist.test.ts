import { describe, it, expect } from 'vitest';
import {
  normalizeOrigin,
  isOriginAllowed,
  isOriginAllowedStrict,
  shouldRequireAllowList,
} from './origin-allowlist';

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

describe('isOriginAllowedStrict (fail-closed)', () => {
  it('DENIES when no allow-list is configured (opposite of the lenient default)', () => {
    expect(isOriginAllowedStrict('https://anything.com', undefined)).toBe(false);
    expect(isOriginAllowedStrict('https://anything.com', [])).toBe(false);
    expect(isOriginAllowedStrict(undefined, undefined)).toBe(false);
  });

  it('enforces membership like the lenient form once a list is present', () => {
    const list = ['https://app.example.com'];
    expect(isOriginAllowedStrict('https://app.example.com', list)).toBe(true);
    expect(isOriginAllowedStrict('https://evil.com', list)).toBe(false);
    expect(isOriginAllowedStrict(undefined, list)).toBe(false);
  });
});

describe('shouldRequireAllowList', () => {
  it('requires a configured allow-list in production', () => {
    expect(shouldRequireAllowList({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(
      true,
    );
  });
  it('stays lenient outside production (dev keeps working without origins)', () => {
    expect(
      shouldRequireAllowList({ NODE_ENV: 'development' } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(shouldRequireAllowList({} as NodeJS.ProcessEnv)).toBe(false);
  });
});
