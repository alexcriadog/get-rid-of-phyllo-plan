// Single dispatcher for OAuth routes (App Router edition).
//
//   GET /api/oauth/start/{platform}     → 302 to platform authorize URL
//   GET /api/oauth/callback/{platform}  → exchange code, seed POC, redirect
//
// Each platform's logic lives in lib/platforms.ts. This file is just
// routing and error handling.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  PLATFORMS,
  type CallbackResult,
  type PlatformKey,
} from '../../../../lib/platforms';
import {
  putSession,
  getOAuthContextSession,
  attachContext,
  type OAuthContextSession,
} from '../../../../lib/session';
import {
  setContextCookie,
  verifySdkToken,
  getContextCookie,
} from '../../../../lib/oauth-context';
import {
  isOriginAllowed,
  isOriginAllowedStrict,
  shouldRequireAllowList,
} from '../../../../lib/origin-allowlist';
import { oauthErrorTarget } from '../../../../lib/oauth-error-target';
import {
  callbackDedupeKey,
  newPkceVerifier,
  pkceChallenge,
} from '../../../../lib/pkce';
import {
  computeOAuthScopes,
  fetchProductsCatalog,
  fetchWorkspaceProducts,
  intersectConnectionProducts,
  platformReachableAtOAuthStart,
  type ProductsConfig,
} from '../../../../lib/workspace-config';

const VALID_PLATFORMS = new Set<PlatformKey>([
  'facebook',
  'instagram_direct',
  'tiktok',
  'threads',
  'youtube',
  'twitch',
  'linkedin',
  'twitter',
]);

// IG-direct is rolled out opt-in (docs/instagram-direct-oauth.md §8 "Opción
// C"). Until the flag is on, the surface 404s exactly like an unknown
// platform.
function igDirectEnabled(): boolean {
  return process.env.IG_DIRECT_ENABLED === '1';
}

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
// duplicated across bundles.
//
// NOTE (multi-instance): this dedupe is per-process — it caches the
// in-flight Promise, which can't be serialized to Redis. With 2+
// instances behind a load balancer a duplicate callback for the SAME
// code could land on a different instance and re-attempt the (single-use)
// exchange, which fails. That's the rare Chrome-preload race; the first
// request still succeeds and creates the (Redis-backed) session, so the
// blast radius is one spurious error on the duplicate. Accepted tradeoff
// — a cross-instance lock here would mean polling Redis for a session the
// other instance may not have written yet.
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
    case 'linkedin':
      return (
        env('LINKEDIN_REDIRECT_URI') ?? `${baseUrl}/api/oauth/callback/linkedin`
      );
    case 'twitter':
      return (
        env('TWITTER_REDIRECT_URI') ?? `${baseUrl}/api/oauth/callback/twitter`
      );
    case 'instagram_direct':
      return (
        env('INSTAGRAM_REDIRECT_URI') ??
        `${baseUrl}/api/oauth/callback/instagram_direct`
      );
    default:
      return `${baseUrl}/api/oauth/callback/${platform}`;
  }
}

function errorRedirect(
  baseUrl: string,
  platform: string,
  message: string,
  embedded: boolean,
): NextResponse {
  return NextResponse.redirect(
    oauthErrorTarget(baseUrl, platform, message, embedded),
    { status: 302 },
  );
}

// ─── OAuth state (Sec C-2: CSRF / authorization-code injection) ──────────
//
// We mint a random `state` at /start, bind it to the browser via an
// HttpOnly SameSite=Lax cookie, and force it onto the outbound authorize URL
// (overwriting any per-platform default). At /callback we require the
// returned ?state to match the cookie in constant time. This blocks the
// classic login-CSRF / code-injection attack where an attacker feeds their
// own authorization code into a victim's callback. SameSite=Lax survives the
// top-level redirect back from the provider; the 10-min TTL bounds the flow.
const OAUTH_STATE_COOKIE = 'camaleonic_oauth_state';
const OAUTH_STATE_TTL_SECONDS = 600;

function newOAuthState(): string {
  return randomBytes(32).toString('hex');
}

function setStateCookie(res: NextResponse, state: string): void {
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
}

function clearStateCookie(res: NextResponse): void {
  res.cookies.set(OAUTH_STATE_COOKIE, '', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 0,
  });
}

/** Force our controlled state onto an authorize URL, replacing any default. */
function withForcedState(authorizeUrl: string, state: string): string {
  const u = new URL(authorizeUrl);
  u.searchParams.set('state', state);
  return u.toString();
}

/** Constant-time string compare that never throws on length mismatch. */
function statesMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ─── PKCE (platforms with `pkce: true` — X today) ────────────────────────
//
// Sibling of the CSRF state cookie above: same TTL, same lifecycle, cleared
// on the same exits. Why the verifier travels this way: lib/pkce.ts.
const OAUTH_PKCE_COOKIE = 'camaleonic_oauth_pkce';

