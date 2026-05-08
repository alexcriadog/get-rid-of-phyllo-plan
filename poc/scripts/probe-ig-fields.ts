/**
 * Phase 0 — IG empirical probe. Read-only.
 *
 * For a given Instagram account row (Prisma `accounts` table), this script
 * decrypts the stored token and probes every candidate field/metric/breakdown
 * that Phases B/C of the IG-coverage plan want to add. Each call is isolated
 * (one field/metric per request) so a single Meta rejection doesn't poison
 * the others.
 *
 * Output:
 *   - pretty table on stdout
 *   - markdown document at `<repo-root>/docs/ig-probe-results.md`
 *     (or wherever `--out=<path>` points to)
 *
 * Run from poc/:
 *   npx ts-node -r tsconfig-paths/register scripts/probe-ig-fields.ts <account_id>
 *   npx ts-node -r tsconfig-paths/register scripts/probe-ig-fields.ts 2 --out=../docs/ig-probe-results.md
 *
 * After it completes, copy the working/error lists into the Phase B/C plan
 * before writing fetcher code. Anything Meta rejects in wire is dropped.
 */

import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const GRAPH_VERSION = 'v22.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

// ---------- Candidate lists (mirror the plan) ----------

// Phase B.1 — profile fields.
const PROFILE_FIELDS = [
  // Control set (we already pull these — must keep working):
  'id',
  'username',
  'name',
  'biography',
  'profile_picture_url',
  'followers_count',
  'follows_count',
  'media_count',
  'website',
  // Phase B.1 new candidates:
  'is_published',
  'has_profile_pic',
  'shopping_product_tag_eligibility',
  'legacy_instagram_user_id',
];

// Phase B.2 — per-media fields. `id` is mandatory in the response, so each
// probe asks for `id,<candidate>` to keep the response shape consistent.
const MEDIA_FIELDS = [
  // Control:
  'caption',
  'media_type',
  'media_url',
  'permalink',
  'timestamp',
  'thumbnail_url',
  'like_count',
  'comments_count',
  'is_shared_to_feed',
  'is_comment_enabled',
  'alt_text',
  'media_product_type',
  'shortcode',
  'owner{id,username}',
  'collaborators{id,username}',
  'children{id,media_type,media_url,thumbnail_url,permalink}',
  // Phase B.2 new candidates:
  'shares_count',
  'reposts_count',
  'saved_count',
  'total_like_count',
  'total_comments_count',
  'total_views_count',
  'view_count',
  'boost_ads_list',
  'boost_eligibility_info',
  'copyright_check_information',
  'legacy_instagram_media_id',
  'branded_content_partner',
];

// Phase B.3 — per-media insight metrics (separate call per metric so a single
// rejection doesn't kill the rest).
const MEDIA_METRICS_BY_TYPE: Record<string, string[]> = {
  FEED: [
    // Control:
    'reach',
    'saved',
    'likes',
    'comments',
    'shares',
    'total_interactions',
    'follows',
    'profile_visits',
    // New candidates:
    'views',
    'facebook_views',
    'crossposted_views',
  ],
  REELS: [
    // Control:
    'reach',
    'saved',
    'likes',
    'comments',
    'shares',
    'total_interactions',
    'views',
    // New candidates:
    'ig_reels_avg_watch_time',
    'ig_reels_video_view_total_time',
    'reels_skip_rate',
    'facebook_views',
    'crossposted_views',
  ],
  VIDEO: [
    'reach',
    'saved',
    'likes',
    'comments',
    'shares',
    'total_interactions',
    'views',
    'follows',
    'profile_visits',
    'ig_reels_avg_watch_time',
    'facebook_views',
  ],
  STORY: [
    'reach',
    'replies',
    'shares',
    'total_interactions',
    'follows',
    'profile_visits',
    // New candidates:
    'views',
    'facebook_views',
  ],
};

// Phase C.1 — per-media breakdowns. Each row probes one metric × breakdown
// against a media of the listed types.
const MEDIA_BREAKDOWNS: Array<{
  metric: string;
  breakdown: string;
  appliesTo: string[];
}> = [
  { metric: 'views', breakdown: 'follow_type', appliesTo: ['FEED', 'REELS'] },
  { metric: 'reach', breakdown: 'follow_type', appliesTo: ['FEED', 'REELS', 'STORY'] },
  { metric: 'views', breakdown: 'media_product_type', appliesTo: ['REELS'] },
];

// Phase C.2 — account-level new probes.
const ACCOUNT_BREAKDOWNS: Array<{
  metric: string;
  breakdown?: string;
  period: string;
  metricType?: string;
}> = [
  { metric: 'profile_activity', breakdown: 'action_type', period: 'day', metricType: 'total_value' },
  { metric: 'online_followers', period: 'week' }, // weekly aggregate
];

