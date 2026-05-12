// All Google / YouTube HTTP calls used by the verification flow.
//
// Organised in three layers:
//   1. OAuth     — buildAuthorizeUrl, exchangeCode.
//   2. OIDC      — fetchUserinfo.
//   3. YouTube Data API v3       — fetchChannel + everything channel-related.
//   4. YouTube Analytics API v2  — fetchViews7d + the full analytics surface.

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
  givenName?: string;
  familyName?: string;
  picture?: string;
  locale?: string;
  /** Workspace hosted-domain — set when the account belongs to a Google
   *  Workspace org. Lets us distinguish business from personal Gmail. */
  hd?: string;
}

export async function fetchUserinfo(accessToken: string): Promise<UserInfo> {
  const res = await axios.get<{
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    given_name?: string;
    family_name?: string;
    picture?: string;
    locale?: string;
    hd?: string;
  }>(GOOGLE_USERINFO, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 10_000,
  });
  return {
    sub: res.data.sub,
    email: res.data.email,
    emailVerified: res.data.email_verified,
    name: res.data.name,
    givenName: res.data.given_name,
    familyName: res.data.family_name,
    picture: res.data.picture,
    locale: res.data.locale,
    hd: res.data.hd,
  };
}

// ─── youtube.readonly: channel snapshot (full) ─────────────────────────

export interface ChannelSnapshot {
  id: string;
  title?: string;
  description?: string;
  customUrl?: string;
  country?: string;
  defaultLanguage?: string;
  publishedAt?: string;
  thumbnailUrl?: string;
  bannerUrl?: string;
  keywords?: string;
  subscriberCount?: string;
  hiddenSubscriberCount?: boolean;
  videoCount?: string;
  viewCount?: string;
  uploadsPlaylistId?: string;
  privacyStatus?: string;
  longUploadsStatus?: string;
  madeForKids?: boolean;
  topicCategories?: string[];
}

export async function fetchChannel(
  accessToken: string,
): Promise<ChannelSnapshot | null> {
  const res = await axios.get<{
    items?: Array<{
      id: string;
      snippet?: {
        title?: string;
        description?: string;
        customUrl?: string;
        country?: string;
        defaultLanguage?: string;
        publishedAt?: string;
        thumbnails?: {
          default?: { url?: string };
          medium?: { url?: string };
          high?: { url?: string };
        };
      };
      statistics?: {
        viewCount?: string;
        subscriberCount?: string;
        hiddenSubscriberCount?: boolean;
        videoCount?: string;
      };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
      brandingSettings?: {
        channel?: { keywords?: string };
        image?: { bannerExternalUrl?: string };
      };
      status?: {
        privacyStatus?: string;
        longUploadsStatus?: string;
        madeForKids?: boolean;
      };
      topicDetails?: { topicCategories?: string[] };
    }>;
  }>(`${YOUTUBE_DATA}/channels`, {
    params: {
      part: 'snippet,statistics,contentDetails,brandingSettings,status,topicDetails',
      mine: true,
    },
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15_000,
  });
  const ch = res.data.items?.[0];
  if (!ch) return null;
  const thumb =
    ch.snippet?.thumbnails?.high?.url ??
    ch.snippet?.thumbnails?.medium?.url ??
    ch.snippet?.thumbnails?.default?.url;
  return {
    id: ch.id,
    title: ch.snippet?.title,
    description: ch.snippet?.description,
    customUrl: ch.snippet?.customUrl,
    country: ch.snippet?.country,
    defaultLanguage: ch.snippet?.defaultLanguage,
    publishedAt: ch.snippet?.publishedAt,
    thumbnailUrl: thumb,
    bannerUrl: ch.brandingSettings?.image?.bannerExternalUrl,
    keywords: ch.brandingSettings?.channel?.keywords,
    subscriberCount: ch.statistics?.subscriberCount,
    hiddenSubscriberCount: ch.statistics?.hiddenSubscriberCount,
    videoCount: ch.statistics?.videoCount,
    viewCount: ch.statistics?.viewCount,
    uploadsPlaylistId: ch.contentDetails?.relatedPlaylists?.uploads,
    privacyStatus: ch.status?.privacyStatus,
    longUploadsStatus: ch.status?.longUploadsStatus,
    madeForKids: ch.status?.madeForKids,
    topicCategories: ch.topicDetails?.topicCategories,
  };
}

// ─── youtube.readonly: recent videos ───────────────────────────────────

export interface VideoSummary {
  id: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  publishedAt?: string;
  duration?: string;
  definition?: string;
  privacyStatus?: string;
  madeForKids?: boolean;
  tags?: string[];
  categoryId?: string;
  defaultLanguage?: string;
  viewCount?: string;
  likeCount?: string;
  commentCount?: string;
  favoriteCount?: string;
}

