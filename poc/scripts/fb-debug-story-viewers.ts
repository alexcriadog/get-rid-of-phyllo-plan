/**
 * Find the "90 viewers" number that Facebook Pages Manager shows for a
 * story but the bare /{post_id}/insights call returns as 0. Targeted probe
 * after the first sweep proved that the metrics surfaced via the /insights
 * edge are all-zero except for reactions / total_interactions.
 *
 * Run from poc/ with:
 *   npx ts-node -r tsconfig-paths/register scripts/fb-debug-story-viewers.ts <account_id>
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
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('LOCAL_AES_KEY missing or invalid');
  }
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
    return `OK ${res.status} ${JSON.stringify(res.data).slice(0, 600)}`;
  }
  const err = res.data?.error;
  const code = err?.code != null ? `#${err.code}` : '';
  const sub = err?.error_subcode != null ? `/${err.error_subcode}` : '';
  return `ERR ${res.status} ${code}${sub} ${err?.message ?? JSON.stringify(res.data).slice(0, 400)}`;
}

async function get(label: string, url: string, params: Record<string, string>, token: string): Promise<void> {
  const res = await axios.get(url, {
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
    console.error('Usage: ts-node scripts/fb-debug-story-viewers.ts <account_id>');
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

    const list = await axios.get(`${GRAPH_BASE}/${pageId}/stories`, {
      params: { fields: 'post_id,creation_time,media_id,media_type', access_token: token },
      validateStatus: () => true,
    });
    const story = list.data?.data?.[0];
    if (!story?.post_id) {
      console.error('No stories returned');
      process.exit(1);
    }
    const post_id = story.post_id;
    const media_id = story.media_id;
    console.log(`page_id=${pageId} post_id=${post_id} media_id=${media_id}\n`);

    await get('GET /debug_token', `${GRAPH_BASE}/debug_token`, { input_token: token }, token);

    await get('GET /{post_id}/insights (no params, baseline)', `${GRAPH_BASE}/${post_id}/insights`, {}, token);
    await get('GET /{post_id}/insights period=lifetime', `${GRAPH_BASE}/${post_id}/insights`, { period: 'lifetime' }, token);
    await get('GET /{post_id}/insights period=days_28', `${GRAPH_BASE}/${post_id}/insights`, { period: 'days_28' }, token);
    await get('GET /{post_id}/insights metric_type=total_value', `${GRAPH_BASE}/${post_id}/insights`, { metric_type: 'total_value' }, token);
    await get(
      'GET /{post_id}/insights metric=page_story_impressions_by_story_id_unique period=lifetime',
      `${GRAPH_BASE}/${post_id}/insights`,
      { metric: 'page_story_impressions_by_story_id_unique', period: 'lifetime' },
      token,
    );
    await get(
      'GET /{post_id}/insights metric=story_total_media_view_unique period=lifetime',
      `${GRAPH_BASE}/${post_id}/insights`,
      { metric: 'story_total_media_view_unique', period: 'lifetime' },
      token,
    );

    await get(
      'GET /{page_id}/insights metric=page_story_impressions_by_story_id_unique period=day since/until=last 48h',
      `${GRAPH_BASE}/${pageId}/insights`,
      {
        metric: 'page_story_impressions_by_story_id_unique',
        period: 'day',
        since: String(Math.floor(Date.now() / 1000) - 2 * 86400),
        until: String(Math.floor(Date.now() / 1000)),
      },
      token,
    );
    await get(
      'GET /{page_id}/insights metric=page_story_impressions_by_story_id period=day since/until=last 48h',
      `${GRAPH_BASE}/${pageId}/insights`,
      {
        metric: 'page_story_impressions_by_story_id',
        period: 'day',
        since: String(Math.floor(Date.now() / 1000) - 2 * 86400),
        until: String(Math.floor(Date.now() / 1000)),
      },
      token,
    );

    await get('GET /{post_id}?fields=viewers', `${GRAPH_BASE}/${post_id}`, { fields: 'viewers' }, token);
    await get('GET /{post_id}?fields=seen_by', `${GRAPH_BASE}/${post_id}`, { fields: 'seen_by' }, token);
    await get('GET /{post_id}?fields=reach', `${GRAPH_BASE}/${post_id}`, { fields: 'reach' }, token);
    await get('GET /{post_id}?fields=impressions', `${GRAPH_BASE}/${post_id}`, { fields: 'impressions' }, token);
    await get('GET /{post_id}?fields=insights{values,total_value,name}', `${GRAPH_BASE}/${post_id}`, {
      fields: 'insights{values,total_value,name}',
    }, token);
    await get('GET /{post_id}/viewers', `${GRAPH_BASE}/${post_id}/viewers`, {}, token);
    await get('GET /{post_id}/seen_by', `${GRAPH_BASE}/${post_id}/seen_by`, {}, token);

    if (media_id) {
      await get('GET /{media_id}/viewers', `${GRAPH_BASE}/${media_id}/viewers`, {}, token);
      await get('GET /{media_id}?fields=viewers', `${GRAPH_BASE}/${media_id}`, { fields: 'viewers' }, token);
      await get('GET /{media_id}?fields=insights', `${GRAPH_BASE}/${media_id}`, { fields: 'insights' }, token);
    }

    await get('GET /me/permissions', `${GRAPH_BASE}/me/permissions`, {}, token);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
