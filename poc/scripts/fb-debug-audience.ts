/**
 * Probe Facebook Page audience metrics as actually exposed by Graph v22.
 * The adapter currently skips demographic breakdowns because of an
 * outdated assumption ("Meta removed them in v22"). This script verifies
 * which audience metrics are actually supported today against the real
 * page token, and prints sample values so we can decide what to map.
 *
 * Run from poc/ with:
 *   npx ts-node -r tsconfig-paths/register scripts/fb-debug-audience.ts <account_id>
 */

import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import axios, { AxiosResponse } from 'axios';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const GRAPH_VERSION = 'v22.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

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

function summarise(res: AxiosResponse): string {
  if (res.status >= 200 && res.status < 300) {
    const body = res.data;
    if (body && Array.isArray(body.data)) {
      const lines = body.data.map((d: { name: string; period: string; values?: Array<{ value: unknown; end_time?: string }> }) => {
        const last = d.values?.[d.values.length - 1];
        const lastVal = last?.value;
        const lastTs = last?.end_time;
        const preview =
          typeof lastVal === 'object' && lastVal !== null
            ? JSON.stringify(lastVal).slice(0, 220)
            : String(lastVal);
        return `${d.name}/${d.period} @ ${lastTs ?? '-'}  =  ${preview}`;
      });
      return `OK\n    ${lines.join('\n    ')}`;
    }
    return `OK ${JSON.stringify(body).slice(0, 320)}`;
  }
  const err = res.data?.error;
  const code = err?.code != null ? `#${err.code}` : '';
  const sub = err?.error_subcode != null ? `/${err.error_subcode}` : '';
  return `ERR ${res.status} ${code}${sub} ${err?.message ?? JSON.stringify(res.data).slice(0, 320)}`;
}

async function probe(label: string, pageId: string, params: Record<string, string>, token: string): Promise<void> {
  const res = await axios.get(`${GRAPH_BASE}/${pageId}/insights`, {
    params: { ...params, access_token: token },
    timeout: 15_000,
    validateStatus: () => true,
  });
  console.log(`${label}\n  -> ${summarise(res)}\n`);
}

