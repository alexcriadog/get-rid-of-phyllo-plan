// OAuth 1.0a signing (RFC 5849 §3.4) — used only by the X "Sign in with
// Twitter" flow, where identity (user_id + screen_name) comes back in the
// access-token response for free, no metered /2/users/me read.
//
// The signature is verified against base strings constructed BY HAND for
// simple inputs (each step is checkable), with the HMAC computed
// independently here — so a bug in ordering, percent-encoding, or the
// double-encoding of the param string is caught without relying on a
// memorized external vector.

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { percentEncode, oauth1aSignature } from './oauth1a';

// Independent HMAC-SHA1 over a hand-built base string (secrets here need no
// encoding, so the signing key is just `${cs}&${ts}`).
function hmac(baseString: string, consumerSecret: string, tokenSecret: string): string {
  return createHmac('sha1', `${consumerSecret}&${tokenSecret}`)
    .update(baseString)
    .digest('base64');
}

describe('percentEncode (RFC 3986)', () => {
  it('escapes the sub-delims encodeURIComponent leaves alone', () => {
    expect(percentEncode("!*'()")).toBe('%21%2A%27%28%29');
  });
  it('leaves unreserved chars untouched', () => {
    expect(percentEncode('aZ0-_.~')).toBe('aZ0-_.~');
  });
  it('encodes a space as %20, never +', () => {
    expect(percentEncode('a b')).toBe('a%20b');
  });
});

describe('oauth1aSignature', () => {
  it('builds the RFC 5849 base string (sorted params) and signs it', () => {
    // params intentionally out of order to prove they get sorted.
    const sig = oauth1aSignature(
      'POST',
      'https://api.example.com/x',
      { b: '2', a: '1' },
      'cs',
      'ts',
    );
    // sorted -> a=1&b=2 ; url and param-string each percent-encoded, joined by &
    const base = 'POST&https%3A%2F%2Fapi.example.com%2Fx&a%3D1%26b%3D2';
    expect(sig).toBe(hmac(base, 'cs', 'ts'));
  });

  it('double-encodes a space in a param value (the classic 1.0a gotcha)', () => {
    const sig = oauth1aSignature(
      'POST',
      'https://api.example.com/x',
      { status: 'a b' },
      'cs',
      'ts',
    );
    // value 'a b' -> 'a%20b' in the param string -> 'status%3Da%2520b' in the base
    const base = 'POST&https%3A%2F%2Fapi.example.com%2Fx&status%3Da%2520b';
    expect(sig).toBe(hmac(base, 'cs', 'ts'));
  });

  it('signs the request-token step (no token secret yet)', () => {
    const sig = oauth1aSignature(
      'POST',
      'https://api.twitter.com/oauth/request_token',
      { oauth_callback: 'https://example.com/cb', oauth_consumer_key: 'k' },
      'secret',
      '',
    );
    const base =
      'POST&https%3A%2F%2Fapi.twitter.com%2Foauth%2Frequest_token&' +
      // oauth_callback value 'https://example.com/cb' -> percent-encoded in
      // param string, then the whole param string percent-encoded again.
      'oauth_callback%3Dhttps%253A%252F%252Fexample.com%252Fcb%26oauth_consumer_key%3Dk';
    expect(sig).toBe(hmac(base, 'secret', ''));
  });

  it('is deterministic for identical inputs', () => {
    const args = ['GET', 'https://a.co/b', { x: '1' }, 'c', 'd'] as const;
    expect(oauth1aSignature(...args)).toBe(oauth1aSignature(...args));
  });
});
