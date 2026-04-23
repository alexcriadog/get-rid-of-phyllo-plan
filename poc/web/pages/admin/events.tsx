import { useMemo, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import DataTable, { Column } from '../../components/DataTable';
import { useLive } from '../../lib/useLive';
import { fmtTime } from '../../lib/format';

type EventRow = {
  id?: number | string;
  _id?: string;
  event_type?: string;
  account_id?: number | string;
  emitted_at?: string;
  payload?: unknown;
};

export default function EventsPage() {
  const [eventType, setEventType] = useState('');
  const [accountId, setAccountId] = useState('');
  const [selected, setSelected] = useState<EventRow | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (eventType) p.set('event_type', eventType);
    if (accountId) p.set('account_id', accountId);
    p.set('limit', '100');
    return p.toString();
  }, [eventType, accountId]);

  const { data, error } = useLive<EventRow[]>(`/admin/events?${qs}`);
  const rows = data || [];

  const counter = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of rows) {
      const t = r.event_type || 'unknown';
      out[t] = (out[t] || 0) + 1;
    }
    return out;
  }, [rows]);

  const columns: Column<EventRow>[] = [
    { key: 'emitted_at', label: 'Time', sortable: true, render: (r) => fmtTime(r.emitted_at) },
    {
      key: 'event_type',
      label: 'Event type',
      sortable: true,
      render: (r) => <span className="badge">{r.event_type}</span>,
    },
    {
      key: 'account_id',
      label: 'Account',
      render: (r) => <span className="mono">{r.account_id ?? '—'}</span>,
    },
    {
      key: 'payload',
      label: 'Payload',
      render: (r) => (
        <span
          className="mono faint"
          style={{
            maxWidth: 360,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            display: 'inline-block',
          }}
        >
          {JSON.stringify(r.payload)}
        </span>
      ),
    },
  ];

  return (
    <AdminLayout title="Event log">
      {error && !data && <div className="banner">{error}</div>}

      <div className="panel" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="row wrap" style={{ gap: 'var(--space-2)' }}>
          <input
            placeholder="event type"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
          />
          <input
            placeholder="account id"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            style={{ width: 120 }}
          />
          <div className="spacer" />
          <div className="row wrap" style={{ gap: 4 }}>
            {Object.entries(counter).map(([k, v]) => (
              <span key={k} className="badge">
                {k} · {v}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="panel" style={{ padding: 0 }}>
        <DataTable<EventRow>
          rows={rows}
          columns={columns}
          rowKey={(r, i) => String(r.id || r._id || i)}
          onRowClick={(r) => setSelected(r)}
          emptyLabel="No events."
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
              <div className="panel-title">Event detail</div>
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