async function main(): Promise<void> {
  loadDotenv();
  const accountId = BigInt(process.argv[2] ?? '0');
  if (!accountId) {
    console.error('Usage: ts-node scripts/fb-debug-audience.ts <account_id>');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      include: { tokens: true },
    });
    if (!account || account.platform !== 'facebook') {
      console.error('Account missing or not facebook');
      process.exit(1);
    }
    const token = decryptToken(Buffer.from(account.tokens[0].accessTokenCiphertext));
    const pageId = account.canonicalUserId;
    console.log(`page_id=${pageId} (${account.handle ?? '-'})\n`);

    const last90 = String(Math.floor(Date.now() / 1000) - 90 * 86_400);
    const last28 = String(Math.floor(Date.now() / 1000) - 28 * 86_400);
    const now = String(Math.floor(Date.now() / 1000));

    console.log('== Discovery: /insights with no metric param ==');
    await probe('NO_METRIC (day, last 28d)', pageId, { period: 'day', since: last28, until: now }, token);
    await probe('NO_METRIC (lifetime)', pageId, { period: 'lifetime' }, token);

    console.log('== Headline counters ==');
    await probe('page_fans (day)', pageId, { metric: 'page_fans', period: 'day' }, token);
    await probe('page_follows (day, last 28d)', pageId, {
      metric: 'page_follows', period: 'day', since: last28, until: now,
    }, token);

    console.log('== Adds / removes ==');
    for (const m of ['page_fan_adds', 'page_fan_adds_unique', 'page_fan_removes', 'page_fan_removes_unique']) {
      await probe(`${m} (day, last 90d)`, pageId, { metric: m, period: 'day', since: last90, until: now }, token);
    }

    console.log('== Demographic breakdowns (lifetime) ==');
    for (const m of ['page_fans_country', 'page_fans_city', 'page_fans_locale', 'page_fans_gender_age']) {
      await probe(`${m} (lifetime)`, pageId, { metric: m, period: 'lifetime' }, token);
    }
    console.log('== Demographic breakdowns (day) ==');
    for (const m of ['page_fans_country', 'page_fans_city', 'page_fans_locale', 'page_fans_gender_age']) {
      await probe(`${m} (day)`, pageId, { metric: m, period: 'day' }, token);
    }

    console.log('== Followers demographics ==');
    for (const m of ['page_followers', 'page_followers_country', 'page_followers_city', 'page_followers_gender_age', 'page_followers_locale']) {
      await probe(`${m} (lifetime)`, pageId, { metric: m, period: 'lifetime' }, token);
    }

    console.log('== Reach / impressions broken down ==');
    for (const m of [
      'page_impressions_by_country_unique',
      'page_impressions_by_city_unique',
      'page_impressions_by_age_gender_unique',
      'page_impressions_by_locale_unique',
    ]) {
      await probe(`${m} (day, last 28d)`, pageId, { metric: m, period: 'day', since: last28, until: now }, token);
    }

    console.log('== Online fans ==');
    await probe('page_fans_online (day)', pageId, { metric: 'page_fans_online', period: 'day' }, token);
    await probe('page_fans_online_per_day (lifetime)', pageId, { metric: 'page_fans_online_per_day', period: 'lifetime' }, token);

    console.log('== Renaming guesses (post-deprecation candidates) ==');
    for (const m of [
      'page_daily_followers_unique',
      'page_daily_follows_unique',
      'pages_followers_country',
      'pages_followers_gender_age',
      'pages_followers_city',
      'page_audience_country',
      'page_audience_gender_age',
      'page_audience_city',
    ]) {
      await probe(`${m} (lifetime)`, pageId, { metric: m, period: 'lifetime' }, token);
    }

    console.log('== AudienceDistribution probes ==');
    // AudienceDistribution is a Graph type with {age, gender, region, percentage}.
    // It's referenced in /docs/graph-api/reference/audience-distribution/ but the
    // parent object is not documented. Brute-force the common parents.
    const adProbes: Array<{ label: string; url: string; params: Record<string, string> }> = [
      { label: '/{page_id}?fields=audience_distribution', url: `${GRAPH_BASE}/${pageId}`, params: { fields: 'audience_distribution' } },
      { label: '/{page_id}?fields=audience', url: `${GRAPH_BASE}/${pageId}`, params: { fields: 'audience' } },
      { label: '/{page_id}/audience_distribution', url: `${GRAPH_BASE}/${pageId}/audience_distribution`, params: {} },
      { label: '/{page_id}/audience', url: `${GRAPH_BASE}/${pageId}/audience`, params: {} },
      { label: '/{page_id}/insights/page_audience', url: `${GRAPH_BASE}/${pageId}/insights/page_audience`, params: {} },
      { label: '/{page_id}/page_backed_instagram_accounts', url: `${GRAPH_BASE}/${pageId}/page_backed_instagram_accounts`, params: {} },
      { label: '/{page_id}/audiences', url: `${GRAPH_BASE}/${pageId}/audiences`, params: {} },
    ];
    for (const p of adProbes) {
      const res = await axios.get(p.url, {
        params: { ...p.params, access_token: token },
        validateStatus: () => true,
        timeout: 15_000,
      });
      console.log(`${p.label}\n  -> ${summarise(res)}\n`);
    }

    console.log('== Per-post demographic breakdowns (sample latest post) ==');
    const postsRes = await axios.get(`${GRAPH_BASE}/${pageId}/posts`, {
      params: { fields: 'id,created_time', limit: '1', access_token: token },
      validateStatus: () => true,
    });
    const samplePost = postsRes.data?.data?.[0]?.id;
    if (samplePost) {
      console.log(`  sample post id=${samplePost}`);
      for (const m of [
        'post_impressions_by_age_gender_unique',
        'post_impressions_by_country_unique',
        'post_impressions_by_locale_unique',
        'post_reactions_by_age_gender_total',
      ]) {
        const res = await axios.get(`${GRAPH_BASE}/${samplePost}/insights`, {
          params: { metric: m, access_token: token },
          validateStatus: () => true,
        });
        console.log(`  ${m} on /{post_id}\n    -> ${summarise(res)}\n`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
