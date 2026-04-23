import { useMemo, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import DataTable, { Column } from '../../components/DataTable';
import { useLive } from '../../lib/useLive';
import { adminPost } from '../../lib/api';
import { fmtTime, fmtRelative, truncate } from '../../lib/format';

type Webhook = {
  id: number | string;
  platform?: string;
  event_id?: string;
  received_at?: string;
  signature_valid?: boolean;
  account_resolved?: boolean;
  payload_snippet?: string;
  processed?: boolean;
};

type Silence = {
  account_id: number | string;
  handle?: string;
  platform?: string;
  product?: string;
  last_received_at?: string;
  silence_ms?: number;
};

export default function WebhooksPage() {
  const inbound = useLive<Webhook[]>('/admin/webhooks/inbound?limit=100');
  const silence = useLive<Silence[]>('/admin/webhooks/silence');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const replay = async (id: number | string) => {
    const k = String(id);
    setBusy(k);
    setErr(null);
    try {
      await adminPost(`/admin/webhooks/replay/${id}`);
      inbound.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const rows = inbound.data || [];
  const invalidRate = useMemo(() => {
    if (!rows.length) return 0;
    const bad = rows.filter((r) => r.signature_valid === false).length;
    return bad / rows.length;
  }, [rows]);

  const inboundCols: Column<Webhook>[] = [
    { key: 'received_at', label: 'Time', sortable: true, render: (r) => fmtTime(r.received_at) },
    { key: 'platform', label: 'Platform', render: (r) => <span className="badge">{r.platform}</span> },
    {
      key: 'signature_valid',
      label: 'Sig',
      render: (r) =>
        r.signature_valid ? (
          <span className="badge ok">valid</span>
        ) : (
          <span className="badge danger">INVALID</span>
        ),
    },
    {
      key: 'account_resolved',
      label: 'Resolved',
      render: (r) =>
        r.account_resolved ? (
          <span className="badge ok">yes</span>
        ) : (
          <span className="badge warn">no</span>
        ),
    },
    {
      key: 'processed',
      label: 'Processed',
      render: (r) =>
        r.processed ? (
          <span className="badge ok">yes</span>
        ) : (
          <span className="badge warn">pending</span>
        ),
    },
    { key: 'event_id', label: 'Event', render: (r) => <span className="mono">{truncate(r.event_id, 24)}</span> },
    {
      key: 'payload_snippet',
      label: 'Payload',
      render: (r) => <span className="mono faint">{truncate(r.payload_snippet, 64)}</span>,
    },
    {
      key: 'actions',
      label: '',
      render: (r) => (
        <button disabled={busy === String(r.id)} onClick={() => replay(r.id)}>
          Replay
        </button>
      ),
    },
  ];

  const silenceCols: Column<Silence>[] = [
    {
      key: 'handle',
      label: 'Account',
      render: (r) => <span className="mono">{r.handle || `#${r.account_id}`}</span>,
    },
    { key: 'platform', label: 'Platform', render: (r) => <span className="badge">{r.platform}</span> },
    { key: 'product', label: 'Product', render: (r) => <span className="mono">{r.product}</span> },
    {
      key: 'silence_ms',
      label: 'Silence',
      sortable: true,
      render: (r) => {
        const days = (r.silence_ms ?? 0) / 86400000;
        const tone = days > 7 ? 'danger' : days > 3 ? 'warn' : '';
        return <span className={`badge ${tone}`}>{fmtRelative(r.last_received_at)}</span>;
      },
    },
    { key: 'last_received_at', label: 'Last received', render: (r) => fmtRelative(r.last_received_at) },
  ];

  return (
    <AdminLayout title="Webhooks">
      {inbound.error && !inbound.data && <div className="banner">{inbound.error}</div>}
      {err && <div className="banner">{err}</div>}

      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 'var(--space-5)' }}
      >
        <div className="panel">
          <div className="kpi-label">Inbound (last 100)</div>
          <div className="kpi-value">{rows.length}</div>
        </div>
        <div className="panel">
          <div className="kpi-label">Sig-invalid rate</div>
          <div
            className="kpi-value"
            style={{ color: invalidRate > 0 ? 'var(--danger)' : 'var(--ok)' }}
          >
            {(invalidRate * 100).toFixed(1)}%
          </div>
        </div>
        <div className="panel">
          <div className="kpi-label">Silent accounts</div>
          <div className="kpi-value">{silence.data?.length ?? 0}</div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 'var(--space-5)', padding: 0 }}>
        <div
          style={{
            padding: 'var(--space-3) var(--space-4)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div className="panel-title" style={{ margin: 0 }}>
            Inbound
          </div>
        </div>
        <DataTable<Webhook>
          rows={rows}
          columns={inboundCols}
          rowKey={(r) => String(r.id)}
          emptyLabel="No inbound webhooks yet."
        />
      </div>

      <div className="panel" style={{ padding: 0 }}>
        <div
          style={{
            padding: 'var(--space-3) var(--space-4)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div className="panel-title" style={{ margin: 0 }}>
            Silence detector
          </div>
        </div>
        <DataTable<Silence>
          rows={silence.data || []}
          columns={silenceCols}
          rowKey={(r) => `${r.account_id}:${r.product}`}
          emptyLabel="No silent accounts."
        />
      </div>
    </AdminLayout>
  );
}
