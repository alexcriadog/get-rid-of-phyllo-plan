// Public Pages monitor — surfaces snapshots of third-party FB Pages tracked
// via the Page Public Content Access feature (admin endpoint
// /admin/ca/public-pages/snapshot). Reads from `public_page_snapshots`.
//
// Includes a client-side form to add a new tracked page or refresh an
// existing snapshot. All mutations go through the admin endpoint so the
// CA-only gating + token resolution stays server-side.

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import { getDb } from '../../../lib/mongo';
import { fmtNumber } from '../../../lib/format';
import { RelativeTime } from '../../../components/RelativeTime';

type IdentitySnapshot = {
  account_id: string;
  platform: string;
  data?: { username?: string; displayName?: string };
};

type PublicPagePost = {
  id: string;
  message: string | null;
  created_time: string | null;
  permalink_url: string | null;
  full_picture: string | null;
  reactions_total: number;
  comments_total: number;
};

type PublicPageSnapshot = {
  owner_account_id: string;
  page_id: string;
  name: string | null;
  fan_count: number | null;
  followers_count: number | null;
  about: string | null;
  category: string | null;
  link: string | null;
  picture_url: string | null;
  recent_posts: PublicPagePost[];
  captured_at: string | null;
};

type PageProps = {
  id: string;
  identity: IdentitySnapshot | null;
  snapshots: PublicPageSnapshot[];
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const id = String(ctx.params?.id || '');
  try {
    const db = await getDb();
    const filters = [{ account_id: id }, { account_id: Number(id) || id }];
    const [identityDoc, snapDocs] = await Promise.all([
      db.collection('identity_snapshots').findOne({ $or: filters }),
      db
        .collection('public_page_snapshots')
        .find({ owner_account_id: id })
        .sort({ captured_at: -1 })
        .limit(50)
        .toArray(),
    ]);
    const identity = identityDoc
      ? (toPlainJson(identityDoc) as IdentitySnapshot)
      : null;
    if (identity && identity.platform !== 'facebook') {
      return { redirect: { destination: `/account/${id}`, permanent: false } };
    }
    return {
      props: {
        id,
        identity,
        snapshots: snapDocs.map((d) => toPlainJson(d) as PublicPageSnapshot),
      },
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return { props: { id, identity: null, snapshots: [] } };
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

const ADMIN_BASE =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_ADMIN_BASE
    ? process.env.NEXT_PUBLIC_ADMIN_BASE
    : 'http://localhost:3001';

export default function PublicPagesPage({ id, snapshots }: PageProps) {
  const router = useRouter();
  const [pageId, setPageId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pageId.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, string> = { page_id: pageId.trim() };
      if (accessToken.trim()) body.access_token = accessToken.trim();
      const res = await fetch(
        `${ADMIN_BASE}/admin/ca/public-pages/snapshot/${id}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      setPageId('');
      router.replace(router.asPath);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="v-canvas">
      <div style={{ maxWidth: 1300, margin: '0 auto', padding: '32px 48px 96px' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <Link href={`/account/${id}`} className="v-meta">
            ← Overview
          </Link>
          <Link href={`/account/${id}/ads`} className="v-meta">
            Ads →
          </Link>
          <div style={{ flex: 1 }} />
          <span className="v-tag outline">{snapshots.length} tracked</span>
        </header>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <span className="v-kicker mint">Competitive intel</span>
          <span className="v-eyebrow" style={{ color: '#fff' }}>
            Pages we watch (without owning them)
          </span>
          <div style={{ flex: 1, height: 1, background: '#3d00bf' }} />
        </div>

        <h1 className="v-display size-secondary" style={{ marginBottom: 32 }}>
          Track. Without permission required.
        </h1>

        <form
          onSubmit={onSnapshot}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr auto',
            gap: 12,
            padding: 20,
            border: '1px solid #ffffff',
            borderRadius: 18,
            background: '#131313',
            marginBottom: 32,
          }}
        >
          <input
            type="text"
            placeholder="Page ID (e.g., 228735667216)"
            value={pageId}
            onChange={(e) => setPageId(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            type="text"
            placeholder="Access token (optional — uses stored)"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={busy || !pageId.trim()}
            className="v-pill-primary"
            style={{ minWidth: 140 }}
          >
            {busy ? 'Snapping…' : 'Take snapshot'}
          </button>
          {err && (
            <div
              style={{
                gridColumn: '1 / -1',
                fontFamily: 'var(--v-mono)',
                fontSize: 11,
                color: '#5200ff',
              }}
            >
              ↯ {err}
            </div>
          )}
        </form>

        {snapshots.length === 0 ? (
          <div className="v-tile" style={{ padding: 32 }}>
            <span className="v-kicker mint">Empty watchlist</span>
            <h2 className="v-display size-tertiary" style={{ marginTop: 8 }}>
              No public pages tracked yet
            </h2>
            <p className="v-body" style={{ marginTop: 10 }}>
              Drop a Facebook Page numeric id above (the digits in the page&apos;s
              URL) to capture its public metadata + 12 most recent posts. We use
              this to benchmark sponsors and competitors.
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
            {snapshots.map((s) => (
              <SnapshotCard key={s.page_id} snap={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: '#0e0e0e',
  border: '1px solid rgba(255,255,255,0.16)',
  color: '#fff',
  borderRadius: 10,
  padding: '10px 14px',
  fontFamily: 'var(--v-mono)',
  fontSize: 12,
  outline: 'none',
};

function SnapshotCard({ snap }: { snap: PublicPageSnapshot }) {
  return (
    <div
      style={{
        borderRadius: 20,
        border: '1px solid #ffffff',
        background:
          'radial-gradient(120% 80% at 0% 0%, rgba(60,255,208,0.08) 0%, rgba(19,19,19,0) 55%), linear-gradient(180deg, #161616 0%, #0e0e0e 100%)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 14,
          alignItems: 'center',
          padding: 18,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {snap.picture_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={snap.picture_url}
            alt={snap.name ?? snap.page_id}
            width={56}
            height={56}
            referrerPolicy="no-referrer"
            style={{
              borderRadius: '50%',
              border: '2px solid #ffffff',
              objectFit: 'cover',
            }}
          />
        ) : (
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: '#2d2d2d',
              border: '2px solid #ffffff',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--v-mint)',
              fontFamily: 'var(--v-display)',
              fontSize: 24,
            }}
          >
            {(snap.name ?? '?').charAt(0).toUpperCase()}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="v-display"
            style={{ fontSize: 22, color: '#fff', lineHeight: 1.1 }}
          >
            {snap.name ?? `Page ${snap.page_id}`}
          </div>
          <div
            style={{
              fontFamily: 'var(--v-mono)',
              fontSize: 10,
              letterSpacing: '0.12em',
              color: 'var(--v-text-muted)',
              marginTop: 4,
            }}
          >
            {snap.category ?? '—'} · #{snap.page_id}
          </div>
        </div>
      </div>

      <div style={{ padding: 18, display: 'flex', gap: 18 }}>
        <Stat label="Followers" value={fmtNumber(snap.followers_count ?? null)} />
        <Stat label="Fans" value={fmtNumber(snap.fan_count ?? null)} />
        <Stat
          label="Recent posts"
          value={fmtNumber(snap.recent_posts?.length ?? 0)}
        />
      </div>

      {snap.about && (
        <p
          style={{
            margin: '0 18px 16px',
            fontFamily: 'var(--v-sans)',
            fontSize: 13,
            lineHeight: 1.45,
            color: 'rgba(255,255,255,0.78)',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {snap.about}
        </p>
      )}

      {snap.recent_posts.length > 0 && (
        <div
          style={{
            padding: '14px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            borderTop: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--v-mono)',
              fontSize: 10,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--v-text-muted)',
            }}
          >
            Latest posts
          </div>
          {snap.recent_posts.slice(0, 3).map((p) => (
            <a
              key={p.id}
              href={p.permalink_url ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block',
                fontFamily: 'var(--v-sans)',
                fontSize: 13,
                lineHeight: 1.4,
                color: '#fff',
                textDecoration: 'none',
                paddingLeft: 12,
                borderLeft: '2px solid var(--v-mint)',
              }}
            >
              <span
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {p.message ?? '(no caption)'}
              </span>
              <span
                style={{
                  fontFamily: 'var(--v-mono)',
                  fontSize: 10,
                  color: 'var(--v-text-muted)',
                  marginTop: 4,
                  display: 'block',
                }}
              >
                ♥ {fmtNumber(p.reactions_total)} · ✎{' '}
                {fmtNumber(p.comments_total)}
                {p.created_time && (
                  <>
                    {' · '}
                    <RelativeTime value={p.created_time} />
                  </>
                )}
              </span>
            </a>
          ))}
        </div>
      )}

      <div
        style={{
          padding: '10px 18px',
          fontFamily: 'var(--v-mono)',
          fontSize: 10,
          color: 'var(--v-text-muted)',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span>
          Captured <RelativeTime value={snap.captured_at} />
        </span>
        <div style={{ flex: 1 }} />
        {snap.link && (
          <a
            href={snap.link}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--v-mint)', textDecoration: 'none' }}
          >
            ↗ open
          </a>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        className="v-display"
        style={{ fontSize: 22, color: '#fff', lineHeight: 1 }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: 'var(--v-mono)',
          fontSize: 10,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--v-text-muted)',
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  );
}
