import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Gate `/data-guide` behind the shared operator session. The Auth.js session
 * cookie is set by poc/web on the same host, so getToken (with the shared
 * AUTH_SECRET) validates it here. No valid session → redirect to the poc/web
 * login page, which lives on the same host at /login.
 */
async function guardDataGuide(req: NextRequest): Promise<NextResponse | null> {
  // Match how poc/web issues the cookie: in prod (HTTPS) it is
  // `__Secure-authjs.session-token` with a matching salt. Without secureCookie
  // getToken defaults to the non-secure name and rejects every real session,
  // redirecting authenticated operators back to /login in a loop.
  const secureCookie = process.env.NODE_ENV === 'production';
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    secureCookie,
  });
  if (token) return null;
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '?callbackUrl=/data-guide';
  return NextResponse.redirect(url);
}

/**
 * Two jobs, by path:
 *  - `/data-guide*`: require an operator session (see guardDataGuide).
 *  - embed routes: allow only the legitimate host app to frame the embedded
 *    connect routes, and forbid framing everywhere else. The host origin
 *    arrives as ?origin=… on the iframe URL (set by the SDK from
 *    window.location.origin) and is forwarded across the post-OAuth page
 *    navigations.
 */
export async function middleware(req: NextRequest): Promise<NextResponse> {
  if (req.nextUrl.pathname.startsWith('/data-guide')) {
    const denied = await guardDataGuide(req);
    if (denied) return denied;
    return NextResponse.next();
  }

  const res = NextResponse.next();
  const { searchParams } = req.nextUrl;

  if (searchParams.get('embed') === '1') {
    const origin = searchParams.get('origin');
    // Only echo a well-formed http(s) origin into the directive so a
    // malformed/multi-value param can't produce a broken CSP header. The class
    // also excludes ASCII control chars (incl. the null byte \x00) and DEL:
    // a header value containing one would make res.headers.set throw, which
    // surfaces as a 500 that strips ALL frame-protection headers. Real origins
    // (the SDK's window.location.origin, punycode for IDN) are clean ASCII, so
    // nothing legitimate is rejected; a crafted value just falls back to 'self'.
    const safeOrigin =
      origin && /^https?:\/\/[^\s;'"\x00-\x1F\x7F]+$/.test(origin) ? origin : null;
    const ancestors = safeOrigin ? `'self' ${safeOrigin}` : `'self'`;
    res.headers.set('Content-Security-Policy', `frame-ancestors ${ancestors};`);
    res.headers.delete('X-Frame-Options');
  } else {
    res.headers.set('X-Frame-Options', 'DENY');
    res.headers.set('Content-Security-Policy', `frame-ancestors 'none';`);
  }
  return res;
}

export const config = {
  matcher: [
    '/connect',
    '/oauth/complete',
    '/confirm/:path*',
    '/facebook/pages',
    '/success',
    '/data-guide',
    '/data-guide/:path*',
  ],
};
