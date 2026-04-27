import Link from 'next/link';
import type { GetServerSideProps } from 'next';
import { safeCollection } from '../lib/mongo';
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

type AudienceData = {
  cityDistribution?: Array<{ label: string; value: number }>;
  countryDistribution?: Array<{ label: string; value: number }>;
};

type AudienceSnapshot = {
  account_id: string;
  data?: AudienceData;
};

type PageProps = {
  accounts: IdentitySnapshot[];
  topCityByAccount: Record<string, { city: string; value: number } | null>;
  topCountryByAccount: Record<string, { country: string; pct: number } | null>;
};

export const getServerSideProps: GetServerSideProps<PageProps> = async () => {
  const [rawIdentity, rawAudience] = await Promise.all([
    safeCollection<IdentitySnapshot>('identity_snapshots'),
    safeCollection<AudienceSnapshot>('audience_snapshots'),
  ]);

  const accounts = rawIdentity.map((r) => toPlainJson(r) as IdentitySnapshot);

  const topCityByAccount: Record<string, { city: string; value: number } | null> = {};
  const topCountryByAccount: Record<string, { country: string; pct: number } | null> = {};
  for (const snap of rawAudience) {
    const key = String(snap.account_id);
    const cities = snap.data?.cityDistribution ?? [];
    const countries = snap.data?.countryDistribution ?? [];
    topCityByAccount[key] = cities.length
      ? { city: [...cities].sort((a, b) => b.value - a.value)[0].label, value: [...cities].sort((a, b) => b.value - a.value)[0].value }
      : null;
    if (countries.length) {
      const sorted = [...countries].sort((a, b) => b.value - a.value);
      const total = countries.reduce((a, c) => a + c.value, 0) || 1;
      topCountryByAccount[key] = { country: sorted[0].label, pct: (sorted[0].value / total) * 100 };
    } else {
      topCountryByAccount[key] = null;
    }
  }

  return { props: { accounts, topCityByAccount, topCountryByAccount } };
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

export default function Home({ accounts, topCityByAccount, topCountryByAccount }: PageProps) {
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
