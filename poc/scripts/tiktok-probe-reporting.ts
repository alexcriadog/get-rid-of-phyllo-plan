/**
 * Probe TikTok Reporting endpoint for per-video insights.
 *
 * We want reach / total_play_time / traffic_source / completion_rate /
 * average_watch_time. These were rejected as "invalid field(s)" on
 * /business/video/list/ — the working theory is that those fields live
 * behind /report/integrated/get/ and require the Reporting permission
 * family (which IS marked checked in Camaleonic's BC app).
 *
 * Strategy: try a matrix of (method × report_type × metric set) so we
 * can read which path TikTok accepts vs rejects, and what error code
 * it gives back. We are NOT using the chokepoint — this is a raw probe
 * outside the worker, with no rate-bucket spend.
 *
 * Run:
 *   npx ts-node scripts/tiktok-probe-reporting.ts <account_id>
 */

import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import axios, { AxiosResponse } from 'axios';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const TIKTOK_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

function loadDotenv(): void {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function decryptToken(ciphertext: Buffer): string {
  const hex = process.env.LOCAL_AES_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('LOCAL_AES_KEY missing');
  const key = Buffer.from(hex, 'hex');
  const iv = ciphertext.subarray(0, 12);
  const tag = ciphertext.subarray(12, 28);
  const enc = ciphertext.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

interface Probe {
  label: string;
  method: 'GET' | 'POST';
  endpoint: string;
  params: Record<string, unknown>;
}

function summarise(res: AxiosResponse, label: string): void {
  const body = res.data;
  const code = body?.code;
  const message = body?.message;
  const dataKeys = body?.data ? Object.keys(body.data) : [];
  const sampleListLen = Array.isArray(body?.data?.list) ? body.data.list.length : null;
  console.log(
    `[${label}] http=${res.status} code=${code} msg="${message}" data_keys=[${dataKeys.join(',')}] list_len=${sampleListLen}`,
  );
  if (code !== 0 && body) {
    console.log(`  full_body: ${JSON.stringify(body).slice(0, 400)}`);
  } else if (sampleListLen && sampleListLen > 0) {
    const first = body.data.list[0];
    console.log(`  first_row: ${JSON.stringify(first).slice(0, 500)}`);
  }
}

async function main(): Promise<void> {
  loadDotenv();
  const accountIdRaw = process.argv[2];
  if (!accountIdRaw) {
    console.error('usage: ts-node scripts/tiktok-probe-reporting.ts <account_id>');
    process.exit(2);
  }
  const accountId = BigInt(accountIdRaw);
  const prisma = new PrismaClient();
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    include: { tokens: true },
  });
  if (!account.tokens[0]) throw new Error('No oauth_token row for account');
  const accessToken = decryptToken(Buffer.from(account.tokens[0].accessTokenCiphertext));
  const metadata = (account.metadata ?? {}) as Record<string, unknown>;
  const businessId =
    (typeof metadata.business_id === 'string' && metadata.business_id) ||
    (typeof metadata.open_id === 'string' && metadata.open_id) ||
    '';
  if (!businessId) throw new Error('No business_id/open_id in metadata');

  console.log(`account=${accountId} business_id=${businessId.slice(0, 12)}...`);

  const list = await axios.request({
    baseURL: TIKTOK_BASE,
    url: '/business/video/list/',
    method: 'GET',
    params: {
      business_id: businessId,
      max_count: 5,
      fields: JSON.stringify(['item_id']),
    },
    headers: { 'Access-Token': accessToken, 'Content-Type': 'application/json' },
    validateStatus: () => true,
    timeout: 30_000,
  });
  const videoIds: string[] = (list.data?.data?.videos ?? [])
    .map((v: { item_id?: string }) => v.item_id)
    .filter(Boolean);
  console.log(`pulled ${videoIds.length} video_ids for use in probes`);

  const today = new Date();
  const past = new Date(today.getTime() - 30 * 86_400_000);
  const fmtDate = (d: Date): string => d.toISOString().slice(0, 10);
  const startDate = fmtDate(past);
  const endDate = fmtDate(today);

  const probes: Probe[] = [
    {
      label: 'A1 GET BUSINESS dim=video_id metrics=views',
      method: 'GET',
      endpoint: '/report/integrated/get/',
      params: {
        business_id: businessId,
        report_type: 'BUSINESS',
        dimensions: JSON.stringify(['video_id']),
        metrics: JSON.stringify(['video_views']),
        start_date: startDate,
        end_date: endDate,
      },
    },
    {
      label: 'A2 GET BUSINESS dim=video_id metrics=reach,total_play_time',
      method: 'GET',
      endpoint: '/report/integrated/get/',
      params: {
        business_id: businessId,
        report_type: 'BUSINESS',
        dimensions: JSON.stringify(['video_id']),
        metrics: JSON.stringify(['reach', 'total_play_time', 'average_watch_time']),
        start_date: startDate,
        end_date: endDate,
      },
    },
    {
      label: 'A3 GET BUSINESS dim=video_id metrics=traffic_source',
      method: 'GET',
      endpoint: '/report/integrated/get/',
      params: {
        business_id: businessId,
        report_type: 'BUSINESS',
        dimensions: JSON.stringify(['video_id']),
        metrics: JSON.stringify(['traffic_source']),
        start_date: startDate,
        end_date: endDate,
      },
    },
    {
      label: 'B1 GET BUSINESS_VIDEO',
      method: 'GET',
      endpoint: '/report/integrated/get/',
      params: {
        business_id: businessId,
        report_type: 'BUSINESS_VIDEO',
        dimensions: JSON.stringify(['video_id']),
        metrics: JSON.stringify(['video_views', 'reach', 'total_play_time']),
        start_date: startDate,
        end_date: endDate,
      },
    },
    {
      label: 'C1 GET BUSINESS dim=stat_time_day',
      method: 'GET',
      endpoint: '/report/integrated/get/',
      params: {
        business_id: businessId,
        report_type: 'BUSINESS',
        dimensions: JSON.stringify(['stat_time_day']),
        metrics: JSON.stringify(['video_views', 'reach', 'profile_views']),
        start_date: startDate,
        end_date: endDate,
      },
    },
    {
      label: 'D1 POST BUSINESS dim=video_id',
      method: 'POST',
      endpoint: '/report/integrated/get/',
      params: {
        business_id: businessId,
        report_type: 'BUSINESS',
        dimensions: ['video_id'],
        metrics: ['video_views', 'reach', 'total_play_time'],
        start_date: startDate,
        end_date: endDate,
      },
    },
  ];

  for (const probe of probes) {
    try {
      const res = await axios.request({
        baseURL: TIKTOK_BASE,
        url: probe.endpoint,
        method: probe.method,
        params: probe.method === 'GET' ? probe.params : { business_id: businessId },
        data: probe.method === 'POST' ? probe.params : undefined,
        headers: {
          'Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        validateStatus: () => true,
        timeout: 30_000,
      });
      summarise(res, probe.label);
    } catch (err) {
      console.log(`[${probe.label}] threw: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  if (videoIds.length > 0) {
    const insightFields = [
      'reach',
      'impressions',
      'total_play_time',
      'average_watch_time',
      'completion_rate',
      'traffic_source',
      'audience_countries_per_video',
      'profile_visits',
      'video_play_actions',
    ];
    console.log('\n--- per-field probe on /business/video/list/ ---');
    for (const field of insightFields) {
      const res = await axios.request({
        baseURL: TIKTOK_BASE,
        url: '/business/video/list/',
        method: 'GET',
        params: {
          business_id: businessId,
          max_count: 1,
          fields: JSON.stringify(['item_id', field]),
        },
        headers: {
          'Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        validateStatus: () => true,
        timeout: 30_000,
      });
      const code = res.data?.code;
      const msg = res.data?.message;
      const okSampleHas =
        code === 0 ? Object.keys(res.data?.data?.videos?.[0] ?? {}) : null;
      console.log(`  field=${field} code=${code} msg="${msg}" sample_keys=${JSON.stringify(okSampleHas)}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
