// Public-UI watchlist detail. Brutalist theme matching /account/[id].

import Link from 'next/link';
import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import { useState } from 'react';
import { adminDelete, adminPost } from '../../lib/api';
import { fmtNumber } from '../../lib/format';
import { RelativeTime } from '../../components/RelativeTime';
import { getDb } from '../../lib/mongo';

interface PublicPagePost {
  id: string;
  message: string | null;
  story: string | null;
  created_time: string | null;
  permalink_url: string | null;
  full_picture: string | null;
  reactions_total: number;
  comments_total: number;
  shares_total: number;
}

interface Snapshot {
  page_id: string;
  name: string | null;
  username: string | null;
  category: string | null;
  category_list: Array<{ id: string; name: string }> | null;
  about: string | null;
  description: string | null;
  bio: string | null;
  link: string | null;
  picture_url: string | null;
  cover_url: string | null;
  fan_count: number | null;
  followers_count: number | null;
  talking_about_count: number | null;
  were_here_count: number | null;
  verification_status: string | null;
  is_verified: boolean | null;
  location: Record<string, unknown> | null;
  phone: string | null;
  website: string | null;
  emails: string[] | null;
  company_overview: string | null;
  founded: string | null;
  mission: string | null;
  products: string | null;
  parent_page: { id: string; name: string } | null;
  rating_count: number | null;
  overall_star_rating: number | null;
  price_range: string | null;
  recent_posts: PublicPagePost[];
  captured_at: string | null;
  tracked_at: string | null;
}

type Props = { snap: Snapshot | null; pageId: string };

