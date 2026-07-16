// OAuth 1.0a "Sign in with Twitter" — the FREE way to prove X account
// ownership. Unlike OAuth 2.0 (whose token carries no identity, forcing a
// metered GET /2/users/me read), the 1.0a access-token response returns
// `user_id` + `screen_name` directly, and the token endpoints are not
// billed. That's all we need: X is login-only, its data is scraped.
//
// Flow (3-legged, RFC 5849):
//   1. POST /oauth/request_token  → request token + secret (stash the secret)
//   2. redirect to /oauth/authenticate?oauth_token=…  (user approves)
//   3. POST /oauth/access_token   → access token + user_id + screen_name
//
// Only percentEncode + oauth1aSignature are pure (and unit-tested); the three
// step helpers wrap them with a nonce/timestamp and an HTTP round-trip.

import axios from 'axios';
import { createHmac, randomBytes } from 'node:crypto';

// OAuth 1.0a lives on the legacy api.twitter.com host, which X keeps alive
// precisely for "Sign in with Twitter". The signature is bound to this exact
// host, so it must be the one that serves the request without redirecting.
const X_API = 'https://api.twitter.com';
const REQUEST_TOKEN_URL = `${X_API}/oauth/request_token`;
const AUTHENTICATE_URL = `${X_API}/oauth/authenticate`;
const ACCESS_TOKEN_URL = `${X_API}/oauth/access_token`;

/** RFC 3986 percent-encoding — stricter than encodeURIComponent. */
export function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!*'()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/**
 * RFC 5849 §3.4 HMAC-SHA1 signature. `params` is every oauth_* (and any
 * request) parameter EXCEPT oauth_signature. Pass '' for tokenSecret on the
 * request-token step (no user token yet).
 */
export function oauth1aSignature(
  method: string,
  baseUrl: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string,
): string {
  const paramString = Object.keys(params)
    .map((k) => [percentEncode(k), percentEncode(params[k])] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const baseString = [
    method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(paramString),
  ].join('&');
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return createHmac('sha1', signingKey).update(baseString).digest('base64');
}

function nonce(): string {
  return randomBytes(16).toString('hex');
}

function timestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

/** Build the `Authorization: OAuth …` header for a signed 1.0a request. */
function authHeader(
  method: string,
  url: string,
  extraParams: Record<string, string>,
  consumerKey: string,
  consumerSecret: string,
  token?: string,
  tokenSecret?: string,
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp(),
    oauth_version: '1.0',
    ...(token ? { oauth_token: token } : {}),
    ...extraParams,
  };
  const signature = oauth1aSignature(
    method,
    url,
    oauthParams,
    consumerSecret,
    tokenSecret ?? '',
  );
  const headerParams: Record<string, string> = {
    ...oauthParams,
    oauth_signature: signature,
  };
  return (
    'OAuth ' +
    Object.keys(headerParams)
      .filter((k) => k.startsWith('oauth_'))
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(headerParams[k])}"`)
      .join(', ')
  );
}

function parseTokenResponse(body: string): URLSearchParams {
  return new URLSearchParams(body);
}

export interface RequestTokenResult {
  oauthToken: string;
  oauthTokenSecret: string;
}

/** Step 1 — mint a request token bound to our callback. */
export async function requestToken(
  consumerKey: string,
  consumerSecret: string,
  callbackUrl: string,
): Promise<RequestTokenResult> {
  const header = authHeader(
    'POST',
    REQUEST_TOKEN_URL,
    { oauth_callback: callbackUrl },
    consumerKey,
    consumerSecret,
  );
  const res = await axios.post<string>(REQUEST_TOKEN_URL, null, {
    headers: { Authorization: header },
    timeout: 15_000,
    validateStatus: () => true,
    // Bypass any HTTPS_PROXY env var (OrbStack) — same hardening as elsewhere.
    proxy: false,
    responseType: 'text',
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `X request_token failed (HTTP ${res.status}): ${String(res.data).slice(0, 300)}`,
    );
  }
  const parsed = parseTokenResponse(String(res.data));
  if (parsed.get('oauth_callback_confirmed') !== 'true') {
    throw new Error('X request_token did not confirm the callback');
  }
  const oauthToken = parsed.get('oauth_token');
  const oauthTokenSecret = parsed.get('oauth_token_secret');
  if (!oauthToken || !oauthTokenSecret) {
    throw new Error('X request_token response missing oauth_token(_secret)');
  }
  return { oauthToken, oauthTokenSecret };
}

/**
 * Step 2 — the URL we redirect the user to. `authenticate` streamlines the
 * consent for users who already authorised the app.
 */
export function authenticateUrl(reqToken: string): string {
  return `${AUTHENTICATE_URL}?oauth_token=${percentEncode(reqToken)}`;
}

export interface AccessTokenResult {
  oauthToken: string;
  oauthTokenSecret: string;
  userId: string;
  screenName: string;
}

/**
 * Step 3 — exchange the authorised request token for an access token; the
 * response carries the verified identity (user_id + screen_name) for free.
 */
export async function accessToken(
  consumerKey: string,
  consumerSecret: string,
  reqToken: string,
  reqTokenSecret: string,
  oauthVerifier: string,
): Promise<AccessTokenResult> {
  const header = authHeader(
    'POST',
    ACCESS_TOKEN_URL,
    { oauth_verifier: oauthVerifier },
    consumerKey,
    consumerSecret,
    reqToken,
    reqTokenSecret,
  );
  const res = await axios.post<string>(ACCESS_TOKEN_URL, null, {
    headers: { Authorization: header },
    timeout: 15_000,
    validateStatus: () => true,
    proxy: false,
    responseType: 'text',
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `X access_token failed (HTTP ${res.status}): ${String(res.data).slice(0, 300)}`,
    );
  }
  const parsed = parseTokenResponse(String(res.data));
  const oauthToken = parsed.get('oauth_token');
  const oauthTokenSecret = parsed.get('oauth_token_secret');
  const userId = parsed.get('user_id');
  const screenName = parsed.get('screen_name');
  if (!oauthToken || !oauthTokenSecret || !userId || !screenName) {
    throw new Error('X access_token response missing token/identity fields');
  }
  return { oauthToken, oauthTokenSecret, userId, screenName };
}
