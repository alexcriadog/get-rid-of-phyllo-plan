// All 5 OAuth flows in one file. Each platform exposes:
//   - buildAuthorizeUrl(redirectUri) → string (302 target)
//   - handleCallback(code, redirectUri) → CallbackResult
//
// The dispatcher in pages/api/oauth/[...slug].ts maps a URL slug like
// "start/youtube" or "callback/facebook" onto these functions.

import axios from 'axios';
import { type SeedBody } from './seed-client';
import { putSession, type FbPageInSession } from './session';

const META_GRAPH = 'https://graph.facebook.com/v22.0';
const THREADS_GRAPH = 'https://graph.threads.net/v1.0';
const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const YOUTUBE_DATA = 'https://www.googleapis.com/youtube/v3';
// TikTok offers two parallel OAuth flows:
//   1. BC / Marketing API (business-api.tiktok.com/portal/auth) — for ad
//      accounts. Requires the user to have at least one Advertiser
//      account, which most personal creators don't.
//   2. User-flow / Login Kit (tiktok.com/v2/auth/authorize) — for
//      creators / personal accounts. Returns `open_id` which our POC
//      adapter requires in `metadata.open_id` to call the user-scoped
//      endpoints (/v2/user/info/, /v2/video/list/, etc.).
// We use the user-flow here so creator accounts work; the POC adapter
// already targets the v2 user-scoped endpoints.
const TIKTOK_AUTHORIZE = 'https://www.tiktok.com/v2/auth/authorize';
const TIKTOK_TOKEN = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_USER_INFO = 'https://open.tiktokapis.com/v2/user/info/';
const META_AUTHORIZE = 'https://www.facebook.com/v22.0/dialog/oauth';
// Meta moved the Threads authorize host to www. in late 2025; the bare
// host now redirects but some App settings still reject it as a mismatch.
const THREADS_AUTHORIZE = 'https://www.threads.net/oauth/authorize';
const THREADS_TOKEN = 'https://graph.threads.net/oauth/access_token';
const THREADS_LL_TOKEN = 'https://graph.threads.net/access_token';

const FB_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
  'ads_read',
  'business_management',
  'instagram_basic',
  'instagram_manage_insights',
  // read_insights is NOT deprecated despite the v22 rebrand — Meta
  // still requires it for /post/insights on Pages where the OAuth
  // user is not the page owner (BC-managed agency pages most
  // commonly). Without it /post/insights returns 200 with `data:[]`.
  'read_insights',
];

const YT_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
];

// User-flow scopes (Login Kit). Approved scopes only — extras like
// `biz.brand.insights` or `discovery.search.words` need separate review
// and would block the consent screen if the app isn't approved for them.
const TIKTOK_SCOPES = [
  'user.info.basic',
  'user.info.profile',
  'user.info.stats',
  'user.account.type',
  'user.insights',
  'video.list',
  'video.insights',
  'comment.list',
];

// Threads scope catalog as of 2025-2026 (Meta removed `threads_read_likes`
// and reorganised some scopes). `threads_basic` is the only one that
// doesn't require app review; the others may show as not-granted on the
// consent screen if your app isn't approved for them — we still request
// them and let Meta drop the unapproved ones gracefully.
const THREADS_SCOPES = [
  'threads_basic',
  'threads_manage_insights',
  'threads_read_replies',
];

export type PlatformKey =
  | 'facebook'
  | 'instagram'
  | 'tiktok'
  | 'threads'
  | 'youtube';

export type CallbackResult =
  | {
      kind: 'fb-picker';
      sessionId: string;
      pages: Array<{
        id: string;
        name: string;
        ig_business_account_id: string | null;
      }>;
    }
  | {
      // TikTok/Threads/YouTube: token + account info captured. Operator
      // still needs to pick which products to enable on the
      // /confirm/{platform} page before we POST to the POC.
      kind: 'confirm';
      platform: PlatformKey;
      sessionId: string;
      preview: {
        handle?: string;
        name?: string;
        extras?: Record<string, unknown>;
      };
    };

interface PlatformDef {
  key: PlatformKey;
  buildAuthorizeUrl(redirectUri: string): string;
  handleCallback(code: string, redirectUri: string): Promise<CallbackResult>;
}

