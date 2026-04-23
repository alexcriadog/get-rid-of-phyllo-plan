import { useMemo, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import DataTable, { Column } from '../../components/DataTable';
import { useLive } from '../../lib/useLive';
import { fmtTime, fmtMs, statusClass } from '../../lib/format';

type ApiCall = {
  id: number | string;
  called_at?: string;
  platform?: string;
  endpoint?: string;
  method?: string;
  status_code?: number;
  duration_ms?: number;
  rate_bucket_key?: string;
  tokens_before?: number;
  tokens_after?: number;
  usage_header?: Record<string, unknown> | null;
  account_id?: number | string;
};

const STATUS_CLASSES = ['2xx', '4xx', '5xx'];

export default function CallsPage() {
  const [platform, setPlatform] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [accountId, setAccountId] = useState('');
  const [selected, setSelected] = useState<ApiCall | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (platform) p.set('platform', platform);
    if (statusFilter) p.set('status', statusFilter);
    if (accountId) p.set('account_id', accountId);
    p.set('limit', '100');
    return p.toString();
  }, [platform, statusFilter, accountId]);

  const { data, error } = useLive<ApiCall[]>(`/admin/api-calls?${qs}`);
  const rows = data || [];

  const columns: Column<ApiCall>[] = [
    { key: 'called_at', label: 'Time', sortable: true, render: (r) => fmtTime(r.called_at) },
    { key: 'platform', label: 'Platform', render: (r) => <span className="badge">{r.platform}</span> },
    { key: 'method', label: 'Method', render: (r) => <span className="mono">{r.method || 'GET'}</span> },
    {
      key: 'endpoint',
      label: 'Endpoint',
      render: (r) => (
        <span
          className="mono"
          style={{
            maxWidth: 300,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            display: 'inline-block',
          }}
        >
          {r.endpoint}
        </span>
      ),
    },
    {
      key: 'status_code',
      label: 'Status',
      sortable: true,
      render: (r) => (
        <span className={`badge ${statusClass(r.status_code)}`}>{r.status_code ?? '—'}</span>
      ),
    },
    { key: 'duration_ms', label: 'Dur', sortable: true, render: (r) => fmtMs(r.duration_ms) },
    {
      key: 'bucket',
      label: 'Bucket Δ',
      render: (r) =>
        r.tokens_before != null && r.tokens_after != null ? (
          <span className="mono faint">
            {r.tokens_before} → {r.tokens_after}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'usage',
      label: 'Usage',
      render: (r) => {
        const pct = parseUsagePct(r.usage_header);
        if (pct == null) return '—';
        const tone = pct > 80 ? 'danger' : pct > 50 ? 'warn' : 'ok';
        return <span className={`badge ${tone}`}>{pct}%</span>;
      },
    },
    {
      key: 'account_id',
      label: 'Account',
      render: (r) => <span className="mono">{r.account_id ?? '—'}</span>,
    },
  ];

  return (
    <AdminLayout title="API call log">
      {error && !data && <div className="banner">{error}</div>}

      <div className="panel" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="row wrap" style={{ gap: 'var(--space-2)' }}>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="">all platforms</option>
            <option value="instagram">instagram</option>
            <option value="facebook">facebook</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">all status</option>
            {STATUS_CLASSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            placeholder="account id"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            style={{ width: 120 }}
          />
          <div className="spacer" />
          <span className="faint mono" style={{ fontSize: 11 }}>
            {rows.length} rows · polling every 2s
          </span>
        </div>
      </div>

      <div className="panel" style={{ padding: 0 }}>
        <DataTable<ApiCall>
          rows={rows}
          columns={columns}
          rowKey={(r) => String(r.id)}
          onRowClick={(r) => setSelected(r)}
          emptyLabel="No API calls match."
        />
      </div>

      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            className="panel"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 720, width: '90%', maxHeight: '80vh', overflow: 'auto' }}
          >
            <div className="row" style={{ marginBottom: 'var(--space-3)' }}>
              <div className="panel-title">API call detail</div>
              <div className="spacer" />
              <button onClick={() => setSelected(null)}>Close</button>
            </div>
            <pre
              style={{
                background: 'var(--bg-panel-hi)',
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius)',
                fontSize: 12,
                overflow: 'auto',
                margin: 0,
              }}
            >
              {JSON.stringify(selected, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function parseUsagePct(h: Record<string, unknown> | null | undefined): number | null {
  if (!h) return null;
  const app = h.app_usage as Record<string, unknown> | undefined;
  if (app && typeof app === 'object') {
    const cc = Number(app.call_count);
    if (!isNaN(cc)) return Math.round(cc);
  }
  if (typeof h.usage_pct === 'number') return Math.round(h.usage_pct);
  return null;
}
