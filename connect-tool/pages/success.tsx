// Post-seed confirmation. The query string carries everything we need
// so this page is fully static; no session / no DB read.

import Link from 'next/link';
import { useRouter } from 'next/router';

export default function SuccessPage() {
  const router = useRouter();
  const platform = (router.query.platform as string | undefined) ?? '';
  const accountsRaw = (router.query.accounts as string | undefined) ?? '';
  const accounts = accountsRaw ? accountsRaw.split(',').filter(Boolean) : [];
  const summaryRaw = (router.query.summary as string | undefined) ?? '';
  let summary: Record<string, unknown> | null = null;
  if (summaryRaw) {
    try {
      summary = JSON.parse(decodeURIComponent(summaryRaw));
    } catch {
      summary = null;
    }
  }

  const adminUrl =
    process.env.NEXT_PUBLIC_POC_ADMIN_URL ?? 'http://localhost:3001/admin';

  return (
    <div className="v-canvas">
      <div className="v-shell">
        <header className="v-header">
          <Link className="v-meta" href="/">
            ← Back
          </Link>
          <span className="v-eyebrow">Connected</span>
        </header>

        <span className="v-tag mint" style={{ marginBottom: 16 }}>
          {platform || 'platform'}
        </span>
        <h1 className="v-display size-secondary">Token handed off.</h1>
        <p className="v-body" style={{ maxWidth: 640, marginBottom: 32 }}>
          The POC has accepted the credentials and started seeding sync
          jobs. Identity, audience, engagement and the rest will populate
          on the next cadence tick.
        </p>

        <div className="v-summary">
          <Row label="Platform" value={platform} />
          <Row
            label="Account ids"
            value={accounts.length ? accounts.join(', ') : '—'}
          />
          {summary &&
            Object.entries(summary).map(([k, v]) => (
              <Row key={k} label={k} value={String(v)} />
            ))}
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
          <Link className="v-pill-primary" href={`${adminUrl}/accounts`}>
            See accounts in POC →
          </Link>
          <Link className="v-pill-outline-mint" href="/">
            Connect another
          </Link>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="v-row">
      <span className="v-meta">{label}</span>
      <span className="v-row-val">{value}</span>
    </div>
  );
}
