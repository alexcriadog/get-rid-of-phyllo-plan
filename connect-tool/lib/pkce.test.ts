// PKCE (RFC 7636) helpers for providers that mandate it — X today.
// The verifier round-trips via an HttpOnly cookie set at /start and read at
// /callback (app/api/oauth/[...slug]/route.ts).

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { callbackDedupeKey, newPkceVerifier, pkceChallenge } from './pkce';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

describe('newPkceVerifier', () => {
  it('emits a base64url verifier inside the RFC 7636 §4.1 length range', () => {
    const v = newPkceVerifier();
    expect(v).toMatch(BASE64URL);
    // 32 random bytes → 43 base64url chars, within the mandated 43..128.
    expect(v.length).toBe(43);
  });

  it('never repeats a verifier across flows', () => {
    const seen = new Set(Array.from({ length: 50 }, () => newPkceVerifier()));
    expect(seen.size).toBe(50);
  });
});

describe('pkceChallenge', () => {
  it('is the base64url-encoded SHA-256 of the verifier (S256)', () => {
    const verifier = newPkceVerifier();
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(pkceChallenge(verifier)).toBe(expected);
  });

  it('matches the RFC 7636 appendix B reference vector', () => {
    // The spec's worked example — proves our encoding is byte-for-byte the
    // one providers verify against (base64url, no padding).
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('is deterministic and url-safe (no +, / or = padding)', () => {
    const verifier = newPkceVerifier();
    const c = pkceChallenge(verifier);
    expect(c).toBe(pkceChallenge(verifier));
    expect(c).toMatch(BASE64URL);
  });
});

describe('callbackDedupeKey', () => {
  const CODE = 'shared-authorization-code';

  it('still dedupes the duplicate it exists for: same browser, same verifier', () => {
    // Chrome's page-preload fires the callback twice from ONE browser, so
    // both carry the same verifier cookie and must share the entry.
    const v = newPkceVerifier();
    expect(callbackDedupeKey('twitter', CODE, v)).toBe(
      callbackDedupeKey('twitter', CODE, v),
    );
  });

  it('never lets a different verifier reuse another flow’s cached exchange', () => {
    // The security property: a replayed `code` from an attacker who owns a
    // valid state+verifier of their OWN must miss the cache, so the exchange
    // reaches X and X rejects it on verifier mismatch. Sharing the entry
    // would hand them the victim's session.
    const victim = newPkceVerifier();
    const attacker = newPkceVerifier();
    expect(callbackDedupeKey('twitter', CODE, attacker)).not.toBe(
      callbackDedupeKey('twitter', CODE, victim),
    );
  });

  it('keeps the verifier-less key for platforms without PKCE', () => {
    expect(callbackDedupeKey('tiktok', CODE, null)).toBe(`tiktok:${CODE}`);
  });

  it('never collides across platforms sharing a code value', () => {
    expect(callbackDedupeKey('tiktok', CODE, null)).not.toBe(
      callbackDedupeKey('threads', CODE, null),
    );
  });
});
