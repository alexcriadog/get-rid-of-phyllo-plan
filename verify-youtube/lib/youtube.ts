// All Google/YouTube HTTP calls used by the verification flow.
//
//   - buildAuthorizeUrl: builds the consent URL with the six scopes
//   - exchangeCode:      exchanges authorization code for tokens
//   - fetchUserinfo:     OIDC userinfo (openid + userinfo.email/profile)
//   - fetchChannel:      youtube.readonly demo
//   - fetchViews7d:      yt-analytics.readonly demo
//   - fetchRevenue7d:    yt-analytics-monetary.readonly demo

import axios, { AxiosError } from 'axios';

const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';
const YOUTUBE_DATA = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_ANALYTICS = 'https://youtubeanalytics.googleapis.com/v2';

export const YT_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  // Google Ads — lets us read the connected user's video campaign metrics.
  // Requires GOOGLE_ADS_DEVELOPER_TOKEN to actually make API calls.
  'https://www.googleapis.com/auth/adwords',
] as const;

// ─── Authorize URL ─────────────────────────────────────────────────────

export function buildAuthorizeUrl(redirectUri: string): string {
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  // include_granted_scopes is intentionally OMITTED here. We share this
  // OAuth client with connect-tool (smconnector), which requests a
  // different scope set. If `include_granted_scopes=true` were set, the
  // consent screen would show the UNION of what verify-youtube asks for
  // and whatever the user previously granted via connect-tool — leaking
  // scopes we are not actually verifying. Keep the consent screen
  // exactly equal to YT_SCOPES.
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    access_type: 'offline',
    prompt: 'consent',
    scope: YT_SCOPES.join(' '),
  });
  return `${GOOGLE_AUTHORIZE}?${params.toString()}`;
}

// ─── Code exchange ─────────────────────────────────────────────────────

export interface ExchangedTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scopes?: string[];
}

export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<ExchangedTokens> {
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');
  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await axios.post<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  }>(GOOGLE_TOKEN, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15_000,
  });
  return {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token,
    expiresAt: res.data.expires_in
      ? new Date(Date.now() + res.data.expires_in * 1000).toISOString()
      : undefined,
    scopes: res.data.scope ? res.data.scope.split(' ') : undefined,
  };
}

// ─── OIDC userinfo (openid + userinfo.email + userinfo.profile) ────────

export interface UserInfo {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  picture?: string;
  locale?: string;
}

export async function fetchUserinfo(accessToken: string): Promise<UserInfo> {
  const res = await axios.get<{
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
    locale?: string;
  }>(GOOGLE_USERINFO, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 10_000,
  });
  return {
    sub: res.data.sub,
    email: res.data.email,
    emailVerified: res.data.email_verified,
    name: res.data.name,
    picture: res.data.picture,
    locale: res.data.locale,
  };
}

// ─── youtube.readonly: channel snapshot ────────────────────────────────

export interface ChannelSnapshot {
  id: string;
  title?: string;
  customUrl?: string;
  country?: string;
  thumbnailUrl?: string;
  subscriberCount?: string;
  videoCount?: string;
  viewCount?: string;
  uploadsPlaylistId?: string;
}

export async function fetchChannel(
  accessToken: string,
): Promise<ChannelSnapshot | null> {
  const res = await axios.get<{
    items?: Array<{
      id: string;
      snippet?: {
        title?: string;
        customUrl?: string;
        country?: string;
        thumbnails?: { default?: { url?: string }; medium?: { url?: string } };
      };
      statistics?: {
        viewCount?: string;
        subscriberCount?: string;
        videoCount?: string;
      };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
    }>;
  }>(`${YOUTUBE_DATA}/channels`, {
    params: { part: 'snippet,statistics,contentDetails', mine: true },
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15_000,
  });
  const ch = res.data.items?.[0];
  if (!ch) return null;
  const thumb =
    ch.snippet?.thumbnails?.medium?.url ?? ch.snippet?.thumbnails?.default?.url;
  return {
    id: ch.id,
    title: ch.snippet?.title,
    customUrl: ch.snippet?.customUrl,
    country: ch.snippet?.country,
    thumbnailUrl: thumb,
    subscriberCount: ch.statistics?.subscriberCount,
    videoCount: ch.statistics?.videoCount,
    viewCount: ch.statistics?.viewCount,
    uploadsPlaylistId: ch.contentDetails?.relatedPlaylists?.uploads,
  };
}

// ─── yt-analytics.readonly: views last 7 days, per day ─────────────────

export interface ViewsByDay {
  rows: Array<{ day: string; views: number }>;
  totalViews: number;
}

export async function fetchViews7d(accessToken: string): Promise<ViewsByDay> {
  const { startDate, endDate } = lastNDays(7);
  const res = await axios.get<{
    rows?: Array<[string, number]>;
    columnHeaders?: Array<{ name: string }>;
  }>(`${YOUTUBE_ANALYTICS}/reports`, {
    params: {
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics: 'views',
      dimensions: 'day',
      sort: 'day',
    },
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15_000,
  });
  const rows = (res.data.rows ?? []).map(([day, views]) => ({
    day: String(day),
    views: Number(views ?? 0),
  }));
  const totalViews = rows.reduce((acc, r) => acc + r.views, 0);
  return { rows, totalViews };
}

// ─── helpers ──────────────────────────────────────────────────────────

function lastNDays(n: number): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end.getTime() - n * 24 * 60 * 60 * 1000);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is not configured for verify-youtube. Set it in verify-youtube/.env.`,
    );
  }
  return v;
}

/** Friendly error extractor for Google API responses. */
export function describeGoogleError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const ax = err as AxiosError<{
      error?: string | { message?: string };
      error_description?: string;
    }>;
    const data = ax.response?.data;
    if (data) {
      if (typeof data.error === 'string') {
        return `${data.error}${data.error_description ? ` — ${data.error_description}` : ''}`;
      }
      if (data.error && typeof data.error === 'object' && data.error.message) {
        return data.error.message;
      }
    }
    return ax.message;
  }
  return err instanceof Error ? err.message : String(err);
}