/**
 * Pulls the most recent N videos from the channel's uploads playlist,
 * then enriches them via `videos.list` (snippet + contentDetails +
 * statistics + status). Returns at most `max` items.
 */
export async function fetchRecentVideos(
  accessToken: string,
  uploadsPlaylistId: string,
  max = 12,
): Promise<VideoSummary[]> {
  const itemsRes = await axios.get<{
    items?: Array<{ contentDetails?: { videoId?: string } }>;
  }>(`${YOUTUBE_DATA}/playlistItems`, {
    params: {
      part: 'contentDetails',
      playlistId: uploadsPlaylistId,
      maxResults: Math.min(max, 50),
    },
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15_000,
  });
  const ids = (itemsRes.data.items ?? [])
    .map((it) => it.contentDetails?.videoId)
    .filter((v): v is string => Boolean(v));
  if (ids.length === 0) return [];

  const vRes = await axios.get<{
    items?: Array<{
      id: string;
      snippet?: {
        title?: string;
        description?: string;
        publishedAt?: string;
        thumbnails?: { medium?: { url?: string }; high?: { url?: string } };
        tags?: string[];
        categoryId?: string;
        defaultLanguage?: string;
      };
      contentDetails?: { duration?: string; definition?: string };
      statistics?: {
        viewCount?: string;
        likeCount?: string;
        commentCount?: string;
        favoriteCount?: string;
      };
      status?: { privacyStatus?: string; madeForKids?: boolean };
    }>;
  }>(`${YOUTUBE_DATA}/videos`, {
    params: {
      part: 'snippet,contentDetails,statistics,status',
      id: ids.join(','),
    },
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15_000,
  });

  return (vRes.data.items ?? []).map((v) => ({
    id: v.id,
    title: v.snippet?.title ?? '(no title)',
    description: v.snippet?.description,
    thumbnailUrl:
      v.snippet?.thumbnails?.medium?.url ?? v.snippet?.thumbnails?.high?.url,
    publishedAt: v.snippet?.publishedAt,
    duration: v.contentDetails?.duration,
    definition: v.contentDetails?.definition,
    privacyStatus: v.status?.privacyStatus,
    madeForKids: v.status?.madeForKids,
    tags: v.snippet?.tags,
    categoryId: v.snippet?.categoryId,
    defaultLanguage: v.snippet?.defaultLanguage,
    viewCount: v.statistics?.viewCount,
    likeCount: v.statistics?.likeCount,
    commentCount: v.statistics?.commentCount,
    favoriteCount: v.statistics?.favoriteCount,
  }));
}

// ─── youtube.readonly: playlists ───────────────────────────────────────

export interface PlaylistSummary {
  id: string;
  title?: string;
  description?: string;
  itemCount?: number;
  privacyStatus?: string;
  publishedAt?: string;
  thumbnailUrl?: string;
}

export async function fetchPlaylists(
  accessToken: string,
  max = 20,
): Promise<PlaylistSummary[]> {
  const res = await axios.get<{
    items?: Array<{
      id: string;
      snippet?: {
        title?: string;
        description?: string;
        publishedAt?: string;
        thumbnails?: { medium?: { url?: string } };
      };
      contentDetails?: { itemCount?: number };
      status?: { privacyStatus?: string };
    }>;
  }>(`${YOUTUBE_DATA}/playlists`, {
    params: {
      part: 'snippet,contentDetails,status',
      mine: true,
      maxResults: Math.min(max, 50),
    },
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15_000,
  });
  return (res.data.items ?? []).map((p) => ({
    id: p.id,
    title: p.snippet?.title,
    description: p.snippet?.description,
    itemCount: p.contentDetails?.itemCount,
    privacyStatus: p.status?.privacyStatus,
    publishedAt: p.snippet?.publishedAt,
    thumbnailUrl: p.snippet?.thumbnails?.medium?.url,
  }));
}

// ─── youtube.readonly: subscriptions ───────────────────────────────────

export interface SubscriptionSummary {
  channelId: string;
  channelTitle?: string;
  description?: string;
  publishedAt?: string;
  thumbnailUrl?: string;
  totalItemCount?: number;
  newItemCount?: number;
}

