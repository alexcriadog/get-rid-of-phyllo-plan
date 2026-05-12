// Engagement-deep subpage — per-content windowed analytics + retention
// curve. Cross-platform in shape (any adapter that implements
// `fetchEngagementDeep` deposits into the `engagement_deep_snapshots`
// Mongo collection). Today YouTube is the only producer; FB / IG / TikTok
// will get this surface once their adapters opt in.

import Link from 'next/link';
import type { GetServerSideProps } from 'next';
import { getDb } from '../../../lib/mongo';
import { RelativeTime } from '../../../components/RelativeTime';
import {
  EngagementDeepSection,
  type EngagementDeepSnapshot,
} from '../../../components/account/EngagementDeepSection';

type IdentitySnapshot = {
  account_id: string;
  platform: string;
  data?: { username?: string; displayName?: string };
};

type PostData = {
  platformContentId?: string;
  thumbnailUrl?: string | null;
  publishedAt?: string | null;
  caption?: string | null;
  duration?: string | null;
};

type Post = {
  account_id: string;
  platform: string;
  platform_content_id: string;
  data?: PostData;
};

type EngagementDeepDoc = {
  account_id: string;
  platform: string;
  data?: EngagementDeepSnapshot;
  updated_at?: string;
};

type PageProps = {
  id: string;
  identity: IdentitySnapshot | null;
  snapshot: EngagementDeepDoc | null;
  posts: Post[];
};

// Adapters that produce engagement_deep_snapshots. Other platforms get
// redirected to the overview page rather than landing on an empty
// section.
const SUPPORTED_PLATFORMS = new Set<string>(['youtube']);

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const id = String(ctx.params?.id || '');
  try {
    const db = await getDb();
    const filters = [{ account_id: id }, { account_id: Number(id) || id }];
    const [identityDoc, snapshotDoc, postDocs] = await Promise.all([
      db.collection('identity_snapshots').findOne({ $or: filters }),
      db
        .collection('engagement_deep_snapshots')
        .findOne({ $or: filters }, { sort: { updated_at: -1 } }),
      // Pull recent posts so we can decorate snapshot items with thumb/
      // title (the engagement_deep doc only carries contentIds).
      db
        .collection('posts')
        .find({ $or: filters })
        .sort({ 'data.publishedAt': -1, updated_at: -1 })
        .limit(50)
        .toArray(),
    ]);
    const identity = identityDoc
      ? (toPlainJson(identityDoc) as IdentitySnapshot)
      : null;
    if (identity && !SUPPORTED_PLATFORMS.has(identity.platform)) {
      return { redirect: { destination: `/account/${id}`, permanent: false } };
    }
    return {
      props: {
        id,
        identity,
        snapshot: snapshotDoc
          ? (toPlainJson(snapshotDoc) as EngagementDeepDoc)
          : null,
        posts: postDocs.map((p) => toPlainJson(p) as Post),
      },
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return { props: { id, identity: null, snapshot: null, posts: [] } };
  }
};

function toPlainJson(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(toPlainJson);
  if (typeof value === 'object') {
    const maybeHex = (value as { toHexString?: () => string }).toHexString;
    if (typeof maybeHex === 'function') return maybeHex.call(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toPlainJson(v);
    }
    return out;
  }
  return value;
}

export default function EngagementDeepPage({
  id,
  identity,
  snapshot,
  posts,
}: PageProps) {
  const ownerHandle =
    identity?.data?.username ?? identity?.data?.displayName ?? '';
  const videoMeta = buildVideoMeta(posts);

  return (
    <div className="v-canvas">
      <div style={{ maxWidth: 1300, margin: '0 auto', padding: '32px 48px 96px' }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            marginBottom: 24,
            flexWrap: 'wrap',
          }}
        >
          <Link href={`/account/${id}`} className="v-meta">
            ← Overview
          </Link>
          {identity?.platform === 'youtube' && (
            <Link href={`/account/${id}/ads`} className="v-meta">
              Ads →
            </Link>
          )}
          <div style={{ flex: 1 }} />
          {ownerHandle && (
            <span
              style={{
                fontFamily: 'var(--v-mono)',
                fontSize: 11,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--v-text-muted)',
              }}
            >
              {ownerHandle}
            </span>
          )}
        </header>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 16 }}>
          <h1
            className="v-display"
            style={{ fontSize: 'clamp(36px, 5vw, 64px)', margin: 0, color: '#fff' }}
          >
            Engagement deep
          </h1>
          {snapshot?.updated_at && (
            <span
              style={{
                fontFamily: 'var(--v-mono)',
                fontSize: 11,
                color: 'var(--v-text-muted)',
              }}
            >
              updated <RelativeTime value={snapshot.updated_at} />
            </span>
          )}
        </div>

        <p
          className="v-body"
          style={{ maxWidth: 720, color: 'var(--v-text-subtle)', marginBottom: 24 }}
        >
          Per-video Analytics drill-down: views, watch time, engagement, card
          and annotation CTR, plus traffic source / country / device /
          demographic / sharing breakdowns sliced per video. Includes the
          audience retention curve for the top-viewed video in the window.
          Refreshed every 6 hours by the <code>engagement_deep</code> sync
          product.
        </p>

        <EngagementDeepSection
          snapshot={snapshot?.data ?? null}
          videoMeta={videoMeta}
          fetchedAt={snapshot?.updated_at}
        />
      </div>
    </div>
  );
}

function buildVideoMeta(
  posts: Post[],
): Record<
  string,
  { title?: string; thumbnailUrl?: string; duration?: string; publishedAt?: string }
> {
  const map: Record<
    string,
    { title?: string; thumbnailUrl?: string; duration?: string; publishedAt?: string }
  > = {};
  for (const p of posts) {
    const id = p.platform_content_id ?? p.data?.platformContentId ?? null;
    if (!id) continue;
    const title =
      typeof p.data?.caption === 'string'
        ? p.data.caption.split('\n')[0]
        : undefined;
    map[id] = {
      title,
      thumbnailUrl: p.data?.thumbnailUrl ?? undefined,
      duration: p.data?.duration ?? undefined,
      publishedAt: p.data?.publishedAt ?? undefined,
    };
  }
  return map;
}
