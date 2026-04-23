import AdminLayout from '../../components/AdminLayout';
import Gauge from '../../components/Gauge';
import { useLive } from '../../lib/useLive';
import { fmtNumber, fmtMs, fmtTime, statusClass } from '../../lib/format';

type ApiCall = {
  id: number | string;
  called_at?: string;
  platform?: string;
  endpoint?: string;
  status_code?: number;
  duration_ms?: number;
  account_id?: number | string;
};

type PlatformStat = {
  platform: string;
  tokens?: number;
  capacity?: number;
  accounts?: number;
  calls_last_hour?: number;
};

type Overview = {
  accounts_total?: number;
  syncs_last_hour?: number;
  webhooks_last_hour?: number;
  dlq_depth?: number;
  platforms?: Record<string, PlatformStat> | PlatformStat[];
  last_api_calls?: ApiCall[];
};

type Bucket = {
  key: string;
  platform: string;
  scope?: string;
  tokens: number;
  capacity: number;
};

export default function AdminOverview() {
  const { data, error } = useLive<Overview>('/admin/overview');
  const bucketsLive = useLive<Bucket[]>('/admin/rate-buckets', 2000);

  const platforms = normalisePlatforms(data?.platforms);
  const bucketsByPlatform = groupByPlatform(bucketsLive.data || []);

  return (
    <AdminLayout title="Overview">
      {error && !data && <div className="banner">Admin API error: {error}</div>}

      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 'var(--space-5)' }}
      >
        <KpiCard label="Accounts" value={fmtNumber(data?.accounts_total)} />
        <KpiCard label="Syncs / last hour" value={fmtNumber(data?.syncs_last_hour)} />
        <KpiCard label="Webhooks / last hour" value={fmtNumber(data?.webhooks_last_hour)} />
        <KpiCard
          label="DLQ depth"
          value={fmtNumber(data?.dlq_depth)}
          tone={(data?.dlq_depth ?? 0) > 0 ? 'danger' : 'ok'}
        />
      </div>

      <div className="panel" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="panel-title">Live rate buckets by platform</div>
        {Object.keys(bucketsByPlatform).length === 0 ? (
          <div className="muted">
            {bucketsLive.error
              ? `Rate buckets unavailable: ${bucketsLive.error}`
              : 'No buckets yet.'}
          </div>
        ) : (
          <div className="row wrap" style={{ gap: 'var(--space-5)' }}>
            {Object.entries(bucketsByPlatform).map(([platform, buckets]) => (
              <div key={platform}>
                <div
                  style={{
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: 'var(--text-muted)',
                    marginBottom: 6,
                  }}
                >
                  {platform}
                </div>
                <div className="row wrap" style={{ gap: 'var(--space-3)' }}>
                  {buckets.slice(0, 4).map((b) => (
                    <Gauge
                      key={b.key}
                      value={b.tokens}
                      max={b.capacity}
                      size={86}
                      label={b.scope || b.key.split(':').slice(-1)[0]}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <div className="panel">
          <div className="panel-title">Platforms</div>
          {platforms.length === 0 ? (
            <div className="muted">No data.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>Accounts</th>
                  <th>Calls / hr</th>
                </tr>
              </thead>
              <tbody>
                {platforms.map((p) => (
                  <tr key={p.platform}>
                    <td className="mono">{p.platform}</td>
                    <td className="mono">{fmtNumber(p.accounts)}</td>
                    <td className="mono">{fmtNumber(p.calls_last_hour)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel" style={{ gridColumn: 'span 2' }}>
          <div className="panel-title">Last 10 API calls</div>
          <div className="ticker">
            {(data?.last_api_calls || []).slice(0, 10).map((c) => (
              <div className="line" key={String(c.id)}>
                <span className="faint" style={{ width: 80 }}>
                  {fmtTime(c.called_at)}
                </span>
                <span className="badge" style={{ width: 80, textAlign: 'center' }}>
                  {c.platform}
                </span>
                <span
                  className={`badge ${statusClass(c.status_code)}`}
                  style={{ width: 48, textAlign: 'center' }}
                >
                  {c.status_code ?? '—'}
                </span>
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.endpoint}
                </span>
                <span style={{ width: 70, textAlign: 'right' }}>{fmtMs(c.duration_ms)}</span>
              </div>
            ))}
            {(!data?.last_api_calls || data.last_api_calls.length === 0) && (
              <div className="muted" style={{ padding: 'var(--space-3)' }}>
                No calls yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'danger';
}) {
  const colour =
    tone === 'danger'
      ? 'var(--danger)'
      : tone === 'warn'
      ? 'var(--warn)'
      : tone === 'ok'
      ? 'var(--ok)'
      : undefined;
  return (
    <div className="panel">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color: colour }}>
        {value}
      </div>
    </div>
  );
}

function normalisePlatforms(p: Overview['platforms']): PlatformStat[] {
  if (!p) return [];
  if (Array.isArray(p)) return p;
  return Object.entries(p).map(([platform, rest]) => ({ ...rest, platform }));
}

function groupByPlatform(buckets: Bucket[]): Record<string, Bucket[]> {
  const out: Record<string, Bucket[]> = {};
  for (const b of buckets) {
    (out[b.platform] ||= []).push(b);
  }
  return out;
}
