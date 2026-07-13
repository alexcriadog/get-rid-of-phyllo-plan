import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import { CONNECTOR_API_URL } from '../lib/api';
import { fmtNumber } from '../lib/format';
import { RelativeTime } from '../components/RelativeTime';
import { loadShowroomCards } from '../lib/showroom-server';
import type { ShowroomCard } from '../lib/showroom';

type WorkspaceOption = { slug: string; name: string; account_count: number };

type PageProps = {
  workspaces: WorkspaceOption[];
  selected: string; // '' = all workspaces
  cards: ShowroomCard[];
  nextCursor: string | null;
};

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// Initial page size: load a handful up front; the rest is reachable by search.
const INITIAL_LIMIT = 10;

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const selected = String(ctx.query.workspace ?? '').trim();

  // Server-side base: the INTERNAL connector URL (http://api:3000), not the
  // public NEXT_PUBLIC one (which routes back through Caddy's gated path).
  const API_BASE =
    process.env.CONNECTOR_API_URL || CONNECTOR_API_URL || 'http://localhost:3000';

  // Workspaces (for the selector) + a BOUNDED first page of accounts. The
  // loader queries profiles/audience with $in on just this page's ids — no
  // full-collection scans (the old version scanned both collections whole).
  const [wsRes, loaded] = await Promise.all([
    fetchJson<{ data?: WorkspaceOption[] }>(`${API_BASE}/admin/workspaces?limit=200`),
    loadShowroomCards({ workspace: selected, limit: INITIAL_LIMIT }).catch((err) => {
      // Distinguish an outage from a genuinely empty workspace in the logs —
      // the rendered fallback looks the same to the operator either way.
      console.error('[showroom] SSR load failed:', (err as Error).message);
      return { cards: [] as ShowroomCard[], nextCursor: null as string | null };
    }),
  ]);

  const workspaces: WorkspaceOption[] = (wsRes?.data ?? []).map((w) => ({
    slug: w.slug,
    name: w.name,
    account_count: w.account_count,
  }));

  return {
    props: {
      workspaces,
      selected,
      cards: loaded.cards,
      nextCursor: loaded.nextCursor,
    },
  };
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

const TILE_PALETTES: Array<'mint' | 'uv' | 'white' | 'outline'> = [
  'outline',
  'mint',
  'outline',
  'uv',
  'outline',
  'white',
];

function WorkspaceSelect({ workspaces, selected }: { workspaces: WorkspaceOption[]; selected: string }) {
  const router = useRouter();
  return (
    <select
      value={selected}
      onChange={(e) => {
        const v = e.target.value;
        router.push(v ? `/?workspace=${encodeURIComponent(v)}` : '/');
      }}
      aria-label="Workspace"
      style={{
        background: '#000',
        color: '#fff',
        border: '1px solid #3d00bf',
        borderRadius: 999,
        padding: '6px 14px',
        fontFamily: 'var(--v-mono)',
        fontSize: 12,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        cursor: 'pointer',
      }}
    >
      <option value="">All workspaces</option>
      {workspaces.map((w) => (
        <option key={w.slug} value={w.slug}>
          {w.name} ({w.account_count})
        </option>
      ))}
    </select>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search accounts…"
      aria-label="Search accounts"
      style={{
        background: '#000',
        color: '#fff',
        border: '1px solid #3d00bf',
        borderRadius: 999,
        padding: '6px 14px',
        fontFamily: 'var(--v-mono)',
        fontSize: 12,
        letterSpacing: '0.06em',
        minWidth: 200,
      }}
    />
  );
}

