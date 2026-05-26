// Single dispatcher for OAuth routes (App Router edition).
//
//   GET /api/oauth/start/{platform}     → 302 to platform authorize URL
//   GET /api/oauth/callback/{platform}  → exchange code, seed POC, redirect
//
// Each platform's logic lives in lib/platforms.ts. This file is just
// routing and error handling.

import { NextRequest, NextResponse } from 'next/server';
import {
  PLATFORMS,
  type CallbackResult,
  type PlatformKey,
} from '../../../../lib/platforms';
import { putSession, getOAuthContextSession } from '../../../../lib/session';
import {
  setContextCookie,
  verifySdkToken,
  getContextCookie,
} from '../../../../lib/oauth-context';

const VALID_PLATFORMS = new Set<PlatformKey>([
  'facebook',
  'tiktok',
  'threads',
  'youtube',
  'twitch',
]);

// In-flight callback dedupe. Chrome's "Preload pages for faster browsing"
// (and some extensions) can fire the callback URL TWICE with the same
// `code` — once for the real navigation and once as a prefetch. OAuth
// codes are single-use across every platform we integrate: the second
// token exchange either returns 400 "Invalid authorization code" or — when
// the upstream closes the keep-alive socket mid-response — surfaces as
// axios `ECONNRESET` ("socket hang up"), which masks the real success
// of the first call.
//
// We cache the in-flight promise by (platform, code) so concurrent
// duplicates await the same exchange and reuse the same session. Cleared
// after CALLBACK_CACHE_TTL_MS so a fresh OAuth attempt with a new code
// never collides.
//
// Anchored on globalThis because Next.js standalone bundles route
// handlers into a separate webpack chunk — a module-level Map would be
// duplicated across bundles (same trick session.ts uses).
const CALLBACK_CACHE_TTL_MS = 60_000;
type CallbackEntry = { promise: Promise<CallbackResult>; clearAt: number };
const CALLBACK_CACHE_KEY = '__connect_tool_callback_inflight__';
type CallbackGlobal = { [CALLBACK_CACHE_KEY]?: Map<string, CallbackEntry> };
const cg = globalThis as unknown as CallbackGlobal;
const callbackInFlight: Map<string, CallbackEntry> =
  cg[CALLBACK_CACHE_KEY] ?? (cg[CALLBACK_CACHE_KEY] = new Map());

function pruneCallbackCache(): void {
  const now = Date.now();
  for (const [key, entry] of callbackInFlight.entries()) {
    if (entry.clearAt <= now) callbackInFlight.delete(key);
  }
}

function publicBaseUrl(req: NextRequest): string {
  const fromEnv = process.env.PUBLIC_BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const proto =
    req.headers.get('x-forwarded-proto') ??
    req.nextUrl.protocol.replace(':', '');
  const host =
    req.headers.get('x-forwarded-host') ??
    req.headers.get('host') ??
    req.nextUrl.host;
  return `${proto}://${host}`;
}

function redirectUriFor(platform: PlatformKey, baseUrl: string): string {
  const env = (key: string): string | undefined => {
    const v = process.env[key];
    return v && v.length > 0 ? v : undefined;
  };
  switch (platform) {
    case 'facebook':
      return env('META_REDIRECT_URI') ?? `${baseUrl}/api/oauth/callback/facebook`;
    case 'youtube':
      return env('GOOGLE_REDIRECT_URI') ?? `${baseUrl}/api/oauth/callback/youtube`;
    case 'tiktok':
      return env('TIKTOK_REDIRECT_URI') ?? `${baseUrl}/api/oauth/callback/tiktok`;
    case 'threads':
      return env('THREADS_REDIRECT_URI') ?? `${baseUrl}/api/oauth/callback/threads`;
    case 'twitch':
      return env('TWITCH_REDIRECT_URI') ?? `${baseUrl}/api/oauth/callback/twitch`;
    default:
      return `${baseUrl}/api/oauth/callback/${platform}`;
  }
}

