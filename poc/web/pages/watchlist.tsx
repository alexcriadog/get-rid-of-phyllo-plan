// Public-UI watchlist — search any FB Page, track it, see summary cards.
// Same brutalist theme as /feed and /account/[id]. Backed by the existing
// /admin/watchlist API (PPCA, app token).

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLive } from '../lib/useLive';
import { adminDelete, adminPost, CONNECTOR_API_URL } from '../lib/api';
import { fmtNumber } from '../lib/format';
import { RelativeTime } from '../components/RelativeTime';

interface SearchHit {
  id: string;
  name: string | null;
  username: string | null;
  category: string | null;
  verification_status: string | null;
  is_verified: boolean | null;
  fan_count: number | null;
  followers_count: number | null;
  link: string | null;
  picture_url: string | null;
  already_tracked: boolean;
}

interface WatchedPage {
  page_id: string;
  name: string | null;
  username: string | null;
  category: string | null;
  about: string | null;
  link: string | null;
  picture_url: string | null;
  cover_url: string | null;
  fan_count: number | null;
  followers_count: number | null;
  talking_about_count: number | null;
  verification_status: string | null;
  is_verified: boolean | null;
  recent_posts: Array<{ id: string }>;
  captured_at: string | null;
  tracked_at: string | null;
}

const isVerified = (s?: string | null, b?: boolean | null) =>
  b === true || s === 'blue_verified';

export default function WatchlistPage() {
  const live = useLive<{ items?: WatchedPage[] }>('/admin/watchlist', 5000);
  const items = useMemo<WatchedPage[]>(
    () => (Array.isArray(live.data) ? live.data : (live.data?.items ?? [])),
    [live.data],
  );

  return (
    <div className="v-canvas">
      <div
        style={{
          maxWidth: 1300,
          margin: '0 auto',
          padding: '32px 48px 96px',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 16,
            borderBottom: '1px solid #ffffff',
            paddingBottom: 16,
            marginBottom: 32,
          }}
        >
          <div>
            <div className="v-meta" style={{ marginBottom: 8 }}>Connector / Watchlist</div>
            <h1 className="v-display size-hero" style={{ marginBottom: -6 }}>
              Watchlist
            </h1>
          </div>
          <div style={{ flex: 1 }} />
          <Link href="/feed" className="v-pill-outline-mint">← Feed</Link>
          <Link href="/admin" className="v-pill-outline-mint">Admin →</Link>
        </header>

        <SearchPanel onTracked={() => live.refresh?.()} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 56, marginBottom: 24 }}>
          <span className="v-kicker mint">Tracked</span>
          <span className="v-eyebrow" style={{ color: '#ffffff' }}>
            Public Pages we&apos;re snapshotting
          </span>
          <div style={{ flex: 1, height: 1, background: '#3d00bf' }} />
          <span className="v-meta">{String(items.length).padStart(2, '0')} pages</span>
        </div>

        {items.length === 0 ? (
          <div
            className="v-tile"
            style={{
              padding: 48,
              textAlign: 'center',
              border: '1px dashed rgba(255,255,255,0.25)',
            }}
          >
            <p className="v-body" style={{ marginBottom: 0, color: 'var(--v-text-muted)' }}>
              Nothing tracked yet. Search a Page above and click <em>Track</em>.
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
            {items.map((p) => (
              <PageCard key={p.page_id} page={p} onChanged={() => live.refresh?.()} />
            ))}
          </div>
        )}

        <footer
          style={{
            marginTop: 96,
            paddingTop: 24,
            borderTop: '1px solid #3d00bf',
            display: 'flex',
            gap: 24,
          }}
        >
          <span className="v-meta">Connector PoC / Watchlist</span>
          <div style={{ flex: 1 }} />
          <span className="v-meta">App-level PPCA · no per-account tokens needed</span>
        </footer>
      </div>
    </div>
  );
}

// ─── Search panel ────────────────────────────────────────────────────────