// ─── Facebook (covers Instagram via Page picker) ───────────────────────

const facebook: PlatformDef = {
  key: 'facebook',
  buildAuthorizeUrl(redirectUri) {
    const appId = requireEnv('META_APP_ID');
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: FB_SCOPES.join(','),
      state: cryptoRandomState(),
    });
    return `${META_AUTHORIZE}?${params.toString()}`;
  },
  async handleCallback(code, redirectUri) {
    const appId = requireEnv('META_APP_ID');
    const appSecret = requireEnv('META_APP_SECRET');
    // Short-lived user token.
    const slRes = await axios.get<{
      access_token: string;
      expires_in?: number;
    }>(`${META_GRAPH}/oauth/access_token`, {
      params: {
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
        code,
      },
      timeout: 15_000,
    });
    const userTokenShort = slRes.data.access_token;

    // Long-lived user token (60d) so subsequent /me/accounts calls don't lapse.
    const llRes = await axios.get<{ access_token: string; expires_in?: number }>(
      `${META_GRAPH}/oauth/access_token`,
      {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: userTokenShort,
        },
        timeout: 15_000,
      },
    );
    const userToken = llRes.data.access_token;

    // Discover Pages.
    const pagesRes = await axios.get<{ data: FbPageInSession[] }>(
      `${META_GRAPH}/me/accounts`,
      {
        params: {
          fields: 'id,name,access_token,instagram_business_account{id}',
          limit: 100,
          access_token: userToken,
        },
        timeout: 15_000,
      },
    );
    const pages = pagesRes.data.data ?? [];
    if (pages.length === 0) {
      throw new Error(
        'This Facebook user manages no Pages. Connect with an account that admins at least one Page.',
      );
    }

    const sessionId = putSession({ kind: 'fb', userToken, pages });
    return {
      kind: 'fb-picker',
      sessionId,
      pages: pages.map((p) => ({
        id: p.id,
        name: p.name,
        ig_business_account_id: p.instagram_business_account?.id ?? null,
      })),
    };
  },
};

// ─── YouTube ───────────────────────────────────────────────────────────

const youtube: PlatformDef = {
  key: 'youtube',
  buildAuthorizeUrl(redirectUri) {
    const clientId = requireEnv('GOOGLE_CLIENT_ID');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      scope: YT_SCOPES.join(' '),
    });
    return `${GOOGLE_AUTHORIZE}?${params.toString()}`;
  },
  async handleCallback(code, redirectUri) {
    const clientId = requireEnv('GOOGLE_CLIENT_ID');
    const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');
    const params = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    const tokenRes = await axios.post<{
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    }>(GOOGLE_TOKEN, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15_000,
    });
    const accessToken = tokenRes.data.access_token;
    const refreshToken = tokenRes.data.refresh_token;
    const expiresAt = tokenRes.data.expires_in
      ? new Date(Date.now() + tokenRes.data.expires_in * 1000).toISOString()
      : undefined;
    const scopes = tokenRes.data.scope ? tokenRes.data.scope.split(' ') : undefined;

    const chRes = await axios.get<{
      items?: Array<{
        id: string;
        snippet?: { title?: string; customUrl?: string; country?: string };
        contentDetails?: { relatedPlaylists?: { uploads?: string } };
      }>;
    }>(`${YOUTUBE_DATA}/channels`, {
      params: { part: 'id,snippet,contentDetails', mine: true },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15_000,
    });
    const ch = chRes.data.items?.[0];
    if (!ch) throw new Error('Google returned no channels for this user.');

    const seedBody: SeedBody = {
      platform: 'youtube',
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      canonical_user_id: ch.id,
      handle:
        ch.snippet?.customUrl?.replace(/^@/, '') ?? ch.snippet?.title,
      metadata: {
        channel_id: ch.id,
        uploads_playlist_id: ch.contentDetails?.relatedPlaylists?.uploads,
        country: ch.snippet?.country,
        scopes,
      },
    };
    const handle =
      ch.snippet?.customUrl?.replace(/^@/, '') ?? ch.snippet?.title;
    const sessionId = putSession({
      kind: 'simple',
      platform: 'youtube',
      seedBody,
      preview: {
        handle,
        name: ch.snippet?.title,
        extras: { channel_id: ch.id, country: ch.snippet?.country },
      },
    });
    return {
      kind: 'confirm',
      platform: 'youtube',
      sessionId,
      preview: {
        handle,
        name: ch.snippet?.title,
        extras: { channel_id: ch.id, country: ch.snippet?.country },
      },
    };
  },
};