function errorRedirect(baseUrl: string, message: string): NextResponse {
  return NextResponse.redirect(
    `${baseUrl}/?error=${encodeURIComponent(message)}`,
    { status: 302 },
  );
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string[] }> },
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  if (!slug || slug.length !== 2) {
    return new NextResponse('Not found', { status: 404 });
  }
  const [action, rawPlatform] = slug;
  const platform = rawPlatform as PlatformKey;
  const baseUrl = publicBaseUrl(req);
  if (!VALID_PLATFORMS.has(platform)) {
    return new NextResponse(`Unknown platform: ${rawPlatform}`, { status: 404 });
  }
  const redirectUri = redirectUriFor(platform, baseUrl);

  if (action === 'start') {
    // SDK launch flow: the popup arrives with ?ws=<slug>&token=<jwt>.
    // Verify against the POC backend, persist the tenant + end-user
    // context under a fresh session id, and drop a HttpOnly cookie that
    // survives the OAuth round-trip. seed-confirm / seed-pages pick it
    // up later to scope the account to the right workspace.
    //
    // Absent ?ws/?token → legacy single-tenant flow: nothing changes,
    // the seed POST omits workspace_id and the backend falls back to the
    // "demo" workspace.
    const sp = req.nextUrl.searchParams;
    const ws = sp.get('ws');
    const token = sp.get('token');
    let contextSessionId: string | null = null;
    if (ws && token) {
      try {
        const claims = await verifySdkToken(token);
        if (claims.ws_slug !== ws) {
          throw new Error(
            `SDK token workspace mismatch (token=${claims.ws_slug}, query=${ws})`,
          );
        }
        if (claims.platforms && !claims.platforms.includes(platform)) {
          throw new Error(
            `Platform ${platform} not allowed by SDK token (allowed=${claims.platforms.join(',')})`,
          );
        }
        const origin = sp.get('origin') ?? undefined;
        const embedded = sp.get('embed') === '1';
        contextSessionId = putSession({
          kind: 'oauth-context',
          workspaceId: claims.ws,
          workspaceSlug: ws,
          endUserId: claims.sub,
          allowedPlatforms: claims.platforms,
          environment: claims.env,
          openerOrigin: origin,
          embedded,
        });
      } catch (err) {
        return errorRedirect(
          baseUrl,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    let authorizeUrl: string;
    try {
      authorizeUrl = PLATFORMS[platform].buildAuthorizeUrl(redirectUri);
    } catch (err) {
      return errorRedirect(
        baseUrl,
        err instanceof Error ? err.message : String(err),
      );
    }
    const response = NextResponse.redirect(authorizeUrl, { status: 302 });
    if (contextSessionId) {
      setContextCookie(response, contextSessionId);
    }
    return response;
  }

  if (action === 'callback') {
    const sp = req.nextUrl.searchParams;
    const error = sp.get('error');
    if (error) {
      const desc = sp.get('error_description') ?? '';
      return errorRedirect(
        baseUrl,
        `${platform} denied: ${error}${desc ? ` — ${desc}` : ''}`,
      );
    }
    const code = sp.get('code');
    if (!code) {
      return errorRedirect(baseUrl, `${platform} callback missing ?code`);
    }
    try {
      pruneCallbackCache();
      const cacheKey = `${platform}:${code}`;
      let entry = callbackInFlight.get(cacheKey);
      if (!entry) {
        const promise = PLATFORMS[platform].handleCallback(code, redirectUri);
        entry = {
          promise,
          clearAt: Date.now() + CALLBACK_CACHE_TTL_MS,
        };
        callbackInFlight.set(cacheKey, entry);
      }
      const result = await entry.promise;
      const ctxId = getContextCookie(req);
      const ctx = ctxId ? getOAuthContextSession(ctxId) : null;
      const embedded = !!ctx?.embedded;

      if (result.kind === 'fb-picker') {
        const target = embedded
          ? `${baseUrl}/oauth/complete?session=${result.sessionId}&kind=fb-picker&platform=facebook`
          : `${baseUrl}/facebook/pages?session=${result.sessionId}`;
        return NextResponse.redirect(target, { status: 302 });
      }
      const target = embedded
        ? `${baseUrl}/oauth/complete?session=${result.sessionId}&kind=confirm&platform=${result.platform}`
        : `${baseUrl}/confirm/${result.platform}?session=${result.sessionId}`;
      return NextResponse.redirect(target, { status: 302 });
    } catch (err) {
      return errorRedirect(
        baseUrl,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return new NextResponse(`Unknown action: ${action}`, { status: 404 });
}