function SearchPanel({ onTracked }: { onTracked: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 2) {
      setHits(null);
      setErr(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `${CONNECTOR_API_URL}/admin/watchlist/search?q=${encodeURIComponent(q)}&limit=10`,
        );
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const body = (await res.json()) as { items?: SearchHit[] };
        setHits(body.items ?? []);
        setErr(null);
      } catch (e) {
        setErr((e as Error).message);
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [q]);

  const onTrack = async (id: string) => {
    try {
      await adminPost('/admin/watchlist', { page: id });
      onTracked();
      setHits((cur) => (cur ?? []).map((h) => (h.id === id ? { ...h, already_tracked: true } : h)));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div
      style={{
        border: '1px solid #ffffff',
        borderRadius: 24,
        padding: 24,
        background: 'rgba(255,255,255,0.02)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="v-kicker mint">Search</span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search any Facebook Page (Nike, BBC, Adidas …)"
          style={{
            flex: 1,
            height: 44,
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.35)',
            borderRadius: 12,
            padding: '0 16px',
            color: '#fff',
            fontFamily: 'var(--v-mono)',
            fontSize: 14,
            outline: 'none',
          }}
        />
        {loading && <span className="v-meta">…searching</span>}
      </div>

      {err && (
        <div className="v-banner danger" style={{ marginTop: 16 }}>
          ↯ {err}
        </div>
      )}

      {hits && hits.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '20px 0 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {hits.map((h) => (
            <li
              key={h.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '12px 14px',
                borderRadius: 14,
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'rgba(255,255,255,0.03)',
              }}
            >
              {h.picture_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={h.picture_url}
                  alt=""
                  width={48}
                  height={48}
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    objectFit: 'cover',
                    flexShrink: 0,
                    border: '2px solid #ffffff',
                  }}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.08)',
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span
                    style={{
                      fontFamily: 'var(--v-display)',
                      fontSize: 18,
                      color: '#fff',
                      letterSpacing: '0.01em',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {h.name ?? h.id}
                  </span>
                  {isVerified(h.verification_status, h.is_verified) && (
                    <span title="Verified" style={{ color: 'var(--v-mint)', fontSize: 14 }}>
                      ✓
                    </span>
                  )}
                </div>
                <div className="v-meta" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {h.username && <span>@{h.username}</span>}
                  {h.category && <span>· {h.category}</span>}
                  {typeof h.fan_count === 'number' && (
                    <span>· {fmtNumber(h.fan_count)} fans</span>
                  )}
                </div>
              </div>
              {h.already_tracked ? (
                <span className="v-tag mint" style={{ flexShrink: 0, padding: '6px 12px' }}>
                  Tracked
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onTrack(h.id)}
                  className="v-pill-primary"
                  style={{ flexShrink: 0 }}
                >
                  Track →
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {hits && hits.length === 0 && q.trim().length >= 2 && !loading && (
        <div
          className="v-meta"
          style={{
            marginTop: 16,
            padding: '20px',
            textAlign: 'center',
            border: '1px dashed rgba(255,255,255,0.2)',
            borderRadius: 12,
          }}
        >
          No matches for <em>{q}</em>.
        </div>
      )}
    </div>
  );
}

// ─── Page card ───────────────────────────────────────────────────────────

function PageCard({ page, onChanged }: { page: WatchedPage; onChanged: () => void }) {
  const [busy, setBusy] = useState<'refresh' | 'remove' | null>(null);

  const refresh = async () => {
    setBusy('refresh');
    try {
      await adminPost(`/admin/watchlist/${page.page_id}/refresh`);
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm(`Untrack ${page.name ?? page.page_id}?`)) return;
    setBusy('remove');
    try {
      await adminDelete(`/admin/watchlist/${page.page_id}`);
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const fans = typeof page.fan_count === 'number' ? page.fan_count : page.followers_count;

  return (
    <div
      className="v-tile"
      style={{
        padding: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {page.cover_url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={page.cover_url}
          alt=""
          style={{ width: '100%', height: 120, objectFit: 'cover' }}
          referrerPolicy="no-referrer"
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: 120,
            background:
              'linear-gradient(135deg, rgba(82,0,255,0.45) 0%, rgba(60,255,208,0.25) 100%)',
          }}
        />
      )}
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, marginTop: -56 }}>
          {page.picture_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={page.picture_url}
              alt=""
              width={72}
              height={72}
              style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                objectFit: 'cover',
                border: '3px solid #0e0e0e',
                background: '#0e0e0e',
                flexShrink: 0,
              }}
              referrerPolicy="no-referrer"
            />
          ) : (
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.1)',
                border: '3px solid #0e0e0e',
                flexShrink: 0,
              }}
            />
          )}
          <div style={{ minWidth: 0, flex: 1, paddingBottom: 4 }}>
            <Link
              href={`/watchlist/${page.page_id}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontFamily: 'var(--v-display)',
                fontSize: 22,
                color: '#fff',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '100%',
              }}
            >
              {page.name ?? page.page_id}
              {isVerified(page.verification_status, page.is_verified) && (
                <span style={{ color: 'var(--v-mint)', fontSize: 16 }}>✓</span>
              )}
            </Link>
            <div className="v-meta" style={{ marginTop: 2 }}>
              {page.username ? `@${page.username}` : page.page_id}
              {page.category && <span> · {page.category}</span>}
            </div>
          </div>
        </div>

        {page.about && (
          <p
            style={{
              margin: 0,
              fontSize: 13,
              lineHeight: 1.55,
              color: 'var(--v-text-muted)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {page.about}
          </p>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 12,
            paddingTop: 14,
            borderTop: '1px solid rgba(255,255,255,0.15)',
          }}
        >
          <Stat label="Fans" value={fans} />
          <Stat label="Followers" value={page.followers_count} />
          <Stat label="Talking" value={page.talking_about_count} />
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: 14,
            borderTop: '1px solid rgba(255,255,255,0.15)',
            marginTop: 'auto',
          }}
        >
          <span className="v-meta">
            {page.captured_at ? <RelativeTime value={page.captured_at} /> : '—'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href={`/watchlist/${page.page_id}`} className="v-pill-outline-mint">
              Open →
            </Link>
            <button
              type="button"
              onClick={refresh}
              disabled={!!busy}
              className="v-pill-outline-mint"
              title="Re-snapshot"
              style={{ padding: '6px 12px' }}
            >
              {busy === 'refresh' ? '…' : '↻'}
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={!!busy}
              className="v-pill-outline-mint"
              title="Untrack"
              style={{ padding: '6px 12px', borderColor: 'rgba(255,80,80,0.45)', color: '#ff8a8a' }}
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div>
      <div
        className="v-display"
        style={{
          fontSize: 26,
          lineHeight: 1,
          color: '#fff',
        }}
      >
        {typeof value === 'number' ? fmtNumber(value) : '—'}
      </div>
      <div className="v-meta" style={{ marginTop: 4, color: 'var(--v-text-muted)' }}>
        {label}
      </div>
    </div>
  );
}