// ─── TikTok user-flow (Login Kit / Display API) ────────────────────────

const tiktok: PlatformDef = {
  key: 'tiktok',
  buildAuthorizeUrl(redirectUri) {
    const clientKey = requireEnv('TIKTOK_CLIENT_KEY');
    const params = new URLSearchParams({
      client_key: clientKey,
      response_type: 'code',
      scope: TIKTOK_SCOPES.join(','),
      redirect_uri: redirectUri,
      state: cryptoRandomState(),
    });
    return `${TIKTOK_AUTHORIZE}?${params.toString()}`;
  },
  async handleCallback(code, redirectUri) {
    const clientKey = requireEnv('TIKTOK_CLIENT_KEY');
    const clientSecret = requireEnv('TIKTOK_CLIENT_SECRET');

    // Token exchange — user-flow uses form-urlencoded body, not JSON.
    const body = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    const tokenRes = await axios.post<{
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      refresh_expires_in?: number;
      open_id?: string;
      scope?: string;
      token_type?: string;
      error?: string;
      error_description?: string;
    }>(TIKTOK_TOKEN, body.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      timeout: 15_000,
    });

    const t = tokenRes.data;
    if (!t.access_token || !t.open_id) {
      const msg =
        t.error_description || t.error || 'no access_token / open_id in response';
      throw new Error(`TikTok exchange failed: ${msg}`);
    }

    // Best-effort profile fetch — /v2/user/info/ takes a `fields` query.
    let username: string | undefined;
    let displayName: string | undefined;
    let avatarUrl: string | undefined;
    try {
      const infoRes = await axios.get<{
        data?: {
          user?: {
            open_id?: string;
            union_id?: string;
            avatar_url?: string;
            display_name?: string;
            username?: string;
          };
        };
      }>(TIKTOK_USER_INFO, {
        params: {
          fields: 'open_id,union_id,avatar_url,display_name,username',
        },
        headers: { Authorization: `Bearer ${t.access_token}` },
        timeout: 10_000,
      });
      const u = infoRes.data?.data?.user;
      if (u) {
        username = u.username;
        displayName = u.display_name;
        avatarUrl = u.avatar_url;
      }
    } catch {
      // Best-effort.
    }

    const seedBody: SeedBody = {
      platform: 'tiktok',
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: t.expires_in
        ? new Date(Date.now() + t.expires_in * 1000).toISOString()
        : undefined,
      canonical_user_id: t.open_id,
      handle: username ?? displayName,
      // The POC TikTok adapter reads `metadata.open_id` (or business_id)
      // to call /v2/user/info/, /v2/video/list/, /v2/research/comments/,
      // etc. Persist it so the worker can fetch.
      metadata: {
        open_id: t.open_id,
        business_id: t.open_id,
        avatar_url: avatarUrl,
        scopes: t.scope ? t.scope.split(',') : undefined,
        refresh_expires_at: t.refresh_expires_in
          ? new Date(Date.now() + t.refresh_expires_in * 1000).toISOString()
          : undefined,
      },
    };
    const sessionId = putSession({
      kind: 'simple',
      platform: 'tiktok',
      seedBody,
      preview: {
        handle: username,
        name: displayName,
        extras: { open_id: t.open_id, scope: t.scope },
      },
    });
    return {
      kind: 'confirm',
      platform: 'tiktok',
      sessionId,
      preview: {
        handle: username,
        name: displayName,
        extras: { open_id: t.open_id, scope: t.scope },
      },
    };
  },
};

// ─── Threads ───────────────────────────────────────────────────────────