export default function Home({ workspaces, selected, cards: initialCards }: PageProps) {
  const [query, setQuery] = useState('');
  const [cards, setCards] = useState<ShowroomCard[]>(initialCards);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounced = useDebounced(query.trim(), 300);
  // Track the SSR page so an emptied search restores it without a round-trip.
  const initialRef = useRef(initialCards);

  useEffect(() => {
    initialRef.current = initialCards;
    setCards(initialCards);
  }, [initialCards]);

  useEffect(() => {
    let cancelled = false;
    if (debounced === '') {
      setCards(initialRef.current);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ search: debounced });
    if (selected) params.set('workspace', selected);
    fetch(`/api/showroom/accounts?${params.toString()}`, {
      headers: { accept: 'application/json' },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { cards?: ShowroomCard[] }) => {
        if (!cancelled) setCards(data.cards ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setCards([]);
          setError('Search failed — try again.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, selected]);

  return (
    <div className="v-canvas">
      <div style={{ maxWidth: 1300, margin: '0 auto', padding: '32px 48px 96px' }}>
        {/* Masthead */}
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 16,
            borderBottom: '1px solid #ffffff',
            paddingBottom: 16,
            marginBottom: 48,
          }}
        >
          <div>
            <div className="v-meta" style={{ marginBottom: 8 }}>
              Connector / Stream
            </div>
            <h1 className="v-display size-hero" style={{ marginBottom: -6 }}>
              The Feed
            </h1>
          </div>
          <div style={{ flex: 1 }} />
          {/* /data-guide is served by the connect-tool app, not this Next app —
              use a plain anchor for a full document navigation. */}
          <a href="/data-guide" className="v-pill-outline-mint">
            Data Guide
          </a>
          <Link href="/watchlist" className="v-pill-outline-mint">
            Watchlist
          </Link>
          <Link href="/admin" className="v-pill-outline-mint">
            Admin console
          </Link>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="v-pill-outline-mint"
          >
            Sign out
          </button>
        </header>

        {/* Controls row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          <span className="v-kicker mint">Live</span>
          <span className="v-eyebrow" style={{ color: '#ffffff' }}>
            Connected accounts
          </span>
          <WorkspaceSelect workspaces={workspaces} selected={selected} />
          <SearchBox value={query} onChange={setQuery} />
          <div style={{ flex: 1, height: 1, background: '#3d00bf', minWidth: 40 }} />
          <span className="v-meta">
            {loading ? 'searching…' : `${String(cards.length).padStart(2, '0')} accounts`}
          </span>
        </div>

        {error ? (
          <div className="v-tile" style={{ padding: 32, textAlign: 'center' }}>
            <span className="v-meta">{error}</span>
          </div>
        ) : cards.length === 0 ? (
          <EmptyState searching={debounced !== ''} />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
              gap: 20,
            }}
          >
            {cards.map((c, i) => (
              <AccountTile key={c.id} card={c} tone={TILE_PALETTES[i % TILE_PALETTES.length]} />
            ))}
          </div>
        )}

        <footer
          style={{
            marginTop: 80,
            paddingTop: 24,
            borderTop: '1px solid #3d00bf',
            display: 'flex',
            gap: 24,
          }}
        >
          <span className="v-meta">Connector PoC / 2026</span>
          <div style={{ flex: 1 }} />
          <span className="v-meta">Showing up to {INITIAL_LIMIT} — search for more</span>
        </footer>
      </div>
    </div>
  );
}

type Tone = 'mint' | 'uv' | 'white' | 'outline';

function AccountTile({ card, tone }: { card: ShowroomCard; tone: Tone }) {
  const handle = card.handle ? `@${card.handle}` : 'unknown';
  const name = card.name || card.handle || `Account ${card.id}`;

  const baseClass =
    tone === 'mint'
      ? 'v-tile-mint'
      : tone === 'uv'
      ? 'v-tile-uv'
      : tone === 'white'
      ? 'v-tile-white'
      : 'v-tile';

  const light = tone === 'mint' || tone === 'white';
  const textColor = light ? '#000' : '#fff';
  const mutedColor = light ? 'rgba(0,0,0,0.6)' : 'var(--v-text-muted)';
  const kickerTone = tone === 'outline' ? 'mint' : tone === 'uv' ? 'white' : '';

  return (
    <Link
      href={`/account/${card.id}`}
      style={{ textDecoration: 'none', display: 'block', transition: 'transform 160ms ease' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div
        className={baseClass}
        style={{
          padding: 24,
          borderRadius: 24,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          color: textColor,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span className={`v-kicker ${kickerTone}`} style={light ? { color: '#000' } : undefined}>
            {card.platform}
          </span>
          <PlatformIcon platform={card.platform} size={22} inverse={light} />
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <Avatar url={card.avatarUrl} handle={card.handle} size={72} dark={tone !== 'outline' && tone !== 'uv'} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span
                className="v-display size-tertiary"
                style={{
                  color: textColor,
                  fontSize: 'clamp(32px, 4vw, 46px)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '100%',
                }}
              >
                {name}
              </span>
              {card.verified && <VerifiedIcon size={18} />}
            </div>
            <div
              style={{
                fontFamily: 'var(--v-mono)',
                fontSize: 13,
                letterSpacing: '0.06em',
                color: mutedColor,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {handle}
            </div>
          </div>
        </div>

        {card.biography && (
          <p
            style={{
              margin: 0,
              fontSize: 13,
              lineHeight: 1.55,
              color: mutedColor,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {card.biography}
          </p>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 16,
            paddingTop: 20,
            borderTop: light ? '1px solid rgba(0,0,0,0.15)' : '1px solid rgba(255,255,255,0.18)',
          }}
        >
          <VergeStat label="Followers" value={fmtNumber(card.followers ?? undefined)} tone={tone} />
          <VergeStat label="Following" value={fmtNumber(card.following ?? undefined)} tone={tone} />
          <VergeStat label="Posts" value={fmtNumber(card.posts ?? undefined)} tone={tone} />
        </div>

        {(card.topCity || card.topCountry) && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {card.topCountry && (
              <span
                className={`v-tag ${light ? 'outline' : 'outline-mint'}`}
                style={light ? { color: '#000', borderColor: 'rgba(0,0,0,0.45)' } : undefined}
              >
                {card.topCountry.country} / {card.topCountry.pct.toFixed(0)}%
              </span>
            )}
            {card.topCity && (
              <span
                className="v-tag outline"
                style={light ? { color: '#000', borderColor: 'rgba(0,0,0,0.45)' } : undefined}
                title={`${card.topCity.value.toLocaleString()} followers`}
              >
                ◉ {card.topCity.city}
              </span>
            )}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto' }}>
          <span className="v-meta" style={light ? { color: 'rgba(0,0,0,0.55)' } : undefined}>
            {card.updatedAt ? <RelativeTime value={card.updatedAt} /> : 'never synced'}
          </span>
          <div style={{ flex: 1 }} />
          <span
            className="v-meta"
            style={{ color: light ? '#000' : 'var(--v-mint)', letterSpacing: '0.18em' }}
          >
            Open →
          </span>
        </div>
      </div>
    </Link>
  );
}

function VergeStat({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const light = tone === 'mint' || tone === 'white';
  return (
    <div>
      <div
        className="v-display"
        style={{ fontSize: 32, lineHeight: 1, letterSpacing: '0.01em', color: light ? '#000' : '#fff' }}
      >
        {value}
      </div>
      <div className="v-meta" style={{ marginTop: 6, color: light ? 'rgba(0,0,0,0.55)' : 'var(--v-text-muted)' }}>
        {label}
      </div>
    </div>
  );
}

function Avatar({ url, handle, size, dark }: { url?: string | null; handle?: string | null; size: number; dark?: boolean }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={url}
        alt={handle || 'avatar'}
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        style={{
          borderRadius: '50%',
          objectFit: 'cover',
          border: `2px solid ${dark ? '#000' : '#ffffff'}`,
          flexShrink: 0,
        }}
      />
    );
  }
  const initial = (handle || '?').replace(/^@/, '').charAt(0).toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: dark ? '#000' : '#2d2d2d',
        color: dark ? '#3cffd0' : '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.44,
        fontWeight: 700,
        fontFamily: 'var(--v-display)',
        border: `2px solid ${dark ? '#000' : '#ffffff'}`,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

function PlatformIcon({ platform, size = 18, inverse }: { platform: string; size?: number; inverse?: boolean }) {
  if (platform === 'instagram') {
    const strokeColor = inverse ? '#000' : '#fff';
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <rect x="2" y="2" width="20" height="20" rx="5" fill="none" stroke={strokeColor} strokeWidth="1.5" />
        <circle cx="12" cy="12" r="4.2" fill="none" stroke={strokeColor} strokeWidth="1.5" />
        <circle cx="17.2" cy="6.8" r="1.1" fill={strokeColor} />
      </svg>
    );
  }
  if (platform === 'facebook') {
    const fill = inverse ? '#000' : '#fff';
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <rect x="2" y="2" width="20" height="20" rx="5" fill="none" stroke={fill} strokeWidth="1.5" />
        <path
          d="M13.5 21v-6.4h2.15l.32-2.5H13.5v-1.6c0-.72.2-1.22 1.26-1.22h1.35V7.15c-.23-.03-1.03-.1-1.96-.1-1.94 0-3.27 1.18-3.27 3.35v1.7H8.7v2.5h2.18V21h2.62z"
          fill={fill}
        />
      </svg>
    );
  }
  return null;
}

function VerifiedIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="verified">
      <path
        d="M12 2l2.3 2.1 3 -0.4 1 2.9 2.8 1.2-0.8 2.9 1.5 2.6 -2.4 1.8 -0.2 3 -3 0.3 -1.9 2.3 -2.7-1.3 -2.7 1.3 -1.9-2.3 -3-0.3 -0.2-3 -2.4-1.8 1.5-2.6 -0.8-2.9 2.8-1.2 1-2.9 3 0.4 z"
        fill="#3cffd0"
      />
      <path
        d="M8.7 12l2.2 2.2 4.4-4.4"
        stroke="#131313"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EmptyState({ searching }: { searching: boolean }) {
  return (
    <div className="v-tile" style={{ padding: 48, textAlign: 'center' }}>
      <div className="v-kicker mint" style={{ marginBottom: 12 }}>
        {searching ? 'No matches' : 'Stream empty'}
      </div>
      <h2 className="v-display size-tertiary" style={{ marginBottom: 16 }}>
        {searching ? 'No accounts match your search' : 'No accounts connected'}
      </h2>
      <p className="v-body" style={{ maxWidth: 440, margin: '0 auto 24px' }}>
        {searching
          ? 'Try a different handle or clear the search.'
          : 'Seed an Instagram or Facebook account through the connector to see it appear here.'}
      </p>
      <Link href="/admin" className="v-pill-outline-mint">
        Open admin
      </Link>
    </div>
  );
}
