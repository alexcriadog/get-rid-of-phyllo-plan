// Google Ads API client. Two calls:
//
//   - fetchAccessibleCustomers(accessToken): discover the customer_id(s)
//     the connected user has access to (advertiser accounts or MCCs).
//   - fetchVideoCampaigns30d(accessToken, customerId): GAQL query for
//     campaign.advertising_channel_type = 'VIDEO' over the last 30 days.
//
// Both calls require BOTH the user's OAuth access_token AND our app's
// developer token (GOOGLE_ADS_DEVELOPER_TOKEN env). The developer token
// is issued once per Manager (MCC) account we own; user OAuth alone is
// not enough to call the API.
//
// API version: v24 (released 2026-04-22). Verify against
// https://developers.google.com/google-ads/api/docs/release-notes before
// any major change — Google rotates the supported window roughly every
// 14 months.

import axios, { AxiosError } from 'axios';

const API_VERSION = 'v24';
const ADS_BASE = `https://googleads.googleapis.com/${API_VERSION}`;

export interface AccessibleCustomer {
  /** 10-digit string, no hyphens. e.g. "1234567890". */
  id: string;
  /** Original resource name as returned by Google: "customers/1234567890". */
  resourceName: string;
}

/**
 * GET /customers:listAccessibleCustomers — returns the customer IDs the
 * authenticated user can act on directly. Empty array if the user has no
 * Google Ads accounts (most creators).
 */
export async function fetchAccessibleCustomers(
  accessToken: string,
): Promise<AccessibleCustomer[]> {
  const devToken = requireEnv('GOOGLE_ADS_DEVELOPER_TOKEN');
  const res = await axios.get<{ resourceNames?: string[] }>(
    `${ADS_BASE}/customers:listAccessibleCustomers`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': devToken,
      },
      timeout: 15_000,
    },
  );
  const names = res.data.resourceNames ?? [];
  return names.map((rn) => ({
    resourceName: rn,
    id: rn.replace(/^customers\//, ''),
  }));
}

export interface VideoCampaignRow {
  campaignId: string;
  campaignName: string;
  status: string;
  videoViews: number;
  videoViewRate: number | null;
  averageCpvUsd: number | null;
  costUsd: number;
  impressions: number;
}

export interface VideoCampaignReport {
  customerId: string;
  rows: VideoCampaignRow[];
  totalViews: number;
  totalCostUsd: number;
}

/**
 * POST /customers/{customerId}/googleAds:search — GAQL query that
 * returns the user's YouTube video campaigns over the last 30 days,
 * sorted by view count descending.
 *
 * If the user is a Manager (MCC), set `loginCustomerId` to that MCC ID
 * and `customerId` to the child account being queried. For most
 * individual creators, omit `loginCustomerId`.
 */
export async function fetchVideoCampaigns30d(
  accessToken: string,
  customerId: string,
  loginCustomerId?: string,
): Promise<VideoCampaignReport> {
  const devToken = requireEnv('GOOGLE_ADS_DEVELOPER_TOKEN');
  const { startDate, endDate } = lastNDays(30);
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      metrics.video_views,
      metrics.video_view_rate,
      metrics.average_cpv,
      metrics.cost_micros,
      metrics.impressions
    FROM campaign
    WHERE campaign.advertising_channel_type = 'VIDEO'
      AND segments.date BETWEEN '${startDate}' AND '${endDate}'
    ORDER BY metrics.video_views DESC
    LIMIT 50
  `.trim();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': devToken,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) {
    headers['login-customer-id'] = loginCustomerId;
  }

  const res = await axios.post<{
    results?: Array<{
      campaign?: { id?: string; name?: string; status?: string };
      metrics?: {
        videoViews?: string | number;
        videoViewRate?: number;
        averageCpv?: string | number;
        costMicros?: string | number;
        impressions?: string | number;
      };
    }>;
  }>(
    `${ADS_BASE}/customers/${customerId}/googleAds:search`,
    { query },
    { headers, timeout: 20_000 },
  );

  const rows: VideoCampaignRow[] = (res.data.results ?? []).map((r) => {
    const m = r.metrics ?? {};
    const cpvMicros = m.averageCpv != null ? Number(m.averageCpv) : null;
    const costMicros = m.costMicros != null ? Number(m.costMicros) : 0;
    return {
      campaignId: r.campaign?.id ?? '',
      campaignName: r.campaign?.name ?? '(unnamed)',
      status: r.campaign?.status ?? 'UNKNOWN',
      videoViews: m.videoViews != null ? Number(m.videoViews) : 0,
      videoViewRate: m.videoViewRate != null ? Number(m.videoViewRate) : null,
      averageCpvUsd: cpvMicros !== null ? cpvMicros / 1_000_000 : null,
      costUsd: costMicros / 1_000_000,
      impressions: m.impressions != null ? Number(m.impressions) : 0,
    };
  });

  return {
    customerId,
    rows,
    totalViews: rows.reduce((acc, r) => acc + r.videoViews, 0),
    totalCostUsd: rows.reduce((acc, r) => acc + r.costUsd, 0),
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
      `${name} is not configured. Request a Basic developer token at ` +
        `https://ads.google.com/aw/apicenter and set it in ` +
        `verify-youtube/.env.`,
    );
  }
  return v;
}

/** Friendly error extractor for Google Ads API responses. */
export function describeGoogleAdsError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const ax = err as AxiosError<{
      error?: {
        code?: number;
        message?: string;
        status?: string;
        details?: unknown;
      };
    }>;
    const e = ax.response?.data?.error;
    if (e?.message) return `${e.status ?? 'ERROR'}: ${e.message}`;
    return ax.message;
  }
  return err instanceof Error ? err.message : String(err);
}
