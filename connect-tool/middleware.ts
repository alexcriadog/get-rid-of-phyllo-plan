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

  if (searchParams.get('embed') === '1') {
    const origin = searchParams.get('origin');
    const ancestors = origin ? `'self' ${origin}` : `'self'`;
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
