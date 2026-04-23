import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode } from 'react';
import { useLive } from '../lib/useLive';

type NavItem = { href: string; label: string };

const NAV: NavItem[] = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/rate-limits', label: 'Rate buckets' },
  { href: '/admin/cadence', label: 'Cadence' },
  { href: '/admin/next-runs', label: 'Next runs' },
  { href: '/admin/accounts', label: 'Accounts' },
  { href: '/admin/calls', label: 'API calls' },
  { href: '/admin/throttle-locks', label: 'Throttle locks' },
  { href: '/admin/webhooks', label: 'Webhooks' },
  { href: '/admin/events', label: 'Events' },
  { href: '/admin/raw', label: 'Raw responses' },
  { href: '/admin/support-matrix', label: 'Support matrix' },
];

type Props = {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
};

export default function AdminLayout({ title, children, actions }: Props) {
  const router = useRouter();
  // Ping overview every 5s just to track API reachability for the banner.
  const reachability = useLive<unknown>('/admin/overview', 5000);

  const showBanner = !!reachability.error && !reachability.data;

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside
        style={{
          width: 220,
          borderRight: '1px solid var(--border)',
          background: 'var(--bg-panel)',
          padding: 'var(--space-5) var(--space-3)',
          position: 'sticky',
          top: 0,
          alignSelf: 'flex-start',
          height: '100vh',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            padding: '0 var(--space-3) var(--space-4)',
          }}
        >
          Connector · Admin
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map((n) => {
            const active =
              router.pathname === n.href ||
              (n.href !== '/admin' && router.pathname.startsWith(n.href));
            return (
              <Link
                key={n.href}
                href={n.href}
                style={{
                  padding: '8px 12px',
                  borderRadius: 'var(--radius)',
                  color: active ? 'var(--text)' : 'var(--text-muted)',
                  background: active ? 'var(--bg-panel-hi)' : 'transparent',
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                }}
              >
                {n.label}
              </Link>
            );
          })}
          <div
            style={{
              borderTop: '1px solid var(--border)',
              marginTop: 'var(--space-4)',
              paddingTop: 'var(--space-3)',
            }}
          >
            <Link
              href="/"
              style={{
                padding: '8px 12px',
                color: 'var(--text-muted)',
                fontSize: 12,
                display: 'block',
              }}
            >
              → Public UI
            </Link>
          </div>
        </nav>
      </aside>
      <main style={{ flex: 1, padding: 'var(--space-5) var(--space-6)' }}>
        <div
          className="row"
          style={{
            borderBottom: '1px solid var(--border)',
            paddingBottom: 'var(--space-3)',
            marginBottom: 'var(--space-5)',
          }}
        >
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{title}</h1>
          <div className="spacer" />
          {actions}
          <span
            className={`badge ${reachability.error ? 'danger' : reachability.data ? 'ok' : 'warn'}`}
            title={
              reachability.error
                ? `Connector API error: ${reachability.error}`
                : 'Connector API reachable'
            }
          >
            {reachability.error ? 'API down' : reachability.data ? 'API up' : 'connecting…'}
          </span>
        </div>
        {showBanner && (
          <div className="banner">
            Connector API unreachable. Start the connector with <code>npm run dev:api</code> in <code>poc/</code>. Error: {reachability.error}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
