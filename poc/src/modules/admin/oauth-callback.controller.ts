// Public OAuth flow for YouTube. Two routes:
//   GET /oauth/start/youtube     → 302 to Google's authorize URL
//   GET /oauth/callback/youtube  → exchange code (Google returns here), render
//                                  a tiny HTML page with the connected channel
//
// The redirect_uri configured in Google Cloud Console must be exactly
// `${GOOGLE_REDIRECT_URI}` (defaults to http://localhost:3000/oauth/callback/youtube).
//
// All heavy lifting (URL build, code exchange, account seeding, sync_jobs
// creation) is delegated to AdminService — same path the manual two-call
// admin endpoints use.

import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AdminService } from './admin.service';

interface CompleteResult {
  seeded?: { account_id: string; sync_jobs_created: string[] };
  youtube_account?: {
    channel_id: string;
    handle: string | null;
    title: string;
    description: string;
    thumbnail_url: string | null;
    subscriber_count: number | null;
    video_count: number | null;
    view_count: number | null;
    country: string | null;
    uploads_playlist_id: string | null;
    already_connected: boolean;
  };
  warnings?: string[];
}

@Controller()
export class OauthCallbackController {
  private readonly logger = new Logger(OauthCallbackController.name);

  constructor(private readonly admin: AdminService) {}

  @Get('oauth/start/youtube')
  startYoutube(
    @Query('include_monetary') includeMonetary: string | undefined,
    @Res() res: Response,
  ): void {
    const monetary = includeMonetary === undefined || includeMonetary === 'true';
    const { url } = this.admin.youtubeAuthorizeUrl(monetary);
    res.redirect(302, url);
  }

  @Get('oauth/callback/youtube')
  async callbackYoutube(
    @Query('code') code: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    res.type('html');

    if (error) {
      res.status(400).send(renderError(`Google denied the request: ${error}`));
      return;
    }
    if (!code) {
      res.status(400).send(renderError('Missing ?code parameter from Google.'));
      return;
    }

    try {
      const result = (await this.admin.youtubeCompleteOAuth(code)) as CompleteResult;
      res.status(200).send(renderSuccess(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`youtube oauth callback failed: ${message}`);
      res.status(500).send(renderError(message));
    }
  }
}

function renderSuccess(result: CompleteResult): string {
  const acct = result.youtube_account;
  const seeded = result.seeded;
  const warnings = result.warnings ?? [];
  const thumb = acct?.thumbnail_url
    ? `<img src="${escapeAttr(acct.thumbnail_url)}" alt="" width="96" height="96" />`
    : '';
  const stats = acct
    ? `
      <dl>
        <dt>Channel ID</dt><dd><code>${escapeText(acct.channel_id)}</code></dd>
        <dt>Handle</dt><dd>${escapeText(acct.handle ?? '—')}</dd>
        <dt>Subscribers</dt><dd>${acct.subscriber_count ?? '—'}</dd>
        <dt>Videos</dt><dd>${acct.video_count ?? '—'}</dd>
        <dt>Total views</dt><dd>${acct.view_count ?? '—'}</dd>
        <dt>Uploads playlist</dt><dd><code>${escapeText(acct.uploads_playlist_id ?? '—')}</code></dd>
      </dl>`
    : '';
  const seededLine = seeded
    ? `<p>Seeded account <code>${escapeText(seeded.account_id)}</code> with ${seeded.sync_jobs_created.length} sync job(s): <code>${seeded.sync_jobs_created.map(escapeText).join(', ')}</code></p>`
    : '';
  const alreadyBadge = acct?.already_connected
    ? '<p><strong>Note:</strong> this channel was already connected — token refreshed.</p>'
    : '';
  const warningBlock =
    warnings.length > 0
      ? `<h3>Warnings</h3><ul>${warnings.map((w) => `<li>${escapeText(w)}</li>`).join('')}</ul>`
      : '';

  return shell(
    `Connected ${escapeText(acct?.title ?? 'YouTube channel')}`,
    `
    <h1>YouTube channel connected</h1>
    <div class="card">
      ${thumb}
      <div>
        <h2>${escapeText(acct?.title ?? 'Unknown channel')}</h2>
        <p class="muted">${escapeText(acct?.description ?? '').slice(0, 240)}</p>
      </div>
    </div>
    ${stats}
    ${seededLine}
    ${alreadyBadge}
    ${warningBlock}
    <p><a href="/oauth/start/youtube">Connect another YouTube channel</a></p>
    `,
  );
}

function renderError(message: string): string {
  return shell(
    'YouTube connection failed',
    `
    <h1>YouTube connection failed</h1>
    <pre>${escapeText(message)}</pre>
    <p><a href="/oauth/start/youtube">Try again</a></p>
    `,
  );
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeText(title)}</title>
  <style>
    :root { color-scheme: light dark; }
    body { font: 16px/1.5 -apple-system, system-ui, sans-serif; max-width: 640px; margin: 3rem auto; padding: 0 1.5rem; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; }
    h2 { font-size: 1.15rem; margin: 0; }
    .card { display: flex; gap: 1rem; align-items: center; padding: 1rem; border: 1px solid color-mix(in oklch, currentColor 20%, transparent); border-radius: 12px; margin-bottom: 1.5rem; }
    .card img { border-radius: 50%; flex-shrink: 0; }
    .muted { color: color-mix(in oklch, currentColor 65%, transparent); margin: 0.25rem 0 0; font-size: 0.9rem; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.5rem 1.5rem; margin: 1.5rem 0; }
    dt { font-weight: 600; }
    dd { margin: 0; }
    code { font-size: 0.9em; }
    pre { padding: 1rem; background: color-mix(in oklch, currentColor 8%, transparent); border-radius: 8px; white-space: pre-wrap; word-break: break-word; }
    a { color: inherit; }
  </style>
</head>
<body>
  ${body}
</body>
</html>`;
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: string): string {
  return escapeText(value);
}
