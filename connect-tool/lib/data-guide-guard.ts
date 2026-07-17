import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Gate `/data-guide` behind the shared operator session. The Auth.js session
 * cookie is set by poc/web on the same host, so getToken (with the shared
 * AUTH_SECRET) validates it here. No valid session → redirect to the poc/web
 * login page, which lives on the same host at /login.
 *
 * Fail-safe by design. `getToken` THROWS MissingSecret as soon as a session
 * cookie is present and no secret is configured (verified against next-auth
 * 5.0.0-beta.31; with no cookie it returns null instead). AUTH_SECRET is only
 * wired in tools/docker-compose.prod.yml, so any other environment crashed the
 * middleware into a blank 500 for logged-in operators — while anonymous
 * requests kept redirecting normally, which hid it. Misconfiguration must
 * degrade to an explicit, diagnosable response, never a crash.
 */
export async function guardDataGuide(req: NextRequest): Promise<NextResponse | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    console.error(
      '[data-guide] AUTH_SECRET is missing/empty — operator sessions cannot be ' +
        'validated. Set AUTH_SECRET on the connect-tool container (must equal ' +
        "poc/web's AUTH_SECRET) and recreate the container (`up -d`, not `restart`).",
    );
    return new NextResponse(
      'Data Guide is temporarily unavailable: AUTH_SECRET is not configured on ' +
        'this service, so operator sessions cannot be validated.',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  try {
    // Match how poc/web issues the cookie: in prod (HTTPS) it is
    // `__Secure-authjs.session-token` with a matching salt. Without
    // secureCookie getToken defaults to the non-secure name and rejects every
    // real session, redirecting authenticated operators back to /login in a
    // loop.
    const secureCookie = process.env.NODE_ENV === 'production';
    const token = await getToken({ req, secret, secureCookie });
    if (token) return null;
  } catch (err) {
    // Unexpected validation failure (malformed cookie, jose error…): treat as
    // unauthenticated rather than crashing the middleware into a blank 500.
    console.error('[data-guide] session validation failed — redirecting to login', err);
  }

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '?callbackUrl=/data-guide';
  return NextResponse.redirect(url);
}
