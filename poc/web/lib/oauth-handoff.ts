// HMAC (HS256) JWT helpers for the MCP OAuth consent handoff. The dashboard
// signs a short-lived token asserting "this logged-in client → this workspace"
// which the connector's /mcp/oauth/grant verifies. Signed with the shared
// CONNECT_TOOL_SECRET (present in both the web and api services). Mirrors the
// connector's oauth-jwt.ts so the two stay byte-compatible.

import { createHmac, timingSafeEqual } from 'node:crypto';

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function handoffSecret(): string {
  return process.env.CONNECT_TOOL_SECRET || 'dev-mcp-oauth-secret';
}

export function signHandoffJwt(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds: number,
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    'utf8',
  ).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({ ...payload, iat: nowSec(), exp: nowSec() + ttlSeconds }),
    'utf8',
  ).toString('base64url');
  const data = `${header}.${body}`;
  const sig = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyHandoffJwt<T = Record<string, unknown>>(
  token: string,
  secret: string,
): T | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.exp === 'number' && payload.exp < nowSec()) return null;
  return payload as T;
}
