// Single dispatcher for OAuth routes.
//
//   GET /api/oauth/start/{platform}     → 302 to platform authorize URL
//   GET /api/oauth/callback/{platform}  → exchange code, seed POC, redirect
//
// Each platform's logic lives in lib/platforms.ts. This file is just routing
// and error handling.

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  PLATFORMS,
  type CallbackResult,
  type PlatformKey,
} from '../../../lib/platforms';
import { publicBaseUrl } from '../../../lib/seed-client';
import { putSession } from '../../../lib/session';
import {
  setContextCookie,
  verifySdkToken,
} from '../../../lib/oauth-context';

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
// Anchored on globalThis because Next.js standalone bundles API routes
// into a separate webpack chunk — a module-level Map would be duplicated
// across bundles (same trick session.ts uses).
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  const slug = (req.query.slug as string[] | undefined) ?? [];
  if (slug.length !== 2) {
    res.status(404).send('Not found');
    return;
  }
  const [action, rawPlatform] = slug;
  const platform = rawPlatform as PlatformKey;
  if (!VALID_PLATFORMS.has(platform)) {
    res.status(404).send(`Unknown platform: ${rawPlatform}`);
    return;
  }

  const baseUrl = publicBaseUrl(
    req.headers as Record<string, string | string[] | undefined>,
  );
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
    const ws = typeof req.query.ws === 'string' ? req.query.ws : null;
    const token = typeof req.query.token === 'string' ? req.query.token : null;
    if (ws && token) {
      try {
        const claims = await verifySdkToken(token);
        // The JWT carries the workspace ID (claims.ws) and slug (claims.ws_slug);
        // the popup URL only carries the slug. Compare slugs.
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
        const origin = typeof req.query.origin === 'string'
          ? req.query.origin
          : undefined;
        const contextSessionId = putSession({
          kind: 'oauth-context',
          workspaceId: claims.ws,
          workspaceSlug: ws,
          endUserId: claims.sub,
          allowedPlatforms: claims.platforms,
          environment: claims.env,
          openerOrigin: origin,
        });
        setContextCookie(res, contextSessionId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.redirect(302, `/?error=${encodeURIComponent(message)}`);
        return;
      }
    }

    try {
      const url = PLATFORMS[platform].buildAuthorizeUrl(redirectUri);
      res.redirect(302, url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.redirect(302, `/?error=${encodeURIComponent(message)}`);
    }
    return;
  }

  if (action === 'callback') {
    const error = req.query.error;
    if (typeof error === 'string') {
      const desc = req.query.error_description ?? '';
      res.redirect(
        302,
        `/?error=${encodeURIComponent(`${platform} denied: ${error}${desc ? ` — ${desc}` : ''}`)}`,
      );
      return;
    }
    const code = req.query.code;
    if (typeof code !== 'string' || !code) {
      res.redirect(
        302,
        `/?error=${encodeURIComponent(`${platform} callback missing ?code`)}`,
      );
      return;
    }
    try {
      pruneCallbackCache();
      const cacheKey = `${platform}:${code}`;
      let entry = callbackInFlight.get(cacheKey);
      if (!entry) {
        // Wrap the platform handleCallback in a promise that ALWAYS resolves
        // to a tagged result so concurrent duplicates can read the same
        // outcome (success OR error) without re-running the exchange.
        const promise = PLATFORMS[platform].handleCallback(code, redirectUri);
        entry = {
          promise,
          clearAt: Date.now() + CALLBACK_CACHE_TTL_MS,
        };
        callbackInFlight.set(cacheKey, entry);
      }
      const result = await entry.promise;
      if (result.kind === 'fb-picker') {
        res.redirect(302, `/facebook/pages?session=${result.sessionId}`);
        return;
      }
      // TikTok / Threads / YouTube / Twitch — operator still needs to
      // confirm products before we POST to the POC seed endpoint.
      res.redirect(
        302,
        `/confirm/${result.platform}?session=${result.sessionId}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.redirect(302, `/?error=${encodeURIComponent(message)}`);
    }
    return;
  }

  res.status(404).send(`Unknown action: ${action}`);
}

function redirectUriFor(platform: PlatformKey, baseUrl: string): string {
  // Empty string in .env (e.g. `META_REDIRECT_URI=`) loads as `""`, which
  // ?? does NOT fall through. Coerce to undefined so the baseUrl fallback
  // takes over.
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
