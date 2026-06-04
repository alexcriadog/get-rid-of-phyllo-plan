// Single client for the POC's /admin/connect/seed contract.
// Bearer-authenticated. Throws an Error with the upstream body on non-2xx.

import axios, { AxiosError } from 'axios';

export interface SeedBody {
  platform:
    | 'facebook'
    | 'instagram'
    | 'tiktok'
    | 'threads'
    | 'youtube'
    | 'twitch'
    | 'linkedin';
  access_token: string;
  canonical_user_id: string;
  handle?: string;
  refresh_token?: string;
  /** ISO 8601 with offset, e.g. "2026-09-30T12:00:00.000Z". */
  expires_at?: string;
  /**
   * Free-form metadata bag persisted on the Account row. We use it to:
   *   - carry FB page_id alongside instagram seeding (same Page Token)
   *   - carry user_token next to a page_token so ads_read calls work
   *   - hold YouTube uploads_playlist_id / channel country / scopes[]
   */
  metadata?: Record<string, unknown>;
  /**
   * Tenant + end-user threaded through from the SDK JWT claims. When the
   * popup is launched via the connect-sdk these are present; when the
   * legacy single-tenant connect-tool flow is used they're omitted and
   * the POC backend falls back to the "demo" workspace.
   */
  workspace_id?: string;
  end_user_id?: string;
  /** True when seeded via a cmlk_test_* SDK token — suppresses webhooks. */
  is_test?: boolean;
}

export interface SeedResponse {
  account_id: string;
  sync_jobs_created: string[];
  /** Whether the Meta Page was auto-subscribed to webhooks (facebook seeds only; informational). */
  webhook_subscribed?: boolean;
}

const TIMEOUT_MS = 20_000;

export async function postToPocSeed(body: SeedBody): Promise<SeedResponse> {
  const baseUrl = process.env.POC_API_URL;
  const secret = process.env.CONNECT_TOOL_SECRET;
  if (!baseUrl) {
    throw new Error('POC_API_URL is not configured for connect-tool');
  }
  if (!secret) {
    throw new Error('CONNECT_TOOL_SECRET is not configured for connect-tool');
  }

  try {
    const res = await axios.post<SeedResponse>(
      `${baseUrl}/admin/connect/seed`,
      body,
      {
        timeout: TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
        // Bypass any HTTPS_PROXY env var. OrbStack injects one into every
        // container; it bounces internal POC_API_URL hostnames (like
        // http://api:3000) back as 502. Direct connection over the
        // compose network is what we want here.
        proxy: false,
      },
    );
    return res.data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const ax = err as AxiosError<{ message?: string }>;
      const status = ax.response?.status ?? 0;
      const upstream =
        ax.response?.data && typeof ax.response.data === 'object'
          ? (ax.response.data as { message?: string }).message
          : undefined;
      throw new Error(
        `POC seed failed (HTTP ${status}): ${upstream ?? ax.message}`,
      );
    }
    throw err;
  }
}

/**
 * Resolve the public base URL of THIS service, used to build the
 * redirect_uri parameter for each platform. Order: PUBLIC_BASE_URL env →
 * X-Forwarded headers → Host header → localhost fallback.
 */
export function publicBaseUrl(
  headers: Record<string, string | string[] | undefined>,
): string {
  const fromEnv = process.env.PUBLIC_BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const proto =
    (headers['x-forwarded-proto'] as string | undefined) ?? 'http';
  const host =
    (headers['x-forwarded-host'] as string | undefined) ??
    (headers.host as string | undefined) ??
    'localhost:3002';
  return `${proto}://${host}`;
}
