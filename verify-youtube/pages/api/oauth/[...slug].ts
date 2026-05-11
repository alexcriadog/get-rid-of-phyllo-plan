// OAuth dispatcher for verify-youtube.
//
//   GET /api/oauth/start/youtube     → 302 to Google authorize URL
//   GET /api/oauth/callback/youtube  → exchange code, persist session,
//                                      redirect to /verified/{session}
//
// Anything else is 404. We intentionally don't support other platforms
// here — this app is YouTube-only by design.

import type { NextApiRequest, NextApiResponse } from 'next';
import { publicBaseUrl } from '../../../lib/base-url';
import { putSession } from '../../../lib/session';
import {
  buildAuthorizeUrl,
  exchangeCode,
  describeGoogleError,
} from '../../../lib/youtube';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  const slug = (req.query.slug as string[] | undefined) ?? [];
  if (slug.length !== 2 || slug[1] !== 'youtube') {
    res.status(404).send('Not found');
    return;
  }
  const action = slug[0];

  const baseUrl = publicBaseUrl(
    req.headers as Record<string, string | string[] | undefined>,
  );
  const redirectUri =
    (process.env.GOOGLE_REDIRECT_URI && process.env.GOOGLE_REDIRECT_URI.length > 0
      ? process.env.GOOGLE_REDIRECT_URI
      : `${baseUrl}/api/oauth/callback/youtube`);

  if (action === 'start') {
    try {
      const url = buildAuthorizeUrl(redirectUri);
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
        `/?error=${encodeURIComponent(`Google denied: ${error}${desc ? ` — ${desc}` : ''}`)}`,
      );
      return;
    }
    const code = req.query.code;
    if (typeof code !== 'string' || !code) {
      res.redirect(
        302,
        `/?error=${encodeURIComponent('Callback missing ?code')}`,
      );
      return;
    }
    try {
      const tokens = await exchangeCode(code, redirectUri);
      const sessionId = putSession({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
      });
      res.redirect(302, `/verified/${sessionId}`);
    } catch (err) {
      res.redirect(
        302,
        `/?error=${encodeURIComponent(describeGoogleError(err))}`,
      );
    }
    return;
  }

  res.status(404).send(`Unknown action: ${action}`);
}
