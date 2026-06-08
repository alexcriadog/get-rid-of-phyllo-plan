import Link from 'next/link';
import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import { safeCollection } from '../lib/mongo';
import { CONNECTOR_API_URL } from '../lib/api';
import { fmtNumber } from '../lib/format';
import { RelativeTime } from '../components/RelativeTime';

type IdentityData = {
  username?: string;
  displayName?: string;
  biography?: string;
  avatarUrl?: string;
  profileUrl?: string;
  followersCount?: number;
  followingCount?: number;
  postsCount?: number;
  verified?: boolean;
  accountType?: string;
};

type IdentitySnapshot = {
  account_id: string;
  platform: string;
  data?: IdentityData;
  updated_at?: string;
};

type WorkspaceOption = { slug: string; name: string; account_count: number };

// Canonical Mongo wrapper: { account_pk, doc: <ApiProfile|ApiAudience>, updated_at }.
type ProfileWrapper = {
  account_pk: string;
  updated_at?: string;
  doc?: {
    username?: string | null;
    platform_username?: string | null;
    full_name?: string | null;
    introduction?: string | null;
    image_url?: string | null;
    is_verified?: boolean | null;
    reputation?: {
      follower_count?: number | null;
      following_count?: number | null;
      content_count?: number | null;
    } | null;
  };
};
type AudienceWrapper = {
  account_pk: string;
  doc?: {
    cities?: Array<{ name: string; value: number }>;
    countries?: Array<{ code: string; value: number }>;
  };
};
type AccountItem = { id: string; platform: string; handle?: string | null; connected_at?: string };

