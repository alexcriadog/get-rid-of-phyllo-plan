import { useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import DataTable, { Column } from '../../components/DataTable';
import { useLive } from '../../lib/useLive';
import { adminPost } from '../../lib/api';
import { fmtRelative, fmtMs } from '../../lib/format';

type Lock = {
  key: string;
  account_id?: number | string;
  product?: string;
  ttl_remaining_ms?: number;
  acquired_at?: string;
};

export default function ThrottleLocksPage() {
  const { data, error, refresh } = useLive<Lock[]>('/admin/throttle-locks');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const release = async (key: string) => {
    setBusy(key);
    setErr(null);
    try {
      await adminPost('/admin/throttle-locks/release', { key });
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const columns: Column<Lock>[] = [
    { key: 'key', label: 'Lock key', render: (r) => <span className="mono">{r.key}</span> },
    {
      key: 'account_id',
      label: 'Account',
      render: (r) => <span className="mono">{r.account_id ?? '—'}</span>,
    },
    { key: 'product', label: 'Product', render: (r) => <span className="mono">{r.product ?? '—'}</span> },
    {
      key: 'ttl_remaining_ms',
      label: 'TTL',
      sortable: true,
      render: (r) => {
        const tone = (r.ttl_remaining_ms ?? 0) < 5000 ? 'warn' : '';
        return <span className={`badge ${tone}`}>{fmtMs(r.ttl_remaining_ms)}</span>;
      },
    },
    { key: 'acquired_at', label: 'Acquired', render: (r) => fmtRelative(r.acquired_at) },
    {
      key: 'actions',
      label: '',
      render: (r) => (
        <button className="danger" disabled={busy === r.key} onClick={() => release(r.key)}>
          Release
        </button>
      ),
    },
  ];

  return (
    <AdminLayout title="Throttle locks">
      {error && !data && <div className="banner">{error}</div>}
      {err && <div className="banner">{err}</div>}
      <div className="panel" style={{ padding: 0 }}>
        <DataTable<Lock>
          rows={data || []}
          columns={columns}
          rowKey={(r) => r.key}
          emptyLabel="No active throttle locks."
        />
      </div>
    </AdminLayout>
  );
}