const threads: PlatformDef = {
  key: 'threads',
  buildAuthorizeUrl(redirectUri) {
    const appId = requireEnv('THREADS_APP_ID');
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: THREADS_SCOPES.join(','),
      state: cryptoRandomState(),
    });
    return `${THREADS_AUTHORIZE}?${params.toString()}`;
  },
  async handleCallback(code, redirectUri) {
    const appId = requireEnv('THREADS_APP_ID');
    const appSecret = requireEnv('THREADS_APP_SECRET');
    const params = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    });
    const slRes = await axios.post<{
      access_token: string;
      user_id: string | number;
    }>(THREADS_TOKEN, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15_000,
    });
    const shortLived = slRes.data.access_token;
    const userId = String(slRes.data.user_id);

    const llRes = await axios.get<{ access_token: string; expires_in?: number }>(
      THREADS_LL_TOKEN,
      {
        params: {
          grant_type: 'th_exchange_token',
          client_secret: appSecret,
          access_token: shortLived,
        },
        timeout: 15_000,
      },
    );
    const longLived = llRes.data.access_token;
    const expiresAt = llRes.data.expires_in
      ? new Date(Date.now() + llRes.data.expires_in * 1000).toISOString()
      : undefined;

    let username: string | undefined;
    try {
      const meRes = await axios.get<{
        id: string;
        username?: string;
        name?: string;
      }>(`${THREADS_GRAPH}/me`, {
        params: { fields: 'id,username,name', access_token: longLived },
        timeout: 10_000,
      });
      username = meRes.data.username ?? meRes.data.name;
    } catch {
      // Best-effort.
    }

    const seedBody: SeedBody = {
      platform: 'threads',
      access_token: longLived,
      expires_at: expiresAt,
      canonical_user_id: userId,
      handle: username,
      metadata: { user_id: userId, scopes: THREADS_SCOPES },
    };
    const sessionId = putSession({
      kind: 'simple',
      platform: 'threads',
      seedBody,
      preview: { handle: username, extras: { user_id: userId } },
    });
    return {
      kind: 'confirm',
      platform: 'threads',
      sessionId,
      preview: { handle: username, extras: { user_id: userId } },
    };
  },
};

// Instagram has no direct OAuth — see /api/seed-pages for the FB→IG handoff.
const instagram: PlatformDef = {
  key: 'instagram',
  buildAuthorizeUrl() {
    throw new Error(
      'Instagram is connected via Facebook OAuth. Use /api/oauth/start/facebook.',
    );
  },
  async handleCallback() {
    throw new Error(
      'Instagram callback is not direct — it goes through the Facebook page picker.',
    );
  },
};

export const PLATFORMS: Record<PlatformKey, PlatformDef> = {
  facebook,
  instagram,
  tiktok,
  threads,
  youtube,
};

/**
 * Build seed bodies for one chosen FB Page (and optionally its IG business
 * account). Used by /api/seed-pages after the operator picks Pages from
 * the FB picker UI.
 */
export function buildFacebookSeeds(
  page: FbPageInSession,
  userToken: string,
  includeInstagram: boolean,
): SeedBody[] {
  const out: SeedBody[] = [];
  out.push({
    platform: 'facebook',
    access_token: page.access_token,
    canonical_user_id: page.id,
    handle: page.name,
    metadata: {
      page_id: page.id,
      // The user_token enables ads_read calls from the worker. The POC's
      // seedAccount persists it in oauth_tokens.user_access_token_ciphertext.
      user_access_token: userToken,
    },
  });
  if (includeInstagram && page.instagram_business_account?.id) {
    out.push({
      platform: 'instagram',
      access_token: page.access_token, // IG uses the Page token
      canonical_user_id: page.instagram_business_account.id,
      handle: page.name,
      metadata: {
        page_id: page.id,
        ig_business_account_id: page.instagram_business_account.id,
      },
    });
  }
  return out;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is not configured for connect-tool. Set it in connect-tool/.env.`,
    );
  }
  return v;
}

function cryptoRandomState(): string {
  // crypto.randomUUID is available on Node 16+ in both Node and Edge runtimes.
  // Cast for older @types/node.
  return (globalThis.crypto as Crypto).randomUUID();
}
