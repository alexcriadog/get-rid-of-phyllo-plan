// YouTube ads fetcher.
//
// Two Google Ads API calls:
//   1. listAccessibleCustomers — discover the user's customer_id(s).
//   2. customers/{id}/googleAds:search — pull VIDEO advertising_channel_type
//      campaigns + last-30-day metrics for the primary customer.
//
// Behaviour when GOOGLE_ADS_DEVELOPER_TOKEN is not set: returns an empty
// snapshot with a single note explaining the missing config. The worker
// records success so the cadence keeps advancing — we don't want a
// missing token to look like a real failure to retry against.

import { Injectable, Logger } from '@nestjs/common';
import type { AdsSnapshot } from '../../shared/platform-types';
import {
  GoogleAdsClient,
  GoogleAdsConfigError,
} from '../../shared/google-ads-api/google-ads-client';
import { extractAccountId } from '../../shared/meta-graph';
import { videoCampaignsToAdsSnapshot } from '../mapper/youtube-ads.mapper';

const RECENT_VIDEO_CAMPAIGNS_GAQL = `
  SELECT
    campaign.id,
    campaign.name,
    campaign.status,
    campaign.advertising_channel_type,
    campaign.advertising_channel_sub_type,
    metrics.impressions,
    metrics.video_views,
    metrics.video_view_rate,
    metrics.average_cpv,
    metrics.cost_micros
  FROM campaign
  WHERE campaign.advertising_channel_type = 'VIDEO'
    AND segments.date DURING LAST_30_DAYS
  ORDER BY metrics.video_views DESC
  LIMIT 50
`.trim();

@Injectable()
export class YoutubeAdsFetcher {
  private readonly logger = new Logger(YoutubeAdsFetcher.name);

  constructor(private readonly client: GoogleAdsClient) {}

  async fetch(
    accessToken: string,
    canonicalId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AdsSnapshot> {
    void canonicalId;
    const accountId = extractAccountId(metadata);

    // No dev token → return an empty snapshot with a diagnostic note.
    // The dashboard surfaces the note, the worker records success, no retry.
    if (!this.client.developerToken()) {
      return {
        customers: [],
        campaigns: [],
        totalViews: 0,
        totalCostUsd: 0,
        notes: [
          'GOOGLE_ADS_DEVELOPER_TOKEN is not configured on the POC server. ' +
            'Issue a Basic Access token from https://ads.google.com/aw/apicenter ' +
            'and add it to poc/.env.',
        ],
        fetchedAt: new Date(),
      };
    }

    let customers: AdsSnapshot['customers'] = [];
    try {
      const res = await this.client.listAccessibleCustomers({ accessToken, accountId });
      customers = (res.resourceNames ?? []).map((rn) => ({
        resourceName: rn,
        id: rn.replace(/^customers\//, ''),
      }));
    } catch (err) {
      if (err instanceof GoogleAdsConfigError) {
        return {
          customers: [],
          campaigns: [],
          totalViews: 0,
          totalCostUsd: 0,
          notes: [err.message],
          fetchedAt: new Date(),
        };
      }
      throw err;
    }

    if (customers.length === 0) {
      return {
        customers: [],
        campaigns: [],
        totalViews: 0,
        totalCostUsd: 0,
        notes: [
          'listAccessibleCustomers returned an empty list — this user has ' +
            'no Google Ads accounts. The adwords scope is granted and the ' +
            'developer token is valid; there are just no advertiser ' +
            'accounts to query.',
        ],
        fetchedAt: new Date(),
      };
    }

    const primary = customers[0];
    const loginCustomerId =
      typeof metadata?.['google_ads_login_customer_id'] === 'string'
        ? (metadata['google_ads_login_customer_id'] as string)
        : undefined;

    try {
      const search = await this.client.search({
        customerId: primary.id,
        accessToken,
        accountId,
        loginCustomerId,
        query: RECENT_VIDEO_CAMPAIGNS_GAQL,
      });
      return videoCampaignsToAdsSnapshot({
        customers,
        primaryCustomerId: primary.id,
        rows: search.results ?? [],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`google-ads search failed for customer ${primary.id}: ${msg}`);
      return {
        customers,
        primaryCustomerId: primary.id,
        campaigns: [],
        totalViews: 0,
        totalCostUsd: 0,
        notes: [
          `Google Ads search failed for customer ${primary.id}: ${msg}`,
        ],
        fetchedAt: new Date(),
      };
    }
  }
}
