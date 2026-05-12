// Google Ads API client — REST against googleads.googleapis.com v24.
//
// Unlike the Meta/YouTube clients, the Google Ads developer token is an
// app-level credential (ours, not per-user) provided via env. Each call
// combines THREE pieces:
//   1. user's OAuth access_token (Authorization: Bearer ...)
//   2. our developer-token header (env GOOGLE_ADS_DEVELOPER_TOKEN)
//   3. optional login-customer-id header when the user has an MCC
//
// Two methods are exposed:
//   - listAccessibleCustomers: discover the customer_id(s) the user can act on.
//   - search:                  run a GAQL query against one customer_id.
//
// Raw responses are persisted to Mongo (same archive collection used by
// the Meta/YouTube clients) so any sync can be replayed offline.

import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { MongoService } from '@shared/database/mongo.service';
import { MetricsService } from '@shared/metrics/metrics.service';
import { persistRaw } from '../meta-graph/graph-raw-archive';

const API_VERSION = 'v24';
const ADS_BASE = `https://googleads.googleapis.com/${API_VERSION}`;
const PLATFORM_NAME = 'google-ads';

export interface GoogleAdsCallContext {
  accessToken: string;
  /** Optional account context for log/metrics attribution. */
  accountId?: bigint;
}

export interface AccessibleCustomersResponse {
  /** Resource names like "customers/1234567890". */
  resourceNames?: string[];
}

export interface GaqlSearchArgs extends GoogleAdsCallContext {
  customerId: string;
  query: string;
  /** When the user is themselves an MCC, the manager account ID. */
  loginCustomerId?: string;
}

export interface GaqlSearchResponse {
  results?: Array<Record<string, unknown>>;
  fieldMask?: string;
  totalResultsCount?: number;
  nextPageToken?: string;
}

@Injectable()
export class GoogleAdsClient {
  private readonly logger = new Logger(GoogleAdsClient.name);

  constructor(
    private readonly mongo: MongoService,
    private readonly metrics: MetricsService,
  ) {}

  developerToken(): string | null {
    const v = process.env['GOOGLE_ADS_DEVELOPER_TOKEN'];
    return v && v.length > 0 ? v : null;
  }

  async listAccessibleCustomers(
    ctx: GoogleAdsCallContext,
  ): Promise<AccessibleCustomersResponse> {
    const endpoint = '/customers:listAccessibleCustomers';
    const devToken = this.requireDeveloperToken();
    const started = Date.now();
    try {
      const res = await axios.get<AccessibleCustomersResponse>(
        `${ADS_BASE}${endpoint}`,
        {
          headers: {
            Authorization: `Bearer ${ctx.accessToken}`,
            'developer-token': devToken,
          },
          timeout: 15_000,
        },
      );
      await this.observeAndPersist(endpoint, ctx.accountId, 200, Date.now() - started, res.data);
      return res.data;
    } catch (err) {
      const status = pickStatus(err) ?? 0;
      const body = pickBody(err) ?? { error: messageOf(err) };
      await this.observeAndPersist(endpoint, ctx.accountId, status, Date.now() - started, body);
      throw asAdsError(endpoint, err);
    }
  }

  async search(args: GaqlSearchArgs): Promise<GaqlSearchResponse> {
    const endpoint = `/customers/${args.customerId}/googleAds:search`;
    const devToken = this.requireDeveloperToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${args.accessToken}`,
      'developer-token': devToken,
      'Content-Type': 'application/json',
    };
    if (args.loginCustomerId) {
      headers['login-customer-id'] = args.loginCustomerId;
    }
    const started = Date.now();
    try {
      const res = await axios.post<GaqlSearchResponse>(
        `${ADS_BASE}${endpoint}`,
        { query: args.query },
        { headers, timeout: 20_000 },
      );
      await this.observeAndPersist(endpoint, args.accountId, 200, Date.now() - started, res.data);
      return res.data;
    } catch (err) {
      const status = pickStatus(err) ?? 0;
      const body = pickBody(err) ?? { error: messageOf(err) };
      await this.observeAndPersist(endpoint, args.accountId, status, Date.now() - started, body);
      throw asAdsError(endpoint, err);
    }
  }

  private requireDeveloperToken(): string {
    const t = this.developerToken();
    if (!t) {
      throw new GoogleAdsConfigError(
        'GOOGLE_ADS_DEVELOPER_TOKEN is not set. Issue a Basic Access token from ' +
          'https://ads.google.com/aw/apicenter and add it to the POC env.',
      );
    }
    return t;
  }

  private async observeAndPersist(
    endpoint: string,
    accountId: bigint | undefined,
    status: number,
    durationMs: number,
    body: unknown,
  ): Promise<void> {
    this.metrics.observeApiCall({
      platform: PLATFORM_NAME,
      endpoint,
      method: endpoint.includes(':search') ? 'POST' : 'GET',
      status,
      durationMs,
      bucketBefore: null,
      bucketAfter: null,
      usageHeader: null,
      accountId: accountId ?? null,
      rateBucketKey: 'google-ads:global',
    });
    try {
      await persistRaw(
        this.mongo,
        PLATFORM_NAME,
        body,
        endpoint,
        accountId ?? null,
        status,
      );
    } catch (err) {
      this.logger.debug(
        `google-ads persistRaw failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

/** Thrown when the developer token isn't configured. Worker treats this as
 *  a benign empty fetch rather than a sync failure. */
export class GoogleAdsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleAdsConfigError';
  }
}

/** Thrown for any other API-side failure. */
export class GoogleAdsApiError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly status: number,
    public readonly body: unknown,
    message?: string,
  ) {
    super(message ?? `Google Ads ${endpoint} failed (HTTP ${status})`);
    this.name = 'GoogleAdsApiError';
  }
}

function asAdsError(endpoint: string, err: unknown): Error {
  const status = pickStatus(err);
  const body = pickBody(err);
  if (status != null) {
    return new GoogleAdsApiError(endpoint, status, body, describeAdsError(body, err));
  }
  return err instanceof Error ? err : new Error(messageOf(err));
}

function describeAdsError(body: unknown, fallback: unknown): string {
  if (body && typeof body === 'object') {
    const b = body as { error?: { status?: string; message?: string } };
    if (b.error?.message) return `${b.error.status ?? 'ERROR'}: ${b.error.message}`;
  }
  return messageOf(fallback);
}

function pickStatus(err: unknown): number | undefined {
  if (axios.isAxiosError(err)) {
    return (err as AxiosError).response?.status;
  }
  return undefined;
}

function pickBody(err: unknown): unknown {
  if (axios.isAxiosError(err)) {
    return (err as AxiosError).response?.data;
  }
  return undefined;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : JSON.stringify(err);
}
