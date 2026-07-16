// X (Twitter) login mode. X is our only OAuth 1.0a platform (login-only,
// free — see lib/oauth1a.ts). These pin the mode invariants: the dispatcher
// must drive the 1.0a flow (startOAuth1a/handleCallback1a), and the OAuth 2.0
// methods are unreachable stubs that fail loudly if ever called. The signed
// request construction is covered by lib/oauth1a.test.ts; the live HTTP steps
// are covered by a real connect, not unit tests.

import { describe, it, expect, afterEach } from 'vitest';
import { PLATFORMS } from './platforms';

describe('twitter — OAuth 1.0a login mode', () => {
  afterEach(() => {
    delete process.env.TWITTER_CONSUMER_KEY;
    delete process.env.TWITTER_CONSUMER_SECRET;
  });

  it('is flagged oauth1a (and not pkce/OAuth2)', () => {
    expect(PLATFORMS.twitter.oauth1a).toBe(true);
    expect(PLATFORMS.twitter.pkce).toBeFalsy();
  });

  it('exposes the 1.0a step methods the dispatcher calls', () => {
    expect(typeof PLATFORMS.twitter.startOAuth1a).toBe('function');
    expect(typeof PLATFORMS.twitter.handleCallback1a).toBe('function');
  });

  it('OAuth 2.0 stubs throw — they must never be reached for X', () => {
    expect(() =>
      PLATFORMS.twitter.buildAuthorizeUrl('https://cb', []),
    ).toThrow(/OAuth 1\.0a/);
    return expect(
      PLATFORMS.twitter.handleCallback('code', 'https://cb'),
    ).rejects.toThrow(/OAuth 1\.0a/);
  });

  it('startOAuth1a fails loudly (before any network) without app credentials', async () => {
    // requireEnv runs before the request_token HTTP call, so a missing
    // Consumer Key rejects synchronously — no live call.
    await expect(
      PLATFORMS.twitter.startOAuth1a!(
        'https://smconnector.example.com/api/oauth/callback/twitter',
      ),
    ).rejects.toThrow(/TWITTER_CONSUMER_KEY/);
  });

  it('handleCallback1a also requires the app credentials', async () => {
    await expect(
      PLATFORMS.twitter.handleCallback1a!('token', 'verifier', 'secret'),
    ).rejects.toThrow(/TWITTER_CONSUMER_KEY/);
  });
});
