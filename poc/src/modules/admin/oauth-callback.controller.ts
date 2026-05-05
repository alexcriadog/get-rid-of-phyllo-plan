// Public OAuth flow for YouTube. Two routes:
//   GET /oauth/start/youtube     → 302 to Google's authorize URL
//   GET /oauth/callback/youtube  → exchanges the code (Google returns here),
//                                  then 302 → admin UI with the result encoded
//                                  as query params, so the admin page renders
//                                  the confirmation in its own design system.
//
// The redirect_uri configured in Google Cloud Console must match
// `${GOOGLE_REDIRECT_URI}` (defaults to http://localhost:3000/oauth/callback/youtube).
//
// The post-exchange redirect target is `${ADMIN_UI_BASE_URL}/admin/connect`
// (defaults to http://localhost:3001 — the Next dev port). In prod, set
// ADMIN_UI_BASE_URL to wherever the admin UI is reverse-proxied.

import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppConfigService } from '@shared/config/config.module';
import { AdminService } from './admin.service';

interface CompleteResult {
  seeded?: { account_id: string; sync_jobs_created: string[] };
  youtube_account?: {
    channel_id: string;
    handle: string | null;
    title: string;
    subscriber_count: number | null;
    video_count: number | null;
    view_count: number | null;
    already_connected: boolean;
  };
  warnings?: string[];
}

@Controller()
export class OauthCallbackController {
  private readonly logger = new Logger(OauthCallbackController.name);

  constructor(
    private readonly admin: AdminService,
    private readonly config: AppConfigService,
  ) {}

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
    if (error) {
      this.redirectBack(res, {
        yt: 'error',
        message: `Google denied the request: ${error}`,
      });
      return;
    }
    if (!code) {
      this.redirectBack(res, {
        yt: 'error',
        message: 'Missing ?code parameter from Google.',
      });
      return;
    }

    try {
      const result = (await this.admin.youtubeCompleteOAuth(code)) as CompleteResult;
      const acct = result.youtube_account;
      this.redirectBack(res, {
        yt: 'success',
        account_id: result.seeded?.account_id ?? '',
        channel_id: acct?.channel_id ?? '',
        handle: acct?.handle ?? '',
        title: acct?.title ?? '',
        subs: acct?.subscriber_count ?? '',
        videos: acct?.video_count ?? '',
        views: acct?.view_count ?? '',
        already_connected: acct?.already_connected ? '1' : '0',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`youtube oauth callback failed: ${message}`);
      this.redirectBack(res, { yt: 'error', message });
    }
  }

  private redirectBack(
    res: Response,
    params: Record<string, string | number | boolean>,
  ): void {
    const adminUrl =
      this.config.get<string>('ADMIN_UI_BASE_URL', 'http://localhost:3001') ??
      'http://localhost:3001';
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ).toString();
    res.redirect(302, `${adminUrl}/admin/connect?${qs}`);
  }
}
