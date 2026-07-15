// PKCE (RFC 7636) — required by providers that mandate proof-of-possession
// on the authorization-code flow. X is the only one today; the OAuth
// dispatcher applies it to any PlatformDef that declares `pkce: true`.
//
// The verifier is minted at /start and rides an HttpOnly SameSite=Lax cookie
// across the provider round-trip; only its S256 challenge travels on the
// authorize URL. See app/api/oauth/[...slug]/route.ts.

import { createHash, randomBytes } from 'node:crypto';

/**
 * RFC 7636 §4.1 code verifier: 43 base64url chars (32 random bytes), inside
 * the mandated 43..128 range.
 */
export function newPkceVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** RFC 7636 §4.2 S256 challenge: base64url(SHA-256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Key for the dispatcher's in-flight callback dedupe cache.
 *
 * Folding the verifier in is a security property, not a detail: the cache
 * returns the FIRST caller's exchange to anyone whose key matches, so a
 * `(platform, code)` key would serve a victim's result to an attacker who
 * replays their `code` carrying a verifier of their own — the code-injection
 * PKCE exists to prevent, bypassed before the verifier ever reaches the
 * provider. Pass `null` for platforms that don't use PKCE.
 */
export function callbackDedupeKey(
  platform: string,
  code: string,
  verifier: string | null,
): string {
  return verifier === null
    ? `${platform}:${code}`
    : `${platform}:${code}:${verifier}`;
}
