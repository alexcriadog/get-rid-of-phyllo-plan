import { NextResponse } from 'next/server';
import { auth } from './auth';
import { isGated } from './lib/gated-paths';

export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  if (!isGated(pathname)) return NextResponse.next();
  if (req.auth) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('callbackUrl', pathname + search);
  return NextResponse.redirect(url);
});

export const config = {
  // Run on everything EXCEPT Next assets, the favicon, and the Auth.js / gate
  // endpoints (which must stay reachable unauthenticated). isGated() then
  // decides per-path — this avoids the enumerated-matcher trap where
  // `/admin/:path*` fails to match the exact `/admin`, leaving it ungated.
  matcher: ['/((?!_next/|favicon\\.ico|api/auth/|api/gate).*)'],
};