export async function fetchSubscriptions(
  accessToken: string,
  max = 12,
): Promise<SubscriptionSummary[]> {
  const res = await axios.get<{
    items?: Array<{
      snippet?: {
        title?: string;
        description?: string;
        publishedAt?: string;
        resourceId?: { channelId?: string };
        thumbnails?: { medium?: { url?: string } };
      };
      contentDetails?: { totalItemCount?: number; newItemCount?: number };
    }>;
  }>(`${YOUTUBE_DATA}/subscriptions`, {
    params: {
      part: 'snippet,contentDetails',
      mine: true,
      maxResults: Math.min(max, 50),
      order: 'unread',
    },
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15_000,
  });
  return (res.data.items ?? [])
    .map((s) => ({
      channelId: s.snippet?.resourceId?.channelId ?? '',
      channelTitle: s.snippet?.title,
      description: s.snippet?.description,
      publishedAt: s.snippet?.publishedAt,
      thumbnailUrl: s.snippet?.thumbnails?.medium?.url,
      totalItemCount: s.contentDetails?.totalItemCount,
      newItemCount: s.contentDetails?.newItemCount,
    }))
    .filter((s) => s.channelId);
}

// ─── youtube.readonly: live broadcasts ─────────────────────────────────

export interface BroadcastSummary {
  id: string;
  title?: string;
  description?: string;
  scheduledStartTime?: string;
  actualStartTime?: string;
  actualEndTime?: string;
  lifeCycleStatus?: string;
  privacyStatus?: string;
  recordingStatus?: string;
  thumbnailUrl?: string;
  concurrentViewers?: string;
}

export async function fetchLiveBroadcasts(
  accessToken: string,
  max = 5,
): Promise<BroadcastSummary[]> {
  const res = await axios.get<{
    items?: Array<{
      id: string;
      snippet?: {
        title?: string;
        description?: string;
        scheduledStartTime?: string;
        actualStartTime?: string;
        actualEndTime?: string;
        thumbnails?: { medium?: { url?: string } };
      };
      status?: {
        lifeCycleStatus?: string;
        privacyStatus?: string;
        recordingStatus?: string;
      };
      statistics?: { concurrentViewers?: string };
    }>;
  }>(`${YOUTUBE_DATA}/liveBroadcasts`, {
    params: {
      part: 'snippet,status,statistics',
      mine: true,
      broadcastStatus: 'all',
      maxResults: Math.min(max, 50),
    },
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15_000,
  });
  return (res.data.items ?? []).map((b) => ({
    id: b.id,
    title: b.snippet?.title,
    description: b.snippet?.description,
    scheduledStartTime: b.snippet?.scheduledStartTime,
    actualStartTime: b.snippet?.actualStartTime,
    actualEndTime: b.snippet?.actualEndTime,
    lifeCycleStatus: b.status?.lifeCycleStatus,
    privacyStatus: b.status?.privacyStatus,
    recordingStatus: b.status?.recordingStatus,
    thumbnailUrl: b.snippet?.thumbnails?.medium?.url,
    concurrentViewers: b.statistics?.concurrentViewers,
  }));
}

// ─── youtube.readonly: activities feed ─────────────────────────────────

export interface ActivitySummary {
  id: string;
  type?: string;
  title?: string;
  publishedAt?: string;
  thumbnailUrl?: string;
}

export async function fetchActivities(
  accessToken: string,
  max = 15,
): Promise<ActivitySummary[]> {
  const res = await axios.get<{
    items?: Array<{
      id: string;
      snippet?: {
        type?: string;
        title?: string;
        publishedAt?: string;
        thumbnails?: { default?: { url?: string }; medium?: { url?: string } };
      };
    }>;
  }>(`${YOUTUBE_DATA}/activities`, {
    params: {
      part: 'snippet',
      mine: true,
      maxResults: Math.min(max, 50),
    },
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15_000,
  });
  return (res.data.items ?? []).map((a) => ({
    id: a.id,
    type: a.snippet?.type,
    title: a.snippet?.title,
    publishedAt: a.snippet?.publishedAt,
    thumbnailUrl:
      a.snippet?.thumbnails?.medium?.url ?? a.snippet?.thumbnails?.default?.url,
  }));
}

// ─── youtube.readonly: channel memberships (best-effort) ───────────────

export interface MembershipLevel {
  id: string;
  displayName?: string;
}

export interface ChannelMembershipsSummary {
  /** False when the channel doesn't have YPP memberships enabled — the
   *  API responds 403 channelMembershipsNotEnabled. */
  enabled: boolean;
  levels: MembershipLevel[];
  memberCount: number;
}

