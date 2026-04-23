import Link from 'next/link';
import { useState } from 'react';
import type { GetServerSideProps } from 'next';
import { getDb } from '../../lib/mongo';
import { fmtRelative, fmtNumber } from '../../lib/format';
import { refreshAccount } from '../../lib/api';

type IdentitySnapshot = {
  account_id: number | string;
  platform: string;
  handle?: string;
  display_name?: string;
  biography?: string;
  profile_picture_url?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  updated_at?: string;
};

type AudienceSnapshot = {
  account_id: number | string;
  gender_age?: Record<string, number>;
  country?: Record<string, number>;
  city?: Record<string, number>;
  captured_at?: string;
};

type PageProps = {
  id: string;
  identity: IdentitySnapshot | null;
  audience: AudienceSnapshot | null;
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const id = String(ctx.params?.id || '');
  try {
    const db = await getDb();
    const filters = [{ account_id: id }, { account_id: Number(id) || id }];
    const identity = (await db
      .collection('identity_snapshots')
      .findOne({ $or: filters })) as IdentitySnapshot | null;
    const audience = (await db
      .collection('audience_snapshots')
      .findOne({ $or: filters }, { sort: { captured_at: -1 } })) as AudienceSnapshot | null;
    return {
      props: {
        id,
        identity: identity ? JSON.parse(JSON.stringify(identity)) : null,
        audience: audience ? JSON.parse(JSON.stringify(audience)) : null,
      },
    };
  } catch (err) {
    console.error(err);
    return { props: { id, identity: null, audience: null } };
  }
};

export default function AccountDetail({ id, identity, audience }: PageProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await refreshAccount(id);
      if (!res.ok && res.status !== 202) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      setTimeout(() => {
        window.location.reload();
      }, 30000);
    } catch (e) {
      setError((e as Error).message);
      setRefreshing(false);
    }
  };

  const topGenderAge = audience?.gender_age
    ? Object.entries(audience.gender_age).sort((a, b) => b[1] - a[1]).slice(0, 6)
    : [];
  const topCountries = audience?.country
    ? Object.entries(audience.country).sort((a, b) => b[1] - a[1]).slice(0, 8)
    : [];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 'var(--space-6) var(--space-5)' }}>
      <header className="row" style={{ marginBottom: 'var(--space-5)' }}>
        <Link href="/" className="muted">
          ← All accounts
        </Link>
        <div className="spacer" />
        <Link href={`/account/${id}/posts`} className="badge">
          View posts →
        </Link>
        <button
          className="primary"
          onClick={onRefresh}
          disabled={refreshing}
          style={{ marginLeft: 'var(--space-2)' }}
        >
          {refreshing ? 'Refreshing…' : 'Refresh now'}
        </button>
      </header>

      {error && <div className="banner">Refresh failed: {error}</div>}
      {refreshing && !error && (
        <div className="panel" style={{ marginBottom: 'var(--space-4)' }}>
          <span className="badge warn">queued</span>
          <span className="muted" style={{ marginLeft: 'var(--space-3)' }}>
            Manual refresh dispatched. Page will reload in ~30s.
          </span>
        </div>
      )}

      {!identity ? (
        <div className="panel">
          <div className="panel-title">Account {id} not found in Mongo</div>
          <p className="muted">No identity snapshot yet. The worker may not have synced this account.</p>
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
          <div className="panel">
            <div className="row" style={{ marginBottom: 'var(--space-4)' }}>
              <Avatar url={identity.profile_picture_url} handle={identity.handle} size={72} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 600 }}>
                  {identity.display_name || identity.handle}
                </div>
                <div className="mono muted" style={{ fontSize: 13 }}>
                  {identity.handle} · {identity.platform}
                </div>
                <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>
                  Updated {fmtRelative(identity.updated_at)}
                </div>
              </div>
            </div>
            {identity.biography && (
              <p style={{ margin: '0 0 var(--space-4)', fontSize: 13 }}>{identity.biography}</p>
            )}
            <div className="row" style={{ gap: 'var(--space-5)' }}>
              <BigStat label="Followers" value={fmtNumber(identity.followers_count)} />
              <BigStat label="Following" value={fmtNumber(identity.follows_count)} />
              <BigStat label="Posts" value={fmtNumber(identity.media_count)} />
            </div>
          </div>

          <div className="panel">
            <div className="panel-title">Audience</div>
            {!audience ? (
              <p className="muted" style={{ margin: 0 }}>No audience snapshot yet.</p>
            ) : (
              <div className="grid" style={{ gap: 'var(--space-4)' }}>
                <Bars title="Gender × age" entries={topGenderAge} total={sum(audience.gender_age)} />
                <Bars title="Top countries" entries={topCountries} total={sum(audience.country)} />
                <div className="faint" style={{ fontSize: 11 }}>
                  Captured {fmtRelative(audience.captured_at)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function sum(rec?: Record<string, number>): number {
  if (!rec) return 0;
  return Object.values(rec).reduce((a, b) => a + b, 0);
}

function Bars({
  title,
  entries,
  total,
}: {
  title: string;
  entries: [string, number][];
  total: number;
}) {
  if (!entries.length) return null;
  const max = Math.max(...entries.map(([, v]) => v), 1);
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-muted)' }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {entries.map(([label, value]) => (
          <div key={label} className="row" style={{ gap: 8 }}>
            <div
              className="mono"
              style={{
                width: 70,
                fontSize: 11,
                color: 'var(--text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {label}
            </div>
            <div
              style={{
                flex: 1,
                height: 12,
                background: 'var(--bg-panel-hi)',
                borderRadius: 3,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${(value / max) * 100}%`,
                  height: '100%',
                  background: 'var(--accent)',
                }}
              />
            </div>
            <div className="mono" style={{ width: 70, fontSize: 11, textAlign: 'right' }}>
              {fmtNumber(value)}
              {total > 0 && (
                <span className="faint"> · {((value / total) * 100).toFixed(0)}%</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Avatar({ url, handle, size }: { url?: string; handle?: string; size: number }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={url}
        alt={handle || 'avatar'}
        width={size}
        height={size}
        style={{ borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border)' }}
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
        background: 'var(--bg-panel-hi)',
        color: 'var(--text-muted)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.4,
        fontWeight: 600,
        border: '1px solid var(--border)',
      }}
    >
      {initial}
    </div>
  );
}

function BigStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="kpi-value" style={{ fontSize: 22 }}>
        {value}
      </div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}
