import { NextRequest, NextResponse } from 'next/server';

/**
 * Allow only the legitimate host app to frame the embedded connect routes,
 * and forbid framing everywhere else. The host origin arrives as ?origin=…
 * on the iframe URL (set by the SDK from window.location.origin) and is
 * forwarded across the post-OAuth page navigations.
 */
export function middleware(req: NextRequest): NextResponse {
  const res = NextResponse.next();
  const { searchParams } = req.nextUrl;

  // Baseline hardening on every framed/connect route. `no-referrer` stops the
  // token-bearing URL (?token=…) from leaking to third parties via Referer;
  // nosniff + a locked-down Permissions-Policy are cheap defence-in-depth.
  // (Clickjacking is enforced primarily server-side: the /connect page and
  // /api/oauth/start fail closed on a disallowed embedder origin in prod, so a
  // framed page for an unlisted origin renders an error with nothing to redress.)
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

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
  matcher: ['/connect', '/oauth/complete', '/confirm/:path*', '/facebook/pages', '/success'],
};