// ---------- Helpers ----------

interface ProbeResult {
  category: string;
  endpoint: string;
  field: string;
  status: 'OK' | 'SILENT_EMPTY' | 'ERROR';
  http: number;
  sample: string;
  errorCode?: string;
}

const RESULTS: ProbeResult[] = [];

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

function previewValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80);
  const s = String(v);
  return s.length > 80 ? s.slice(0, 77) + '…' : s;
}

function recordError(
  category: string,
  endpoint: string,
  field: string,
  http: number,
  err: { code?: number; subcode?: number; message?: string },
): void {
  const code = err.code != null ? `#${err.code}` : '';
  const sub = err.subcode != null ? `/${err.subcode}` : '';
  const tag = `${code}${sub}` || `HTTP_${http}`;
  RESULTS.push({
    category,
    endpoint,
    field,
    status: 'ERROR',
    http,
    sample: err.message ?? '(no message)',
    errorCode: tag,
  });
  console.log(
    `  ✗ ${String(http).padEnd(3)} ${field.padEnd(48)} -> ${tag} ${err.message ?? ''}`,
  );
}

async function get(
  url: string,
  params: Record<string, string | number>,
): Promise<{ status: number; data: any }> {
  const res = await axios.get(url, { params, timeout: 15_000, validateStatus: () => true });
  return { status: res.status, data: res.data };
}

