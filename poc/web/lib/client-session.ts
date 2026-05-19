// Client-dashboard session helper.
//
// The client pastes their cmlk_(live|test)_* API key into /client/login.
// We HMAC-sign it with WEB_SESSION_SECRET and store the signed payload in
// a HttpOnly + SameSite=Strict cookie. /api/client/proxy/[...path] reads
// the cookie on every request, verifies the signature, extracts the raw
// key, and forwards the request to the connector API as Bearer auth.
//
// The bearer never reaches the browser — it lives in the cookie (server-
// readable only). XSS in the dashboard cannot exfiltrate the key.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

export const CLIENT_SESSION_COOKIE = 'camaleonic_client_session';
const COOKIE_TTL_SECONDS = 60 * 60; // 1 hour

function getSecret(): Buffer {
  const hex = process.env.WEB_SESSION_SECRET;
  if (hex && /^[0-9a-fA-F]{32,}$/.test(hex)) {
    return Buffer.from(hex, 'hex');
  }
  // Dev fallback: derive a deterministic secret from CONNECTOR_API_URL so
  // we never need a freshly-set env var to start the web app. Prod SHOULD
  // override with WEB_SESSION_SECRET; without it, any operator with the
  // CONNECTOR_API_URL can forge sessions.
  const seed =
    process.env.CONNECTOR_API_URL ||
    process.env.NEXT_PUBLIC_CONNECTOR_API_URL ||
    'camaleonic-client-session-fallback-v1';
  return createHmac('sha256', 'derived').update(seed).digest();
}

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64urlDecode(input: string): Buffer {
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function signApiKey(rawKey: string): string {
  const payload = base64url(Buffer.from(rawKey, 'utf8'));
  const sig = base64url(
    createHmac('sha256', getSecret()).update(payload).digest(),
  );
  return `${payload}.${sig}`;
}

export function verifyApiKey(signed: string): string | null {
  if (typeof signed !== 'string' || signed.length === 0) return null;
  const dot = signed.indexOf('.');
  if (dot <= 0) return null;
  const payload = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  const expected = createHmac('sha256', getSecret()).update(payload).digest();
  const provided = base64urlDecode(sig);
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return null;
  }
  try {
    return base64urlDecode(payload).toString('utf8');
  } catch {
    return null;
  }
}

export function setSessionCookie(res: NextApiResponse, signed: string): void {
  const secure = process.env.NODE_ENV === 'production' ? 'Secure; ' : '';
  res.setHeader(
    'Set-Cookie',
    `${CLIENT_SESSION_COOKIE}=${signed}; Path=/; HttpOnly; ${secure}SameSite=Strict; Max-Age=${COOKIE_TTL_SECONDS}`,
  );
}

export function clearSessionCookie(res: NextApiResponse): void {
  const secure = process.env.NODE_ENV === 'production' ? 'Secure; ' : '';
  res.setHeader(
    'Set-Cookie',
    `${CLIENT_SESSION_COOKIE}=; Path=/; HttpOnly; ${secure}SameSite=Strict; Max-Age=0`,
  );
}

export function readSignedFromRequest(
  req: NextApiRequest | { headers: { cookie?: string } },
): string | null {
  const raw = req.headers.cookie ?? '';
  for (const piece of raw.split(';')) {
    const [k, ...rest] = piece.trim().split('=');
    if (k === CLIENT_SESSION_COOKIE) {
      const v = rest.join('=').trim();
      return v.length > 0 ? v : null;
    }
  }
  return null;
}

export function readApiKeyFromRequest(req: NextApiRequest): string | null {
  const signed = readSignedFromRequest(req);
  if (!signed) return null;
  return verifyApiKey(signed);
}

export const SESSION_TTL_SECONDS = COOKIE_TTL_SECONDS;

/** For ops: dump a fresh random session secret hex when bootstrapping prod. */
export function generateSessionSecretHex(): string {
  return randomBytes(32).toString('hex');
}
