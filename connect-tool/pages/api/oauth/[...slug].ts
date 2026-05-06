// Single dispatcher for OAuth routes.
//
//   GET /api/oauth/start/{platform}     → 302 to platform authorize URL
//   GET /api/oauth/callback/{platform}  → exchange code, seed POC, redirect
//
// Each platform's logic lives in lib/platforms.ts. This file is just routing
// and error handling.

import type { NextApiRequest, NextApiResponse } from 'next';
import { PLATFORMS, type PlatformKey } from '../../../lib/platforms';
import { publicBaseUrl } from '../../../lib/seed-client';

const VALID_PLATFORMS = new Set<PlatformKey>([
  'facebook',
  'tiktok',
  'threads',
  'youtube',
]);

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
      const result = await PLATFORMS[platform].handleCallback(code, redirectUri);
      if (result.kind === 'fb-picker') {
        res.redirect(302, `/facebook/pages?session=${result.sessionId}`);
        return;
      }
      // TikTok / Threads / YouTube — operator still needs to confirm
      // products before we POST to the POC seed endpoint.
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
    default:
      return `${baseUrl}/api/oauth/callback/${platform}`;
  }
}