async function probeField(
  category: string,
  endpoint: string,
  field: string,
  token: string,
): Promise<void> {
  const fieldsParam = endpoint.endsWith('/media') ? `id,${field}` : `id,${field}`;
  const { status, data } = await get(`${GRAPH_BASE}${endpoint}`, {
    fields: fieldsParam,
    access_token: token,
  });
  if (status >= 200 && status < 300) {
    // For listings, value lives at data.data[0][field]. For single nodes,
    // value lives at data[field]. For nested fields like `owner{id,username}`,
    // strip the brace suffix to address the property.
    const propName = field.replace(/\{.*$/, '');
    const value = data?.[propName] ?? data?.data?.[0]?.[propName];
    if (value === undefined) {
      RESULTS.push({
        category,
        endpoint,
        field,
        status: 'SILENT_EMPTY',
        http: status,
        sample: '(field absent)',
      });
      console.log(`  ⊘ ${String(status).padEnd(3)} ${field.padEnd(48)} -> SILENT_EMPTY`);
    } else {
      RESULTS.push({
        category,
        endpoint,
        field,
        status: 'OK',
        http: status,
        sample: previewValue(value),
      });
      console.log(`  ✓ ${String(status).padEnd(3)} ${field.padEnd(48)} -> ${previewValue(value)}`);
    }
  } else {
    const e = data?.error ?? {};
    recordError(category, endpoint, field, status, {
      code: e.code,
      subcode: e.error_subcode,
      message: e.message,
    });
  }
}

async function probeInsightMetric(
  category: string,
  mediaId: string,
  metric: string,
  token: string,
): Promise<void> {
  const endpoint = `/${mediaId}/insights`;
  const { status, data } = await get(`${GRAPH_BASE}${endpoint}`, {
    metric,
    access_token: token,
  });
  if (status >= 200 && status < 300) {
    const arr = data?.data ?? [];
    if (arr.length === 0) {
      RESULTS.push({
        category,
        endpoint,
        field: metric,
        status: 'SILENT_EMPTY',
        http: status,
        sample: '(zero metrics returned)',
      });
      console.log(`  ⊘ ${String(status).padEnd(3)} ${metric.padEnd(48)} -> SILENT_EMPTY`);
      return;
    }
    const first = arr[0];
    const v = first?.values?.[0]?.value ?? first?.total_value?.value;
    RESULTS.push({
      category,
      endpoint,
      field: metric,
      status: 'OK',
      http: status,
      sample: previewValue(v),
    });
    console.log(`  ✓ ${String(status).padEnd(3)} ${metric.padEnd(48)} -> ${previewValue(v)}`);
  } else {
    const e = data?.error ?? {};
    recordError(category, endpoint, metric, status, {
      code: e.code,
      subcode: e.error_subcode,
      message: e.message,
    });
  }
}

async function probeInsightBreakdown(
  category: string,
  endpoint: string,
  params: Record<string, string | number>,
  label: string,
  token: string,
): Promise<void> {
  const { status, data } = await get(`${GRAPH_BASE}${endpoint}`, {
    ...params,
    access_token: token,
  });
  if (status >= 200 && status < 300) {
    const arr = data?.data ?? [];
    if (arr.length === 0) {
      RESULTS.push({
        category,
        endpoint,
        field: label,
        status: 'SILENT_EMPTY',
        http: status,
        sample: '(zero metrics returned)',
      });
      console.log(`  ⊘ ${String(status).padEnd(3)} ${label.padEnd(48)} -> SILENT_EMPTY`);
      return;
    }
    const first = arr[0];
    const tv = first?.total_value;
    const breakdowns = tv?.breakdowns?.[0]?.results ?? [];
    let sample: string;
    if (breakdowns.length > 0) {
      sample = breakdowns
        .slice(0, 3)
        .map(
          (r: { dimension_values?: string[]; value?: number }) =>
            `${(r.dimension_values ?? []).join('|')}=${r.value}`,
        )
        .join(', ');
    } else if (typeof tv?.value === 'number') {
      sample = String(tv.value);
    } else {
      sample = previewValue(first?.values?.[0]?.value);
    }
    RESULTS.push({
      category,
      endpoint,
      field: label,
      status: 'OK',
      http: status,
      sample,
    });
    console.log(`  ✓ ${String(status).padEnd(3)} ${label.padEnd(48)} -> ${sample}`);
  } else {
    const e = data?.error ?? {};
    recordError(category, endpoint, label, status, {
      code: e.code,
      subcode: e.error_subcode,
      message: e.message,
    });
  }
}

async function pickRepresentativeMedia(
  igUserId: string,
  token: string,
): Promise<Record<string, { id: string; type: string; ts?: string }>> {
  // Fetch the latest 30 media. Bucket by canonical type so we have one of each
  // for the per-type insight probes. STORY is fetched separately.
  const { status, data } = await get(`${GRAPH_BASE}/${igUserId}/media`, {
    fields: 'id,media_type,media_product_type,timestamp',
    limit: 30,
    access_token: token,
  });
  const out: Record<string, { id: string; type: string; ts?: string }> = {};
  if (status >= 200 && status < 300) {
    for (const m of data?.data ?? []) {
      const pt = (m.media_product_type ?? '').toUpperCase();
      const mt = (m.media_type ?? '').toUpperCase();
      let bucket: string | undefined;
      if (pt === 'REELS') bucket = 'REELS';
      else if (mt === 'VIDEO') bucket = 'VIDEO';
      else if (mt === 'IMAGE' || mt === 'CAROUSEL_ALBUM') bucket = 'FEED';
      if (bucket && !out[bucket]) {
        out[bucket] = { id: m.id, type: bucket, ts: m.timestamp };
      }
    }
  }

  // STORY needs the /stories endpoint (24h live).
  try {
    const sres = await get(`${GRAPH_BASE}/${igUserId}/stories`, {
      fields: 'id,media_type,timestamp',
      access_token: token,
    });
    const first = sres.data?.data?.[0];
    if (first?.id) {
      out.STORY = { id: first.id, type: 'STORY', ts: first.timestamp };
    }
  } catch {
    // ignore — stories may legitimately be absent
  }

  return out;
}

function writeMarkdownReport(outPath: string, igUserId: string): void {
  const grouped = new Map<string, ProbeResult[]>();
  for (const r of RESULTS) {
    const arr = grouped.get(r.category) ?? [];
    arr.push(r);
    grouped.set(r.category, arr);
  }

  const lines: string[] = [];
  lines.push(`# IG empirical probe results`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`IG User: \`${igUserId}\``);
  lines.push(`Graph version: \`${GRAPH_VERSION}\``);
  lines.push('');
  lines.push(
    `Source: \`poc/scripts/probe-ig-fields.ts\`. Each row is one isolated Graph call. `,
  );
  lines.push(
    `Phase B/C lists in the implementation plan are filtered against this output — `,
  );
  lines.push(
    `anything in **ERROR** or universal **SILENT_EMPTY** is dropped or moved to \`extra\`.`,
  );
  lines.push('');

  for (const [cat, rows] of grouped) {
    lines.push(`## ${cat}`);
    lines.push('');
    lines.push('| Field / Metric | Endpoint | Result | HTTP | Sample / Error |');
    lines.push('|---|---|---|---|---|');
    for (const r of rows) {
      const result =
        r.status === 'OK'
          ? '✓ OK'
          : r.status === 'SILENT_EMPTY'
            ? '⊘ EMPTY'
            : `✗ ${r.errorCode ?? 'ERROR'}`;
      const sample = r.sample.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(`| \`${r.field}\` | \`${r.endpoint}\` | ${result} | ${r.http} | ${sample} |`);
    }
    lines.push('');
  }

  const ok = RESULTS.filter((r) => r.status === 'OK').length;
  const empty = RESULTS.filter((r) => r.status === 'SILENT_EMPTY').length;
  const err = RESULTS.filter((r) => r.status === 'ERROR').length;
  lines.push('## Summary');
  lines.push('');
  lines.push(`- ✓ OK: **${ok}**`);
  lines.push(`- ⊘ Silent empty: **${empty}**`);
  lines.push(`- ✗ Errors: **${err}**`);
  lines.push(`- Total probes: ${RESULTS.length}`);
  lines.push('');

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'));
  console.log(`\nMarkdown report written to: ${outPath}`);
}

// ---------- Main ----------

async function main(): Promise<void> {
  loadDotenv();

  const accountIdRaw = process.argv[2];
  if (!accountIdRaw) {
    console.error('Usage: ts-node scripts/probe-ig-fields.ts <account_id> [--out=<path>]');
    process.exit(1);
  }
  const accountId = BigInt(accountIdRaw);
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  const outPath = outArg
    ? path.resolve(outArg.slice('--out='.length))
    : path.resolve(__dirname, '..', '..', 'docs', 'ig-probe-results.md');

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
    if (account.platform !== 'instagram') {
      console.error(
        `Account ${accountId} is platform=${account.platform}, expected instagram`,
      );
      process.exit(1);
    }
    const tok = account.tokens[0];
    if (!tok) {
      console.error('No token row for this account');
      process.exit(1);
    }
    const token = decryptToken(Buffer.from(tok.accessTokenCiphertext));
    const igUserId = account.canonicalUserId;

    console.log(`Probing IG ${igUserId} (${account.handle ?? '—'})`);
    console.log(`Token prefix: ${token.slice(0, 12)}…  (length=${token.length})`);
    console.log('');

    // ---- Profile fields ----
    console.log(`— Profile fields on /${igUserId} —`);
    for (const f of PROFILE_FIELDS) {
      await probeField('Profile fields (/{ig-user})', `/${igUserId}`, f, token);
    }
    console.log('');

    // ---- Per-media discovery ----
    console.log(`— Discovering one media per type —`);
    const samples = await pickRepresentativeMedia(igUserId, token);
    for (const [type, m] of Object.entries(samples)) {
      console.log(`  ${type.padEnd(7)} -> ${m.id} (${m.ts ?? '—'})`);
    }
    console.log('');

    if (Object.keys(samples).length === 0) {
      console.log('  (no media available — skipping per-media probes)');
    } else {
      const probeMediaId =
        samples.FEED?.id ?? samples.REELS?.id ?? samples.VIDEO?.id;
      if (probeMediaId) {
        console.log(`— Per-media fields on /${probeMediaId} —`);
        for (const f of MEDIA_FIELDS) {
          await probeField(
            'Per-media fields (/{media})',
            `/${probeMediaId}`,
            f,
            token,
          );
        }
        console.log('');
      }

      // Per-media insights — one metric per call, per media type.
      for (const [type, m] of Object.entries(samples)) {
        const candidates = MEDIA_METRICS_BY_TYPE[type] ?? [];
        if (candidates.length === 0) continue;
        console.log(`— Per-media insights (${type}) on /${m.id}/insights —`);
        for (const metric of candidates) {
          await probeInsightMetric(
            `Per-media insights — ${type}`,
            m.id,
            metric,
            token,
          );
        }
        console.log('');
      }

      // Per-media breakdowns.
      for (const bd of MEDIA_BREAKDOWNS) {
        for (const type of bd.appliesTo) {
          const m = samples[type];
          if (!m) continue;
          const label = `${bd.metric} × ${bd.breakdown}`;
          console.log(`— Per-media breakdown (${type}) ${label} on /${m.id}/insights —`);
          await probeInsightBreakdown(
            `Per-media breakdowns — ${type}`,
            `/${m.id}/insights`,
            { metric: bd.metric, breakdown: bd.breakdown, metric_type: 'total_value' },
            label,
            token,
          );
        }
      }
      console.log('');
    }

    // ---- Account-level new probes ----
    console.log(`— Account-level new probes on /${igUserId}/insights —`);
    const since = Math.floor(Date.now() / 1000) - 28 * 86_400;
    const until = Math.floor(Date.now() / 1000);
    for (const probe of ACCOUNT_BREAKDOWNS) {
      const params: Record<string, string | number> = {
        metric: probe.metric,
        period: probe.period,
        since,
        until,
      };
      if (probe.breakdown) params.breakdown = probe.breakdown;
      if (probe.metricType) params.metric_type = probe.metricType;
      const label = probe.breakdown
        ? `${probe.metric} × ${probe.breakdown} (period=${probe.period})`
        : `${probe.metric} (period=${probe.period})`;
      await probeInsightBreakdown(
        'Account-level new probes',
        `/${igUserId}/insights`,
        params,
        label,
        token,
      );
    }
    console.log('');

    writeMarkdownReport(outPath, igUserId);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