type PageProps = {
  workspaces: WorkspaceOption[];
  selected: string; // '' = all workspaces
  accounts: IdentitySnapshot[];
  topCityByAccount: Record<string, { city: string; value: number } | null>;
  topCountryByAccount: Record<string, { country: string; pct: number } | null>;
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

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const selected = String(ctx.query.workspace ?? '').trim();

  // Server-side base: use the INTERNAL connector URL (http://api:3000), NOT the
  // public NEXT_PUBLIC one — the latter routes through Caddy's basic-auth-gated
  // /api/poc/admin/*, which an SSR fetch can't authenticate against (401).
  const API_BASE =
    process.env.CONNECTOR_API_URL || CONNECTOR_API_URL || 'http://localhost:3000';

  // Workspaces (for the selector) + accounts (for the chosen workspace) come
  // from the connector admin API — it's workspace-aware. Stats/avatars come
  // from the canonical Mongo `profiles`/`audience` collections, keyed by
  // account_pk (= the account id).
  const [wsRes, acctRes, rawProfiles, rawAudience] = await Promise.all([
    fetchJson<{ data?: WorkspaceOption[] }>(`${API_BASE}/admin/workspaces?limit=200`),
    fetchJson<{ items?: AccountItem[] }>(
      `${API_BASE}/admin/accounts${selected ? `?workspace=${encodeURIComponent(selected)}` : ''}`,
    ),
    safeCollection<ProfileWrapper>('profiles'),
    safeCollection<AudienceWrapper>('audience'),
  ]);

  const workspaces: WorkspaceOption[] = (wsRes?.data ?? []).map((w) => ({
    slug: w.slug,
    name: w.name,
    account_count: w.account_count,
  }));
  const items = acctRes?.items ?? [];

  const profByPk = new Map<string, ProfileWrapper>();
  for (const p of rawProfiles) profByPk.set(String(p.account_pk), p);

  const accounts: IdentitySnapshot[] = items.map((it) => {
    const w = profByPk.get(String(it.id));
    const doc = w?.doc ?? {};
    const rep = doc.reputation ?? {};
    return toPlainJson({
      account_id: String(it.id),
      platform: it.platform,
      updated_at: w?.updated_at ?? it.connected_at ?? undefined,
      data: {
        username: doc.platform_username ?? doc.username ?? it.handle ?? undefined,
        displayName: doc.full_name ?? it.handle ?? undefined,
        biography: doc.introduction ?? undefined,
        avatarUrl: doc.image_url ?? undefined,
        followersCount: rep.follower_count ?? undefined,
        followingCount: rep.following_count ?? undefined,
        postsCount: rep.content_count ?? undefined,
        verified: doc.is_verified ?? undefined,
      },
    }) as IdentitySnapshot;
  });

  const topCityByAccount: Record<string, { city: string; value: number } | null> = {};
  const topCountryByAccount: Record<string, { country: string; pct: number } | null> = {};
  const audByPk = new Map<string, AudienceWrapper>();
  for (const a of rawAudience) audByPk.set(String(a.account_pk), a);
  for (const it of items) {
    const key = String(it.id);
    const doc = audByPk.get(key)?.doc ?? {};
    const cities = doc.cities ?? [];
    const countries = doc.countries ?? [];
    topCityByAccount[key] = cities.length
      ? (() => {
          const top = [...cities].sort((a, b) => b.value - a.value)[0];
          return { city: top.name, value: top.value };
        })()
      : null;
    topCountryByAccount[key] = countries.length
      ? (() => {
          const top = [...countries].sort((a, b) => b.value - a.value)[0];
          // Canonical audience values are already 0..100 percentages.
          return { country: top.code, pct: top.value };
        })()
      : null;
  }

  return { props: { workspaces, selected, accounts, topCityByAccount, topCountryByAccount } };
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

export default function Home({ workspaces, selected, accounts, topCityByAccount, topCountryByAccount }: PageProps) {
  return (
    <div className="v-canvas">
      <div
        style={{
          maxWidth: 1300,
          margin: '0 auto',
          padding: '32px 48px 96px',
        }}
      >
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
          <Link href="/watchlist" className="v-pill-outline-mint">
            Watchlist
          </Link>
          <Link href="/admin" className="v-pill-outline-mint">
            Admin console
          </Link>
        </header>

        {/* Section label */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 24,
          }}
        >
          <span className="v-kicker mint">Live</span>
          <span className="v-eyebrow" style={{ color: '#ffffff' }}>
            Connected accounts
          </span>
          <WorkspaceSelect workspaces={workspaces} selected={selected} />
          <div
            style={{
              flex: 1,
              height: 1,
              background: '#3d00bf',
            }}
          />
          <span className="v-meta">{String(accounts.length).padStart(2, '0')} accounts</span>
        </div>

        {accounts.length === 0 ? (
          <EmptyState />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
              gap: 20,
            }}
          >
            {accounts.map((a, i) => (
              <AccountTile
                key={String(a.account_id)}
                account={a}
                tone={TILE_PALETTES[i % TILE_PALETTES.length]}
                topCity={topCityByAccount[String(a.account_id)] ?? null}
                topCountry={topCountryByAccount[String(a.account_id)] ?? null}
              />
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
          <span className="v-meta">Updates every cadence tick</span>
        </footer>
      </div>
    </div>
  );
}

type Tone = 'mint' | 'uv' | 'white' | 'outline';

function AccountTile({
  account,
  tone,
  topCity,
  topCountry,
}: {
  account: IdentitySnapshot;
  tone: Tone;
  topCity: { city: string; value: number } | null;
  topCountry: { country: string; pct: number } | null;
}) {
  const d = account.data ?? {};
  const handle = d.username ? `@${d.username}` : 'unknown';
  const name = d.displayName || d.username || `Account ${account.account_id}`;

  const baseClass =
    tone === 'mint'
      ? 'v-tile-mint'
      : tone === 'uv'
      ? 'v-tile-uv'
      : tone === 'white'
      ? 'v-tile-white'
      : 'v-tile';

  const textColor = tone === 'mint' || tone === 'white' ? '#000' : '#fff';
  const mutedColor = tone === 'mint' || tone === 'white' ? 'rgba(0,0,0,0.6)' : 'var(--v-text-muted)';
  const kickerTone = tone === 'outline' ? 'mint' : tone === 'uv' ? 'white' : '';

  return (
    <Link
      href={`/account/${account.account_id}`}
      style={{
        textDecoration: 'none',
        display: 'block',
        transition: 'transform 160ms ease',
      }}
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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span className={`v-kicker ${kickerTone}`} style={tone === 'mint' || tone === 'white' ? { color: '#000' } : undefined}>
            {account.platform}
          </span>
          <PlatformIcon platform={account.platform} size={22} inverse={tone === 'mint' || tone === 'white'} />
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <Avatar url={d.avatarUrl} handle={d.username} size={72} dark={tone !== 'outline' && tone !== 'uv'} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 4,
              }}
            >
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
              {d.verified && <VerifiedIcon size={18} />}
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

        {d.biography && (
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
            {d.biography}
          </p>
        )}

        {/* Stats grid — Verge dense numerical block */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 16,
            paddingTop: 20,
            borderTop:
              tone === 'mint' || tone === 'white'
                ? '1px solid rgba(0,0,0,0.15)'
                : '1px solid rgba(255,255,255,0.18)',
          }}
        >
          <VergeStat label="Followers" value={fmtNumber(d.followersCount)} tone={tone} />
          <VergeStat label="Following" value={fmtNumber(d.followingCount)} tone={tone} />
          <VergeStat label="Posts" value={fmtNumber(d.postsCount)} tone={tone} />
        </div>

        {(topCity || topCountry) && (
          <div
            className="row wrap"
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            {topCountry && (
              <span
                className={`v-tag ${tone === 'mint' || tone === 'white' ? 'outline' : 'outline-mint'}`}
                style={
                  tone === 'mint' || tone === 'white'
                    ? { color: '#000', borderColor: 'rgba(0,0,0,0.45)' }
                    : undefined
                }
              >
                {topCountry.country} / {topCountry.pct.toFixed(0)}%
              </span>
            )}
            {topCity && (
              <span
                className={`v-tag ${tone === 'mint' || tone === 'white' ? 'outline' : 'outline'}`}
                style={
                  tone === 'mint' || tone === 'white'
                    ? { color: '#000', borderColor: 'rgba(0,0,0,0.45)' }
                    : undefined
                }
                title={`${topCity.value.toLocaleString()} followers`}
              >
                ◉ {topCity.city}
              </span>
            )}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 'auto',
          }}
        >
          <span
            className="v-meta"
            style={tone === 'mint' || tone === 'white' ? { color: 'rgba(0,0,0,0.55)' } : undefined}
          >
            {account.updated_at ? <RelativeTime value={account.updated_at} /> : 'never synced'}
          </span>
          <div style={{ flex: 1 }} />
          <span
            className="v-meta"
            style={{
              color: tone === 'mint' || tone === 'white' ? '#000' : 'var(--v-mint)',
              letterSpacing: '0.18em',
            }}
          >
            Open →
          </span>
        </div>
      </div>
    </Link>
  );
}

function VergeStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: Tone;
}) {
  const light = tone === 'mint' || tone === 'white';
  return (
    <div>
      <div
        className="v-display"
        style={{
          fontSize: 32,
          lineHeight: 1,
          letterSpacing: '0.01em',
          color: light ? '#000' : '#fff',
        }}
      >
        {value}
      </div>
      <div
        className="v-meta"
        style={{ marginTop: 6, color: light ? 'rgba(0,0,0,0.55)' : 'var(--v-text-muted)' }}
      >
        {label}
      </div>
    </div>
  );
}

function Avatar({
  url,
  handle,
  size,
  dark,
}: {
  url?: string;
  handle?: string;
  size: number;
  dark?: boolean;
}) {
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

function PlatformIcon({
  platform,
  size = 18,
  inverse,
}: {
  platform: string;
  size?: number;
  inverse?: boolean;
}) {
  if (platform === 'instagram') {
    const strokeColor = inverse ? '#000' : '#fff';
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <rect
          x="2"
          y="2"
          width="20"
          height="20"
          rx="5"
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.5"
        />
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

function EmptyState() {
  return (
    <div className="v-tile" style={{ padding: 48, textAlign: 'center' }}>
      <div className="v-kicker mint" style={{ marginBottom: 12 }}>
        Stream empty
      </div>
      <h2 className="v-display size-tertiary" style={{ marginBottom: 16 }}>
        No accounts connected
      </h2>
      <p className="v-body" style={{ maxWidth: 440, margin: '0 auto 24px' }}>
        Seed an Instagram or Facebook account through the connector to see it appear here.
      </p>
      <Link href="/admin/accounts" className="v-pill-outline-mint">
        Open admin
      </Link>
    </div>
  );
}
