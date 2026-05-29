import { normalizeOrigin, normalizeOrigins } from '../workspace-origins';

describe('normalizeOrigin', () => {
  it('canonicalises valid http(s) origins', () => {
    expect(normalizeOrigin('https://App.Example.com')).toBe('https://app.example.com');
    expect(normalizeOrigin('https://app.example.com/')).toBe('https://app.example.com');
    expect(normalizeOrigin('  https://x.io  ')).toBe('https://x.io');
    expect(normalizeOrigin('http://localhost:4000')).toBe('http://localhost:4000');
  });

  it('elides default ports (443/80)', () => {
    expect(normalizeOrigin('https://x.io:443')).toBe('https://x.io');
    expect(normalizeOrigin('http://x.io:80')).toBe('http://x.io');
    expect(normalizeOrigin('https://x.io:8443')).toBe('https://x.io:8443');
  });

  it('rejects anything that is not a bare http(s) origin', () => {
    expect(normalizeOrigin('https://app.example.com/path')).toBeNull();
    expect(normalizeOrigin('https://app.example.com?q=1')).toBeNull();
    expect(normalizeOrigin('https://app.example.com#frag')).toBeNull();
    expect(normalizeOrigin('https://user:pass@x.io')).toBeNull();
    expect(normalizeOrigin('ftp://x.io')).toBeNull();
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull();
    expect(normalizeOrigin('not a url')).toBeNull();
    expect(normalizeOrigin('')).toBeNull();
    expect(normalizeOrigin('   ')).toBeNull();
  });

  it('rejects trailing-dot hostnames (never emitted as a browser origin)', () => {
    expect(normalizeOrigin('https://app.example.com.')).toBeNull();
    expect(normalizeOrigin('http://localhost.')).toBeNull();
  });
});

describe('normalizeOrigins', () => {
  it('canonicalises and de-duplicates a list', () => {
    expect(
      normalizeOrigins(['https://A.io', 'https://a.io/', 'http://localhost:4000']),
    ).toEqual(['https://a.io', 'http://localhost:4000']);
  });

  it('returns an empty array for an empty input', () => {
    expect(normalizeOrigins([])).toEqual([]);
  });

  it('throws with the offending value on the first invalid entry', () => {
    expect(() => normalizeOrigins(['https://ok.io', 'nonsense'])).toThrow(
      /Invalid origin "nonsense"/,
    );
  });
});
