/**
 * Probe Facebook Page Story metrics across every plausible endpoint.
 *
 * Approach: we don't trust the official docs (they don't list a per-story
 * insights endpoint in v22), so we hit several candidate URLs against a
 * real story we already pulled and report status/body for each. Read-only.
 *
 * Run from poc/ with:
 *   npx ts-node -r tsconfig-paths/register scripts/fb-debug-story-insights.ts <account_id>
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
  const status = res.status;
  if (status >= 200 && status < 300) {
    const body = res.data;
    let summary: string;
    if (body && typeof body === 'object' && Array.isArray(body.data)) {
      summary = body.data
        .map((d: { name?: string; values?: Array<{ value: unknown }>; total_value?: unknown }) => {
          const last = d.values?.[d.values.length - 1]?.value;
          const tv = d.total_value;
          const preview =
            tv !== undefined
              ? JSON.stringify(tv).slice(0, 140)
              : typeof last === 'object' && last !== null
                ? JSON.stringify(last).slice(0, 140)
                : String(last);
          return `${d.name}=${preview}`;
        })
        .join(' | ');
      if (!summary) summary = '(empty data[])';
    } else {
      summary = JSON.stringify(body).slice(0, 240);
    }
    return `OK ${status} ${summary}`;
  }
  const err = res.data?.error;
  const code = err?.code != null ? `#${err.code}` : '';
  const sub = err?.error_subcode != null ? `/${err.error_subcode}` : '';
  const msg = err?.message ?? JSON.stringify(res.data).slice(0, 200);
  return `ERR ${status} ${code}${sub} ${msg}`;
}

async function probeUrl(
  label: string,
  url: string,
  params: Record<string, string>,
  token: string,
): Promise<void> {
  const res = await axios.get(url, {
    params: { ...params, access_token: token },
    timeout: 15_000,
    validateStatus: () => true,
  });
  console.log(`  ${label}`);
  console.log(`    -> ${summarise(res)}`);
}

async function main(): Promise<void> {
  loadDotenv();

  const accountIdRaw = process.argv[2];
  if (!accountIdRaw) {
    console.error('Usage: ts-node scripts/fb-debug-story-insights.ts <account_id>');
    process.exit(1);
  }
  const accountId = BigInt(accountIdRaw);

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

    const storyListRes = await axios.get(`${GRAPH_BASE}/${pageId}/stories`, {
      params: {
        fields: 'post_id,status,creation_time,media_type,media_id,url',
        access_token: token,
      },
      timeout: 15_000,
      validateStatus: () => true,
    });
    if (storyListRes.status !== 200 || !storyListRes.data?.data?.length) {
      console.error('No stories returned by /{page_id}/stories — cannot probe.');
      console.error(JSON.stringify(storyListRes.data, null, 2));
      process.exit(1);
    }
    const story = storyListRes.data.data[0] as {
      post_id: string;
      status?: string;
      creation_time?: string;
      media_type?: string;
      media_id?: string;
      url?: string;
    };
    const composite = `${pageId}_${story.post_id}`;

    console.log('=== Story under test ===');
    console.log(JSON.stringify(story, null, 2));
    console.log(`page_id        = ${pageId}`);
    console.log(`post_id        = ${story.post_id}`);
    console.log(`composite      = ${composite}`);
    console.log(`media_id       = ${story.media_id ?? '-'}`);
    console.log('');

    console.log('--- 1. Field discovery on the story object ---');
    await probeUrl(
      `GET /${story.post_id}?metadata=1`,
      `${GRAPH_BASE}/${story.post_id}`,
      { metadata: '1' },
      token,
    );
    await probeUrl(
      `GET /${composite}?metadata=1`,
      `${GRAPH_BASE}/${composite}`,
      { metadata: '1' },
      token,
    );
    if (story.media_id) {
      await probeUrl(
        `GET /${story.media_id}?metadata=1`,
        `${GRAPH_BASE}/${story.media_id}`,
        { metadata: '1' },
        token,
      );
    }

    console.log('');
    console.log('--- 2. Direct engagement fields on the story object ---');
    const engagementFieldSets = [
      'id,reactions.summary(total_count)',
      'id,comments.summary(total_count)',
      'id,shares',
      'id,likes.summary(total_count)',
      'id,insights',
    ];
    for (const fields of engagementFieldSets) {
      await probeUrl(
        `GET /${story.post_id}?fields=${fields}`,
        `${GRAPH_BASE}/${story.post_id}`,
        { fields },
        token,
      );
      await probeUrl(
        `GET /${composite}?fields=${fields}`,
        `${GRAPH_BASE}/${composite}`,
        { fields },
        token,
      );
    }

    console.log('');
    console.log('--- 3. /insights edge with no metric ---');
    await probeUrl(
      `GET /${story.post_id}/insights`,
      `${GRAPH_BASE}/${story.post_id}/insights`,
      {},
      token,
    );
    await probeUrl(
      `GET /${composite}/insights`,
      `${GRAPH_BASE}/${composite}/insights`,
      {},
      token,
    );

    console.log('');
    console.log('--- 4. Per-metric probes against /insights ---');
    const candidateMetrics = [
      'post_impressions',
      'post_impressions_unique',
      'post_impressions_organic',
      'post_impressions_paid',
      'post_engaged_users',
      'post_clicks',
      'post_clicks_by_type',
      'post_reactions_by_type_total',
      'post_reactions_like_total',
      'post_negative_feedback',
      'post_video_views',
      'post_video_views_unique',
      'post_video_complete_views_30s',
      'post_video_avg_time_watched',
      'post_video_view_time',
      'total_video_views',
      'total_video_impressions',
      'story_impressions',
      'story_replies',
      'story_reach',
      'story_taps_forward',
      'story_taps_back',
      'story_exits',
      'post_story_adds',
      'post_story_taps_forward',
      'post_story_taps_back',
      'post_story_exits',
      'post_story_replies',
      'post_story_engagement',
    ];
    for (const metric of candidateMetrics) {
      await probeUrl(
        `metric=${metric}  on /${story.post_id}`,
        `${GRAPH_BASE}/${story.post_id}/insights`,
        { metric },
        token,
      );
    }
    console.log('');
    for (const metric of candidateMetrics) {
      await probeUrl(
        `metric=${metric}  on /${composite}`,
        `${GRAPH_BASE}/${composite}/insights`,
        { metric },
        token,
      );
    }

    if (story.media_id) {
      console.log('');
      console.log('--- 5. Per-metric probes against /{media_id}/insights ---');
      for (const metric of candidateMetrics) {
        await probeUrl(
          `metric=${metric}  on /${story.media_id}`,
          `${GRAPH_BASE}/${story.media_id}/insights`,
          { metric },
          token,
        );
      }
      console.log('');
      console.log('--- 5b. Per-metric probes against /{media_id}/video_insights ---');
      for (const metric of [
        'total_video_views',
        'total_video_views_unique',
        'total_video_impressions',
        'total_video_reactions_by_type_total',
      ]) {
        await probeUrl(
          `metric=${metric}  on /${story.media_id}/video_insights`,
          `${GRAPH_BASE}/${story.media_id}/video_insights`,
          { metric },
          token,
        );
      }
    }

    console.log('');
    console.log('--- 6. Page-level story aggregates ---');
    const pageStoryMetrics = [
      'page_stories',
      'page_stories_by_story_type',
      'page_content_activity_by_action_type_unique',
      'page_consumptions_by_consumption_type',
      'page_engaged_users',
    ];
    for (const metric of pageStoryMetrics) {
      await probeUrl(
        `metric=${metric}  on /${pageId}/insights period=day`,
        `${GRAPH_BASE}/${pageId}/insights`,
        { metric, period: 'day' },
        token,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
