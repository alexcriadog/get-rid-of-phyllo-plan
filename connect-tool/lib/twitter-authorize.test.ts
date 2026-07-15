// X (Twitter) authorize-URL construction. X is our only PKCE-mandatory
// provider and our only login-only platform, so both invariants are pinned
// here: the S256 challenge must reach the consent screen, and the flow must
// refuse to start without one (a PKCE-less authorize URL would be rejected
// by X at exchange time, after the user already logged in).
//
// Only buildAuthorizeUrl is exercised — it's pure. handleCallback talks to
// api.x.com and is covered by a live connect, not by unit tests.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PLATFORMS } from './platforms';

const REDIRECT = 'https://connect.example.com/api/oauth/callback/twitter';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

function authorizeUrl(scopes: string[] = ['users.read', 'tweet.read']): URL {
  return new URL(
    PLATFORMS.twitter.buildAuthorizeUrl(REDIRECT, scopes, {
      challenge: CHALLENGE,
    }),
  );
}

describe('twitter.buildAuthorizeUrl', () => {
  beforeEach(() => {
    process.env.TWITTER_CLIENT_ID = 'test-client-id';
  });
  afterEach(() => {
    delete process.env.TWITTER_CLIENT_ID;
  });

  it('declares PKCE so the dispatcher mints a verifier for it', () => {
    expect(PLATFORMS.twitter.pkce).toBe(true);
  });

  it('targets the X authorize endpoint with an authorization-code request', () => {
    const u = authorizeUrl();
    expect(u.origin + u.pathname).toBe('https://x.com/i/oauth2/authorize');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe('test-client-id');
    expect(u.searchParams.get('redirect_uri')).toBe(REDIRECT);
  });

  it('carries the S256 code challenge', () => {
    const u = authorizeUrl();
    expect(u.searchParams.get('code_challenge')).toBe(CHALLENGE);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('sends scopes space-separated, as X expects', () => {
    const u = authorizeUrl(['users.read', 'tweet.read']);
    expect(u.searchParams.get('scope')).toBe('users.read tweet.read');
  });

  it('never requests offline.access — the token is meant to lapse', () => {
    // Login-only platform: no refresh token, so the POC token-refresh cron
    // skips it instead of trying to keep a dead credential alive.
    const u = authorizeUrl();
    expect(u.searchParams.get('scope')).not.toContain('offline.access');
  });

  it('refuses to build a URL without a PKCE challenge', () => {
    expect(() =>
      PLATFORMS.twitter.buildAuthorizeUrl(REDIRECT, ['users.read']),
    ).toThrow(/PKCE/i);
  });

  it('fails loudly when the app credentials are not configured', () => {
    delete process.env.TWITTER_CLIENT_ID;
    expect(() => authorizeUrl()).toThrow(/TWITTER_CLIENT_ID/);
  });
});