export async function fetchMemberships(
  accessToken: string,
): Promise<ChannelMembershipsSummary> {
  try {
    const lvlRes = await axios.get<{
      items?: Array<{
        id: string;
        snippet?: { levelDetails?: { displayName?: string } };
      }>;
    }>(`${YOUTUBE_DATA}/membershipsLevels`, {
      params: { part: 'snippet' },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10_000,
    });
    const levels = (lvlRes.data.items ?? []).map((l) => ({
      id: l.id,
      displayName: l.snippet?.levelDetails?.displayName,
    }));

    // members.list is also gated; if there are no levels, skip.
    let memberCount = 0;
    if (levels.length > 0) {
      const mRes = await axios.get<{
        items?: Array<unknown>;
        pageInfo?: { totalResults?: number };
      }>(`${YOUTUBE_DATA}/members`, {
        params: { part: 'snippet', mode: 'all_current', maxResults: 1 },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10_000,
      });
      memberCount = mRes.data.pageInfo?.totalResults ?? (mRes.data.items?.length ?? 0);
    }
    return { enabled: true, levels, memberCount };
  } catch (err) {
    // 403 channelMembershipsNotEnabled is the most common case — treat as "no".
    if (axios.isAxiosError(err) && err.response?.status === 403) {
      return { enabled: false, levels: [], memberCount: 0 };
    }
    throw err;
  }
}

// ─── yt-analytics.readonly: views by day (last 7d, kept from before) ───

export interface ViewsByDay {
  rows: Array<{ day: string; views: number }>;
  totalViews: number;
}

