// Google Ads `googleAds:search` result → canonical AdsSnapshot.
//
// Each row from the REST API is a fielded object with nested resources:
//   { campaign: {...}, metrics: {...}, segments: {...} }
// We flatten the bits we care about into AdsCampaignRow and aggregate
// view + spend totals so the dashboard can headline "X views, $Y spend".

import type {
  AdsCampaignRow,
  AdsCustomerSummary,
  AdsSnapshot,
} from '../../shared/platform-types';

export interface VideoCampaignsMapperInput {
  customers: AdsCustomerSummary[];
  primaryCustomerId: string;
  rows: Array<Record<string, unknown>>;
}

export function videoCampaignsToAdsSnapshot(
  input: VideoCampaignsMapperInput,
): AdsSnapshot {
  const campaigns: AdsCampaignRow[] = input.rows.map((row) => {
    const campaign = pickObject(row, 'campaign');
    const metrics = pickObject(row, 'metrics');
    const cpvMicros = numberOrNull(metrics?.['averageCpv']);
    const costMicros = numberOrZero(metrics?.['costMicros']);
    return {
      campaignId: stringOrEmpty(campaign?.['id']),
      campaignName: stringOrEmpty(campaign?.['name']) || '(unnamed)',
      status: stringOrEmpty(campaign?.['status']) || 'UNKNOWN',
      channelType: stringOrUndefined(campaign?.['advertisingChannelType']),
      videoViews: numberOrZero(metrics?.['videoViews']),
      videoViewRate: numberOrNull(metrics?.['videoViewRate']),
      averageCpvUsd: cpvMicros !== null ? cpvMicros / 1_000_000 : null,
      costUsd: costMicros / 1_000_000,
      impressions: numberOrZero(metrics?.['impressions']),
    };
  });

  const totalViews = campaigns.reduce(
    (acc, r) => acc + (r.videoViews ?? 0),
    0,
  );
  const totalCostUsd = campaigns.reduce(
    (acc, r) => acc + (r.costUsd ?? 0),
    0,
  );

  return {
    customers: input.customers,
    primaryCustomerId: input.primaryCustomerId,
    campaigns,
    totalViews,
    totalCostUsd,
    fetchedAt: new Date(),
  };
}

function pickObject(
  row: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const v = row[key];
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function stringOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function stringOrUndefined(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function numberOrZero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numberOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