const isVerified = (s?: string | null, b?: boolean | null) =>
  b === true || s === 'blue_verified';

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const pageId = String(ctx.params?.pageId || '');
  try {
    const db = await getDb();
    const doc = await db
      .collection('public_page_snapshots')
      .findOne({ page_id: pageId });
    if (!doc) return { props: { snap: null, pageId } };
    return { props: { snap: toPlainJson(doc) as Snapshot, pageId } };
  } catch {
    return { props: { snap: null, pageId } };
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

export default function WatchlistDetailPage({ snap, pageId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<'refresh' | 'remove' | null>(null);

  if (!snap) {
    return (
      <div className="v-canvas">
        <div style={{ maxWidth: 800, margin: '120px auto', padding: 32, textAlign: 'center' }}>
          <h1 className="v-display size-tertiary">Page not tracked</h1>
          <p className="v-body" style={{ color: 'var(--v-text-muted)' }}>
            <code>{pageId}</code> is not in the watchlist.
          </p>
          <Link href="/watchlist" className="v-pill-outline-mint" style={{ marginTop: 24 }}>
            ← Watchlist
          </Link>
        </div>
      </div>
    );
  }

  const refresh = async () => {
    setBusy('refresh');
    try {
      await adminPost(`/admin/watchlist/${snap.page_id}/refresh`);
      router.replace(router.asPath);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm(`Untrack ${snap.name ?? snap.page_id}?`)) return;
    setBusy('remove');
    try {
      await adminDelete(`/admin/watchlist/${snap.page_id}`);
      router.push('/watchlist');
    } finally {
      setBusy(null);
    }
  };

  const fans = typeof snap.fan_count === 'number' ? snap.fan_count : snap.followers_count;
  const followers =
    typeof snap.followers_count === 'number' && snap.followers_count !== fans
      ? snap.followers_count
      : null;
  const loc = snap.location
    ? [
        (snap.location.street as string) ?? '',
        (snap.location.city as string) ?? '',
        (snap.location.state as string) ?? '',
        (snap.location.country as string) ?? '',
      ]
        .filter(Boolean)
        .join(', ')
    : '';

  return (
    <div className="v-canvas">
      <div style={{ maxWidth: 1300, margin: '0 auto', padding: '32px 48px 96px' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
          <Link href="/watchlist" className="v-pill-outline-mint">← Watchlist</Link>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={refresh}
            disabled={!!busy}
            className="v-pill-outline-mint"
          >
            {busy === 'refresh' ? '…' : '↻ Refresh'}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={!!busy}
            className="v-pill-outline-mint"
            style={{ borderColor: 'rgba(255,80,80,0.45)', color: '#ff8a8a' }}
          >
            ✕ Untrack
          </button>
        </header>

        <div className="v-tile" style={{ padding: 0, overflow: 'hidden', marginBottom: 32 }}>
          {snap.cover_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={snap.cover_url}
              alt=""
              style={{ width: '100%', height: 220, objectFit: 'cover' }}
              referrerPolicy="no-referrer"
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: 220,
                background:
                  'linear-gradient(135deg, rgba(82,0,255,0.55) 0%, rgba(60,255,208,0.3) 100%)',
              }}
            />
          )}
          <div style={{ padding: 32 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24, marginTop: -100 }}>
              {snap.picture_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={snap.picture_url}
                  alt=""
                  width={140}
                  height={140}
                  style={{
                    width: 140,
                    height: 140,
                    borderRadius: '50%',
                    objectFit: 'cover',
                    border: '4px solid #0e0e0e',
                    background: '#0e0e0e',
                    flexShrink: 0,
                  }}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div
                  style={{
                    width: 140,
                    height: 140,
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.1)',
                    border: '4px solid #0e0e0e',
                  }}
                />
              )}
              <div style={{ paddingBottom: 8, flex: 1, minWidth: 0 }}>
                <h1
                  className="v-display"
                  style={{
                    fontSize: 'clamp(40px, 5vw, 64px)',
                    lineHeight: 1,
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <span
                    style={{
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '100%',
                    }}
                  >
                    {snap.name ?? snap.page_id}
                  </span>
                  {isVerified(snap.verification_status, snap.is_verified) && (
                    <span style={{ color: 'var(--v-mint)', fontSize: 32 }}>✓</span>
                  )}
                </h1>
                <div
                  className="v-meta"
                  style={{ marginTop: 8, display: 'flex', gap: 12, flexWrap: 'wrap' }}
                >
                  {snap.username && <span>@{snap.username}</span>}
                  {snap.category && <span>· {snap.category}</span>}
                  {snap.link && (
                    <a
                      href={snap.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--v-mint)', textDecoration: 'none' }}
                    >
                      ↗ facebook.com
                    </a>
                  )}
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: 24,
                marginTop: 32,
                paddingTop: 24,
                borderTop: '1px solid rgba(255,255,255,0.18)',
              }}
            >
              <Kpi label="Fans" value={fans} />
              <Kpi label="Followers" value={followers ?? snap.followers_count} />
              <Kpi label="Talking about" value={snap.talking_about_count} />
              <Kpi label="Were here" value={snap.were_here_count} />
            </div>

            {snap.about && (
              <p
                className="v-body"
                style={{
                  marginTop: 24,
                  whiteSpace: 'pre-line',
                  color: 'var(--v-text-muted)',
                }}
              >
                {snap.about}
              </p>
            )}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 20,
            marginBottom: 40,
          }}
        >
          <DetailPanel title="About">
            <Field label="Description" value={snap.description} />
            <Field label="Bio" value={snap.bio} />
            <Field label="Mission" value={snap.mission} />
            <Field label="Company overview" value={snap.company_overview} />
            <Field label="Products" value={snap.products} />
            <Field label="Founded" value={snap.founded} />
            <Field label="Price range" value={snap.price_range} />
            {typeof snap.overall_star_rating === 'number' && (
              <Field
                label="Rating"
                value={`${snap.overall_star_rating.toFixed(1)} ★ (${fmtNumber(snap.rating_count ?? 0)})`}
              />
            )}
            <Field
              label="Categories"
              value={
                snap.category_list?.length
                  ? snap.category_list.map((c) => c.name).join(', ')
                  : null
              }
            />
            <Field
              label="Parent page"
              value={snap.parent_page ? snap.parent_page.name : null}
            />
          </DetailPanel>

          <DetailPanel title="Contact">
            <Field label="Location" value={loc || null} />
            <Field label="Phone" value={snap.phone} />
            <Field
              label="Website"
              value={
                snap.website ? (
                  <a
                    href={
                      snap.website.startsWith('http')
                        ? snap.website
                        : `https://${snap.website}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--v-mint)' }}
                  >
                    {snap.website}
                  </a>
                ) : null
              }
            />
            <Field
              label="Emails"
              value={snap.emails?.length ? snap.emails.join(', ') : null}
            />
          </DetailPanel>

          <DetailPanel title="Capture">
            <Field
              label="Tracked"
              value={
                snap.tracked_at ? <RelativeTime value={snap.tracked_at} /> : null
              }
            />
            <Field
              label="Captured"
              value={
                snap.captured_at ? <RelativeTime value={snap.captured_at} /> : null
              }
            />
            <Field label="Verification" value={snap.verification_status} />
            <Field label="Page id" value={<code>{snap.page_id}</code>} />
          </DetailPanel>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <span className="v-kicker mint">Recent</span>
          <span className="v-eyebrow" style={{ color: '#ffffff' }}>
            Posts
          </span>
          <div style={{ flex: 1, height: 1, background: '#3d00bf' }} />
          <span className="v-meta">
            {String(snap.recent_posts.length).padStart(2, '0')}
          </span>
        </div>

        {snap.recent_posts.length === 0 ? (
          <div
            className="v-tile"
            style={{
              padding: 48,
              textAlign: 'center',
              border: '1px dashed rgba(255,255,255,0.25)',
            }}
          >
            <p className="v-body" style={{ color: 'var(--v-text-muted)' }}>
              This Page hasn&apos;t exposed posts via PPCA, or has none.
            </p>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
              gap: 20,
            }}
          >
            {snap.recent_posts.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div>
      <div className="v-display" style={{ fontSize: 36, lineHeight: 1, color: '#fff' }}>
        {typeof value === 'number' ? fmtNumber(value) : '—'}
      </div>
      <div className="v-meta" style={{ marginTop: 6, color: 'var(--v-text-muted)' }}>
        {label}
      </div>
    </div>
  );
}

function DetailPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="v-tile" style={{ padding: 24 }}>
      <span className="v-kicker mint" style={{ marginBottom: 16, display: 'block' }}>
        {title}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode | null | undefined;
}) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div>
      <div className="v-meta" style={{ marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: '#fff', lineHeight: 1.5, wordBreak: 'break-word' }}>
        {value}
      </div>
    </div>
  );
}

function PostCard({ post }: { post: PublicPagePost }) {
  return (
    <a
      href={post.permalink_url ?? '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="v-tile"
      style={{
        padding: 0,
        overflow: 'hidden',
        textDecoration: 'none',
        color: 'inherit',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {post.full_picture && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={post.full_picture}
          alt=""
          style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover' }}
          referrerPolicy="no-referrer"
        />
      )}
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
        {post.created_time && (
          <div className="v-meta">
            <RelativeTime value={post.created_time} />
          </div>
        )}
        <p
          style={{
            margin: 0,
            fontSize: 13,
            lineHeight: 1.6,
            color: '#fff',
            display: '-webkit-box',
            WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {post.message ?? post.story ?? '(no caption)'}
        </p>
        <div
          style={{
            display: 'flex',
            gap: 16,
            paddingTop: 12,
            borderTop: '1px solid rgba(255,255,255,0.15)',
            color: 'var(--v-text-muted)',
            fontSize: 12,
            marginTop: 'auto',
          }}
        >
          <span>♥ {fmtNumber(post.reactions_total)}</span>
          <span>💬 {fmtNumber(post.comments_total)}</span>
          {post.shares_total > 0 && <span>↻ {fmtNumber(post.shares_total)}</span>}
        </div>
      </div>
    </a>
  );
}