export async function fetchViews7d(accessToken: string): Promise<ViewsByDay> {
  const { startDate, endDate } = lastNDays(7);
  const res = await axios.get<{
    rows?: Array<[string, number]>;
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
  return { rows, totalViews: rows.reduce((a, r) => a + r.views, 0) };
}

// ─── yt-analytics.readonly: top videos last 28 days ────────────────────

export interface TopVideoRow {
  videoId: string;
  views: number;
  estimatedMinutesWatched: number;
  averageViewDuration: number;
  likes: number;
  comments: number;
  shares: number;
  subscribersGained: number;
}

export async function fetchTopVideos28d(
  accessToken: string,
  max = 10,
): Promise<TopVideoRow[]> {
  const { startDate, endDate } = lastNDays(28);
  const res = await axios.get<{
    rows?: Array<Array<string | number>>;
    columnHeaders?: Array<{ name: string }>;
  }>(`${YOUTUBE_ANALYTICS}/reports`, {
    params: {
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics:
        'views,estimatedMinutesWatched,averageViewDuration,likes,comments,shares,subscribersGained',
      dimensions: 'video',
      sort: '-views',
      maxResults: Math.min(max, 200),
    },
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15_000,
  });
  const headers = (res.data.columnHeaders ?? []).map((h) => h.name);
  const idx = (name: string): number => headers.indexOf(name);
  const num = (row: Array<string | number>, name: string): number => {
    const i = idx(name);
    return i >= 0 ? Number(row[i] ?? 0) : 0;
  };
  return (res.data.rows ?? []).map((row) => ({
    videoId: String(row[idx('video')] ?? ''),
    views: num(row, 'views'),
    estimatedMinutesWatched: num(row, 'estimatedMinutesWatched'),
    averageViewDuration: num(row, 'averageViewDuration'),
    likes: num(row, 'likes'),
    comments: num(row, 'comments'),
    shares: num(row, 'shares'),
    subscribersGained: num(row, 'subscribersGained'),
  }));
}

// ─── yt-analytics.readonly: demographics ───────────────────────────────

export interface DemographicRow {
  ageGroup: string;
  gender: string;
  viewerPercentage: number;
}

export async function fetchDemographics28d(
  accessToken: string,
): Promise<DemographicRow[]> {
  const { startDate, endDate } = lastNDays(28);
  const res = await axios.get<{ rows?: Array<[string, string, number]> }>(
    `${YOUTUBE_ANALYTICS}/reports`,
    {
      params: {
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics: 'viewerPercentage',
        dimensions: 'ageGroup,gender',
        sort: 'gender,ageGroup',
      },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15_000,
    },
  );
  return (res.data.rows ?? []).map(([ageGroup, gender, viewerPercentage]) => ({
    ageGroup: String(ageGroup),
    gender: String(gender),
    viewerPercentage: Number(viewerPercentage ?? 0),
  }));
}

// ─── yt-analytics.readonly: top countries ──────────────────────────────

export interface CountryRow {
  country: string;
  views: number;
  estimatedMinutesWatched: number;
  averageViewDuration: number;
}

export async function fetchGeography28d(
  accessToken: string,
  max = 10,
): Promise<CountryRow[]> {
  const { startDate, endDate } = lastNDays(28);
  const res = await axios.get<{
    rows?: Array<[string, number, number, number]>;
  }>(`${YOUTUBE_ANALYTICS}/reports`, {
    params: {
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics: 'views,estimatedMinutesWatched,averageViewDuration',
      dimensions: 'country',
      sort: '-views',
      maxResults: Math.min(max, 200),
    },
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15_000,
  });
  return (res.data.rows ?? []).map(
    ([country, views, minutes, avgDuration]) => ({
      country: String(country),
      views: Number(views ?? 0),
      estimatedMinutesWatched: Number(minutes ?? 0),
      averageViewDuration: Number(avgDuration ?? 0),
    }),
  );
}

// ─── yt-analytics.readonly: device breakdown ───────────────────────────

export interface DeviceRow {
  deviceType: string;
  views: number;
  estimatedMinutesWatched: number;
}

export async function fetchDevices28d(
  accessToken: string,
): Promise<DeviceRow[]> {
  const { startDate, endDate } = lastNDays(28);
  const res = await axios.get<{ rows?: Array<[string, number, number]> }>(
    `${YOUTUBE_ANALYTICS}/reports`,
    {
      params: {
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'deviceType',
        sort: '-views',
      },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15_000,
    },
  );
  return (res.data.rows ?? []).map(([deviceType, views, minutes]) => ({
    deviceType: String(deviceType),
    views: Number(views ?? 0),
    estimatedMinutesWatched: Number(minutes ?? 0),
  }));
}

// ─── yt-analytics.readonly: traffic sources ────────────────────────────

export interface TrafficSourceRow {
  source: string;
  views: number;
  estimatedMinutesWatched: number;
  averageViewDuration: number;
}

export async function fetchTrafficSources28d(
  accessToken: string,
): Promise<TrafficSourceRow[]> {
  const { startDate, endDate } = lastNDays(28);
  const res = await axios.get<{ rows?: Array<[string, number, number, number]> }>(
    `${YOUTUBE_ANALYTICS}/reports`,
    {
      params: {
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched,averageViewDuration',
        dimensions: 'insightTrafficSourceType',
        sort: '-views',
      },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15_000,
    },
  );
  return (res.data.rows ?? []).map(
    ([source, views, minutes, avgDuration]) => ({
      source: String(source),
      views: Number(views ?? 0),
      estimatedMinutesWatched: Number(minutes ?? 0),
      averageViewDuration: Number(avgDuration ?? 0),
    }),
  );
}

// ─── yt-analytics.readonly: subscription deltas + engagement totals ────

export interface ChannelTotals28d {
  views: number;
  estimatedMinutesWatched: number;
  averageViewDuration: number;
  likes: number;
  comments: number;
  shares: number;
  subscribersGained: number;
  subscribersLost: number;
  videosAddedToPlaylists: number;
  videosRemovedFromPlaylists: number;
}

export async function fetchChannelTotals28d(
  accessToken: string,
): Promise<ChannelTotals28d> {
  const { startDate, endDate } = lastNDays(28);
  const res = await axios.get<{
    rows?: Array<Array<string | number>>;
    columnHeaders?: Array<{ name: string }>;
  }>(`${YOUTUBE_ANALYTICS}/reports`, {
    params: {
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics:
        'views,estimatedMinutesWatched,averageViewDuration,likes,comments,shares,subscribersGained,subscribersLost,videosAddedToPlaylists,videosRemovedFromPlaylists',
    },
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15_000,
  });
  const headers = (res.data.columnHeaders ?? []).map((h) => h.name);
  const row = res.data.rows?.[0] ?? [];
  const num = (name: string): number => {
    const i = headers.indexOf(name);
    return i >= 0 ? Number(row[i] ?? 0) : 0;
  };
  return {
    views: num('views'),
    estimatedMinutesWatched: num('estimatedMinutesWatched'),
    averageViewDuration: num('averageViewDuration'),
    likes: num('likes'),
    comments: num('comments'),
    shares: num('shares'),
    subscribersGained: num('subscribersGained'),
    subscribersLost: num('subscribersLost'),
    videosAddedToPlaylists: num('videosAddedToPlaylists'),
    videosRemovedFromPlaylists: num('videosRemovedFromPlaylists'),
  };
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

/** Parse ISO 8601 duration like PT4M13S into a readable mm:ss / h:mm:ss. */
export function formatDuration(iso?: string): string {
  if (!iso) return '—';
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return iso;
  const [, h = '0', mn = '0', s = '0'] = m;
  const H = Number(h), M = Number(mn), S = Number(s);
  if (H > 0) return `${H}:${String(M).padStart(2, '0')}:${String(S).padStart(2, '0')}`;
  return `${M}:${String(S).padStart(2, '0')}`;
}
