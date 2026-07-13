import type { NextApiRequest } from 'next';
import { getToken } from 'next-auth/jwt';

/**
 * Resolve whether a request carries a valid Auth.js operator session.
 * Returns the HTTP status Caddy `forward_auth` expects: 200 (allow) or
 * 401 (deny). Kept in lib/ (not the pages route) so it unit-tests without
 * Next's page-routing picking up the spec file.
 */
export async function gateStatus(req: NextApiRequest): Promise<200 | 401> {
  // next-auth v5's getToken wants headers as Record<string,string>; a
  // NextApiRequest's headers are Record<string, string | string[]>. Normalize
  // (the session cookie header is always a single string).
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers[key] = value;
    else if (Array.isArray(value)) headers[key] = value.join(', ');
  }
  // In prod (HTTPS) Auth.js issues the cookie as `__Secure-authjs.session-token`
  // with a matching salt; getToken defaults to the non-secure name unless we
  // tell it. Mirror the issuer: secure cookies in production. Without this the
  // gate fails CLOSED in prod (never finds the cookie → 401 on every request).
  const secureCookie = process.env.NODE_ENV === 'production';
  const token = await getToken({
    req: { headers },
    secret: process.env.AUTH_SECRET,
    secureCookie,
  });
  return token ? 200 : 401;
}
