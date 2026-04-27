/**
 * FB /insights diagnostic — decrypts the stored token for the requested
 * account and probes a list of Page Insights metrics so we can see exactly
 * what Meta returns. Read-only.
 *
 * Run from poc/ with:
 *   npx ts-node -r tsconfig-paths/register scripts/fb-debug-insights.ts <account_id>
 */

import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
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

async function probe(
  pageId: string,
  metric: string,
  period: string,
  token: string,
  extraParams: Record<string, string> = {},
): Promise<void> {
  const url = `${GRAPH_BASE}/${pageId}/insights`;
  const res = await axios.get(url, {
    params: { metric, period, access_token: token, ...extraParams },
    timeout: 15_000,
    validateStatus: () => true,
  });
  const status = res.status;
  if (status >= 200 && status < 300) {
    const data = res.data?.data ?? [];
    const summary = data
      .map((d: { name: string; values?: Array<{ value: unknown }> }) => {
        const last = d.values?.[d.values.length - 1]?.value;
        const preview =
          typeof last === 'object' && last !== null
            ? JSON.stringify(last).slice(0, 100)
            : String(last);
        return `${d.name}=${preview}`;
      })
      .join(' ; ');
    console.log(
      `  ✓ ${status.toString().padEnd(3)} ${metric.padEnd(36)} period=${period.padEnd(8)} -> ${summary || '(no data)'}`,
    );
  } else {
    const err = res.data?.error;
    const code = err?.code != null ? `#${err.code}` : '';
    const sub = err?.error_subcode != null ? `/${err.error_subcode}` : '';
    const msg = err?.message ?? JSON.stringify(res.data).slice(0, 200);
    console.log(
      `  ✗ ${status.toString().padEnd(3)} ${metric.padEnd(36)} period=${period.padEnd(8)} -> ${code}${sub} ${msg}`,
    );
  }
}

async function main(): Promise<void> {
  loadDotenv();

  const accountIdRaw = process.argv[2];
  if (!accountIdRaw) {
    console.error('Usage: ts-node scripts/fb-debug-insights.ts <account_id>');
    process.exit(1);
  }
  const accountId = BigInt(accountIdRaw);

  const prisma = new PrismaClient();
  try {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      include: { tokens: true },
    });
    if (!account) {
      console.error(`Account ${accountId} not found`);
      process.exit(1);
    }
    if (account.platform !== 'facebook') {
      console.error(
        `Account ${accountId} is platform=${account.platform}, expected facebook`,
      );
      process.exit(1);
    }
    const tok = account.tokens[0];
    if (!tok) {
      console.error('No token row for this account');
      process.exit(1);
    }
    const token = decryptToken(Buffer.from(tok.accessTokenCiphertext));
    const pageId = account.canonicalUserId;

    console.log(`Probing FB Page ${pageId} (${account.handle ?? '—'})`);
    console.log(`Token prefix: ${token.slice(0, 12)}…  (length=${token.length})`);
    console.log('');

    console.log('— /me?fields=id,name,category —');
    const me = await axios.get(`${GRAPH_BASE}/me`, {
      params: { fields: 'id,name,category', access_token: token },
      validateStatus: () => true,
    });
    console.log(`  status=${me.status} body=${JSON.stringify(me.data)}`);

    console.log('');
    console.log('— /debug_token —');
    const dbg = await axios.get(`${GRAPH_BASE}/debug_token`, {
      params: { input_token: token, access_token: token },
      validateStatus: () => true,
    });
    if (dbg.status === 200) {
      const d = dbg.data?.data ?? {};
      console.log(`  type=${d.type} app_id=${d.app_id} expires_at=${d.expires_at}`);
      console.log(`  scopes=${JSON.stringify(d.scopes ?? [])}`);
      console.log(
        `  granular_scopes=${JSON.stringify(d.granular_scopes ?? []).slice(0, 400)}`,
      );
    } else {
      console.log(`  status=${dbg.status} body=${JSON.stringify(dbg.data).slice(0, 300)}`);
    }

    console.log('');
    console.log('— Page tasks (does this user have ANALYZE?) —');
    const tasksRes = await axios.get(`${GRAPH_BASE}/${pageId}`, {
      params: { fields: 'id,name,tasks,access_token', access_token: token },
      validateStatus: () => true,
    });
    if (tasksRes.status === 200) {
      const t = tasksRes.data as {
        id?: string;
        name?: string;
        tasks?: string[];
        access_token?: string;
      };
      console.log(`  tasks=${JSON.stringify(t.tasks ?? [])}`);
      console.log(
        `  access_token_matches_stored=${t.access_token === token} (stored-len=${token.length}, page-field-len=${t.access_token?.length ?? 0})`,
      );
    } else {
      console.log(`  status=${tasksRes.status} body=${JSON.stringify(tasksRes.data).slice(0, 300)}`);
    }

    console.log('');
    console.log('— Page Insights probes (bare) —');

    const probes: Array<{ metric: string; period: string }> = [
      // Modern v22 metrics confirmed working in reference project.
      { metric: 'page_follows', period: 'day' },
      { metric: 'page_media_view', period: 'day' },
      { metric: 'page_total_actions', period: 'day' },
      { metric: 'page_total_media_view_unique', period: 'day' },
      { metric: 'page_views_total', period: 'day' },
      // Older guesses.
      { metric: 'page_followers_country', period: 'lifetime' },
      { metric: 'page_followers_gender_age', period: 'lifetime' },
      { metric: 'page_fans_country', period: 'lifetime' },
      { metric: 'page_fans_gender_age', period: 'lifetime' },
    ];

    for (const p of probes) {
      await probe(pageId, p.metric, p.period, token);
    }

    console.log('');
    console.log('— Same probes but with metric_type=total_value —');
    for (const p of probes) {
      await probe(pageId, p.metric, p.period, token, { metric_type: 'total_value' });
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
