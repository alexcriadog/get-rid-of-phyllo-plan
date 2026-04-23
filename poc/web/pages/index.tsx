import Link from 'next/link';
import type { GetServerSideProps } from 'next';
import { safeCollection } from '../lib/mongo';
import { fmtRelative, fmtNumber } from '../lib/format';

type IdentitySnapshot = {
  _id?: string;
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

type PageProps = {
  accounts: IdentitySnapshot[];
};

export const getServerSideProps: GetServerSideProps<PageProps> = async () => {
  const raw = await safeCollection<IdentitySnapshot>('identity_snapshots');
  // Strip Mongo ObjectId so it serializes.
  const accounts = raw.map((r) => ({
    ...r,
    _id: r._id ? String(r._id) : undefined,
    account_id:
      typeof r.account_id === 'bigint'
        ? Number(r.account_id)
        : typeof r.account_id === 'object'
        ? String(r.account_id)
        : r.account_id,
  }));
  return { props: { accounts } };
};

export default function Home({ accounts }: PageProps) {
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 'var(--space-6) var(--space-5)' }}>
      <header
        className="row"
        style={{
          marginBottom: 'var(--space-5)',
          paddingBottom: 'var(--space-3)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Connected accounts</h1>
        <div className="spacer" />
        <Link href="/admin" className="badge">
          Admin console →
        </Link>
      </header>

      {accounts.length === 0 ? (
        <div className="panel">
          <div className="panel-title">No accounts yet</div>
          <p className="muted" style={{ margin: 0 }}>
            Seed an Instagram account through the connector (see <code>poc/prisma/seed.ts</code>) or via
            the admin console: <Link href="/admin/accounts">Admin → Accounts</Link>.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 'var(--space-4)',
          }}
        >
          {accounts.map((a) => (
            <Link
              key={String(a.account_id)}
              href={`/account/${a.account_id}`}
              style={{ textDecoration: 'none' }}
            >
              <div
                className="panel"
                style={{
                  transition: 'border-color 150ms',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-3)',
                }}
              >
                <div className="row">
                  <Avatar url={a.profile_picture_url} handle={a.handle} size={56} />
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 15,
                        color: 'var(--text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {a.display_name || a.handle || `Account ${a.account_id}`}
                    </div>
                    <div className="mono muted" style={{ fontSize: 12 }}>
                      {a.handle || '—'}
                    </div>
                  </div>
                </div>
                <div className="row" style={{ gap: 'var(--space-4)' }}>
                  <Stat label="Followers" value={fmtNumber(a.followers_count)} />
                  <Stat label="Posts" value={fmtNumber(a.media_count)} />
                  <div className="spacer" />
                  <span className="badge">{a.platform}</span>
                </div>
                <div className="faint" style={{ fontSize: 11, marginTop: 'auto' }}>
                  Updated {fmtRelative(a.updated_at)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>
        {value}
      </div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}