function setPkceCookie(res: NextResponse, verifier: string): void {
  res.cookies.set(OAUTH_PKCE_COOKIE, verifier, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: OAUTH_STATE_TTL_SECONDS,
    // The verifier is the PKCE secret — never let it cross a cleartext hop.
    // Prod is HTTPS-only (middleware reads the __Secure- next-auth cookie
    // there); local dev is http, hence the env gate. NOTE: the sibling state
    // and context cookies predate this and still lack the flag.
    secure: process.env.NODE_ENV === 'production',
  });
}

function clearPkceCookie(res: NextResponse): void {
  res.cookies.set(OAUTH_PKCE_COOKIE, '', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 0,
    secure: process.env.NODE_ENV === 'production',
  });
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
  if (platform === 'instagram_direct' && !igDirectEnabled()) {
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
    // Embedded (SDK modal) flows must surface errors back inside the modal,
    // not on the connector's own pages — see oauthErrorTarget.
    const embedded = sp.get('embed') === '1';
    let contextSessionId: string | null = null;
    let productsConfig: ProductsConfig = null;
    let connectionProducts: Record<string, ReadonlyArray<string>> | undefined;
    if (ws && token) {
      try {
        const claims = await verifySdkToken(token);
        if (claims.ws_slug !== ws) {
          throw new Error(
            `SDK token workspace mismatch (token=${claims.ws_slug}, query=${ws})`,
          );
        }
        // The SDK token speaks product platforms ('instagram'); map internal
        // OAuth surfaces back before checking the claim.
        const claimPlatform = platform === 'instagram_direct' ? 'instagram' : platform;
        if (claims.platforms && !claims.platforms.includes(claimPlatform)) {
          throw new Error(
            `Platform ${claimPlatform} not allowed by SDK token (allowed=${claims.platforms.join(',')})`,
          );
        }
        // Gate #3: workspace.products allow-list. If the workspace
        // configured a restricted platform set and this OAuth start isn't
        // reachable from it, fail BEFORE we redirect to the provider.
        // platformReachableAtOAuthStart handles the IG↔FB merger (FB OAuth
        // covers both). null products config means unrestricted (default).
        productsConfig = await fetchWorkspaceProducts(ws);
        connectionProducts = claims.products;
        if (!platformReachableAtOAuthStart(productsConfig, platform)) {
          throw new Error(
            `This platform isn't available for workspace "${ws}". Contact your administrator if you need it enabled.`,
          );
        }
        const origin = sp.get('origin') ?? undefined;
        // Sec-4: the launching page's ?origin MUST be in the workspace's
        // allow-list (carried in the signed token). Reject here — BEFORE
        // redirecting to the provider and before any session is created — so a
        // leaked token can't drive an OAuth flow whose result would postMessage
        // to an attacker origin. In production this is FAIL-CLOSED: a workspace
        // with no allow-list is denied (a public connector must not default to
        // "any origin"). Non-production stays lenient so dev workspaces without
        // an allow-list keep working.
        const originAllowed = shouldRequireAllowList()
          ? isOriginAllowedStrict(origin, claims.origins)
          : isOriginAllowed(origin, claims.origins);
        if (!originAllowed) {
          throw new Error(
            `Origin "${origin ?? '(none provided)'}" is not allowed for workspace "${ws}". Add it under the workspace's allowed origins.`,
          );
        }
        contextSessionId = await putSession({
          kind: 'oauth-context',
          workspaceId: claims.ws,
          workspaceSlug: ws,
          endUserId: claims.sub,
          allowedPlatforms: claims.platforms,
          connectionProducts: claims.products,
          environment: claims.env,
          openerOrigin: origin,
          embedded,
        });
      } catch (err) {
        return errorRedirect(
          baseUrl,
          platform,
          err instanceof Error ? err.message : String(err),
          embedded,
        );
      }
    }

    // Per-workspace scope reduction. We pass the minimum set of scopes the
    // workspace's enabled products need; the consent screen only shows those.
    const catalog = await fetchProductsCatalog();
    if (!catalog) {
      return errorRedirect(
        baseUrl,
        platform,
        'Products catalog temporarily unavailable',
        embedded,
      );
    }
    // Narrow to the per-connection scope (if the SDK token carried one) before
    // computing OAuth scopes — a "basic" connection then only asks the provider
    // for the scopes its scoped products need.
    const effectiveConfig = intersectConnectionProducts(
      productsConfig,
      connectionProducts,
    );
    const scopes = computeOAuthScopes(catalog, effectiveConfig, platform);

    // PKCE platforms (X): mint the verifier BEFORE building the URL so the
    // S256 challenge rides the authorize redirect while the verifier rides
    // an HttpOnly cookie back to the callback.
    const pkceVerifier = PLATFORMS[platform].pkce ? newPkceVerifier() : null;
    let authorizeUrl: string;
    try {
      authorizeUrl = PLATFORMS[platform].buildAuthorizeUrl(
        redirectUri,
        scopes,
        pkceVerifier ? { challenge: pkceChallenge(pkceVerifier) } : undefined,
      );
    } catch (err) {
      return errorRedirect(
        baseUrl,
        platform,
        err instanceof Error ? err.message : String(err),
        embedded,
      );
    }
    // Sec C-2: bind this flow to the browser with a CSRF state we verify at
    // the callback. Force it onto the authorize URL so the provider echoes
    // our value back regardless of any per-platform default.
    const state = newOAuthState();
    authorizeUrl = withForcedState(authorizeUrl, state);
    const response = NextResponse.redirect(authorizeUrl, { status: 302 });
    setStateCookie(response, state);
    if (pkceVerifier) {
      setPkceCookie(response, pkceVerifier);
    }
    if (contextSessionId) {
      setContextCookie(response, contextSessionId);
    }
    return response;
  }

  if (action === 'callback') {
    const sp = req.nextUrl.searchParams;
    // Resolve the embed context BEFORE error handling: a denial needs to know
    // where "back" is just as much as a success does. Defensive catch — if the
    // session store is unreachable we fall back to the standalone error page
    // rather than a 500.
    let oauthCtx: OAuthContextSession | null = null;
    try {
      const ctxId = getContextCookie(req);
      oauthCtx = ctxId ? await getOAuthContextSession(ctxId) : null;
    } catch {
      oauthCtx = null;
    }
    const embedded = !!oauthCtx?.embedded;
    const failRedirect = (message: string): NextResponse => {
      const res = errorRedirect(baseUrl, platform, message, embedded);
      clearStateCookie(res);
      clearPkceCookie(res);
      return res;
    };
    const error = sp.get('error');
    if (error) {
      const desc = sp.get('error_description') ?? '';
      return failRedirect(
        `${platform} denied: ${error}${desc ? ` — ${desc}` : ''}`,
      );
    }
    // Sec C-2: the returned ?state MUST match the cookie we set at /start.
    // Reject before touching the authorization code so a code injected by an
    // attacker (who can't forge the victim's HttpOnly cookie) is never
    // exchanged.
    const returnedState = sp.get('state');
    const cookieState = req.cookies.get(OAUTH_STATE_COOKIE)?.value ?? null;
    if (!statesMatch(returnedState, cookieState)) {
      return failRedirect(
        `${platform} callback failed state verification — please retry the connection.`,
      );
    }
    const code = sp.get('code');
    if (!code) {
      return failRedirect(`${platform} callback missing ?code`);
    }
    // PKCE platforms: the verifier cookie must have survived the provider
    // round-trip (same lifecycle as the state cookie checked above).
    const pkceVerifier = req.cookies.get(OAUTH_PKCE_COOKIE)?.value ?? null;
    if (PLATFORMS[platform].pkce && !pkceVerifier) {
      return failRedirect(
        `${platform} callback missing its PKCE verifier — please retry the connection.`,
      );
    }
    try {
      pruneCallbackCache();
      // Keyed on the verifier for PKCE platforms — the state check above only
      // proves the caller owns their OWN state cookie, so without this a
      // replayed `code` would collect someone else's exchange straight from
      // the cache. See callbackDedupeKey.
      const cacheKey = callbackDedupeKey(
        platform,
        code,
        PLATFORMS[platform].pkce ? pkceVerifier : null,
      );
      let entry = callbackInFlight.get(cacheKey);
      if (!entry) {
        const promise = PLATFORMS[platform].handleCallback(
          code,
          redirectUri,
          PLATFORMS[platform].pkce && pkceVerifier
            ? { verifier: pkceVerifier }
            : undefined,
        );
        entry = {
          promise,
          clearAt: Date.now() + CALLBACK_CACHE_TTL_MS,
        };
        callbackInFlight.set(cacheKey, entry);
      }
      const result = await entry.promise;

      // Persist tenant context ON the result session (keyed by sessionId,
      // which is forwarded via the URL). The seed handlers read it from the
      // session instead of the context cookie, which a third-party iframe
      // withholds (SameSite=Lax). This callback runs top-level in the popup,
      // so the cookie is still readable here.
      if (oauthCtx) {
        await attachContext(result.sessionId, {
          workspaceId: oauthCtx.workspaceId,
          endUserId: oauthCtx.endUserId,
          environment: oauthCtx.environment,
          openerOrigin: oauthCtx.openerOrigin,
          workspaceSlug: oauthCtx.workspaceSlug,
          connectionProducts: oauthCtx.connectionProducts,
        });
      }

      if (result.kind === 'fb-picker') {
        const target = embedded
          ? `${baseUrl}/oauth/complete?session=${result.sessionId}&kind=fb-picker&platform=facebook`
          : `${baseUrl}/facebook/pages?session=${result.sessionId}`;
        const res = NextResponse.redirect(target, { status: 302 });
        clearStateCookie(res);
        clearPkceCookie(res);
        return res;
      }
      const target = embedded
        ? `${baseUrl}/oauth/complete?session=${result.sessionId}&kind=confirm&platform=${result.platform}`
        : `${baseUrl}/confirm/${result.platform}?session=${result.sessionId}`;
      const res = NextResponse.redirect(target, { status: 302 });
      clearStateCookie(res);
      clearPkceCookie(res);
      return res;
    } catch (err) {
      return failRedirect(err instanceof Error ? err.message : String(err));
    }
  }

  return new NextResponse(`Unknown action: ${action}`, { status: 404 });
}
