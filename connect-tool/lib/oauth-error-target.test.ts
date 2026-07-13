import { describe, expect, it } from 'vitest';
import { oauthErrorTarget } from './oauth-error-target';

const BASE = 'https://smconnector.example.com';

describe('oauthErrorTarget', () => {
  it('sends standalone flows to the root page error banner', () => {
    const url = oauthErrorTarget(BASE, 'threads', 'threads denied: access_denied', false);
    expect(url).toBe(
      `${BASE}/?error=threads%20denied%3A%20access_denied`,
    );
  });

  it('sends embedded flows through the /oauth/complete relay', () => {
    const url = oauthErrorTarget(
      BASE,
      'threads',
      'threads denied: access_denied — Permissions error',
      true,
    );
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/oauth/complete');
    expect(parsed.searchParams.get('platform')).toBe('threads');
    expect(parsed.searchParams.get('error')).toBe(
      'threads denied: access_denied — Permissions error',
    );
  });

  it('URL-encodes hostile messages so they cannot break the query string', () => {
    const url = oauthErrorTarget(BASE, 'facebook', 'a&b=c#d', true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('error')).toBe('a&b=c#d');
    expect(parsed.hash).toBe('');
  });
});
