import { useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import Gauge from '../../components/Gauge';
import Sparkline from '../../components/Sparkline';
import { useLive } from '../../lib/useLive';
import { adminPost } from '../../lib/api';
import { fmtNumber, fmtRelative, fmtPct } from '../../lib/format';

type Bucket = {
  key: string;
  platform: string;
  scope?: string;
  tokens: number;
  capacity: number;
  refill_per_ms?: number;
  hits?: number;
  denies?: number;
  last_acquire_at?: string;
  headers_observed?: {
    usage_pct?: number;
    declared_capacity?: number;
  } | null;
};

export default function RateLimitsPage() {
  const { data: buckets, error } = useLive<Bucket[]>('/admin/rate-buckets', 1000);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reset = async (key: string) => {
    setBusy(key);
    setActionError(null);
    try {
      await adminPost(`/admin/rate-buckets/${encodeURIComponent(key)}/reset`);
    } catch (e) {
      setActionError(`reset ${key}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const burst = async (key: string, accountId: string) => {
    setBusy(key);
    setActionError(null);
    try {
      // Fire 20 manual refreshes in parallel against the account tied to this bucket.
      const promises = Array.from({ length: 20 }).map(() =>
        adminPost(`/admin/accounts/${accountId}/refresh-now`, {}).catch(() => undefined),
      );
      await Promise.all(promises);
    } catch (e) {
      setActionError(`burst ${key}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminLayout title="Rate buckets">
      {error && !buckets && <div className="banner">{error}</div>}
      {actionError && <div className="banner">{actionError}</div>}

      {!buckets || buckets.length === 0 ? (
        <div className="panel muted">No buckets yet.</div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}>
          {buckets.map((b) => (
            <BucketCard
              key={b.key}
              bucket={b}
              busy={busy === b.key}
              onReset={() => reset(b.key)}
              onBurst={(aid) => burst(b.key, aid)}
            />
          ))}
        </div>
      )}
    </AdminLayout>
  );
}

function BucketCard({
  bucket,
  busy,
  onReset,
  onBurst,
}: {
  bucket: Bucket;
  busy: boolean;
  onReset: () => void;
  onBurst: (accountId: string) => void;
}) {
  const [injectId, setInjectId] = useState('');
  const history = useLive<number[] | { points: number[] }>(
    `/admin/rate-buckets/history?key=${encodeURIComponent(bucket.key)}&mins=60`,
    5000,
  );
  const points = normaliseHistory(history.data);
  const observedPct = bucket.headers_observed?.usage_pct;
  const declared = bucket.headers_observed?.declared_capacity;
  const drift =
    declared != null && declared > 0
      ? Math.abs((declared - bucket.capacity) / bucket.capacity)
      : 0;
  const refillPerMin = bucket.refill_per_ms ? bucket.refill_per_ms * 60000 : null;

  return (
    <div className="panel">
      <div className="row" style={{ marginBottom: 'var(--space-3)' }}>
        <span className="badge">{bucket.platform}</span>
        <span className="mono" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
          {bucket.key}
        </span>
      </div>

      <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
        <Gauge value={bucket.tokens} max={bucket.capacity} size={96} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Sparkline points={points} max={bucket.capacity} min={0} />
          <div className="row" style={{ gap: 'var(--space-3)', marginTop: 6, fontSize: 11 }}>
            <StatSmall label="refill / min" value={refillPerMin ? refillPerMin.toFixed(2) : '—'} />
            <StatSmall label="hits" value={fmtNumber(bucket.hits)} />
            <StatSmall
              label="denies"
              value={fmtNumber(bucket.denies)}
              tone={bucket.denies ? 'danger' : undefined}
            />
            <StatSmall label="last" value={fmtRelative(bucket.last_acquire_at)} />
          </div>
        </div>
      </div>

      {(observedPct != null || declared != null) && (
        <div
          className="row"
          style={{
            marginTop: 'var(--space-3)',
            padding: 'var(--space-2) var(--space-3)',
            background: drift > 0.15 ? '#1f0a0a' : 'var(--bg-panel-hi)',
            border: `1px solid ${drift > 0.15 ? '#5a2020' : 'var(--border)'}`,
            borderRadius: 'var(--radius)',
            fontSize: 11,
          }}
        >
          <span className="mono muted">HEADER</span>
          <span className="mono" style={{ color: drift > 0.15 ? 'var(--danger)' : 'var(--text)' }}>
            obs {fmtPct(observedPct != null ? observedPct / 100 : null)}
          </span>
          <span className="mono muted">declared cap {declared ?? '—'}</span>
          <span className="mono muted">vs local cap {bucket.capacity}</span>
          <div className="spacer" />
          {drift > 0.15 && <span className="badge danger">drift {fmtPct(drift, 0)}</span>}
        </div>
      )}

      <div className="row" style={{ marginTop: 'var(--space-3)', gap: 'var(--space-2)' }}>
        <input
          placeholder="account id → inject 20 req"
          value={injectId}
          onChange={(e) => setInjectId(e.target.value)}
          style={{ flex: 1 }}
        />
        <button onClick={() => injectId && onBurst(injectId)} disabled={busy || !injectId}>
          Inject 20
        </button>
        <button onClick={onReset} disabled={busy} className="danger">
          Reset
        </button>
      </div>
    </div>
  );
}

function StatSmall({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'danger';
}) {
  return (
    <div style={{ minWidth: 60 }}>
      <div
        className="mono"
        style={{ fontSize: 12, color: tone === 'danger' ? 'var(--danger)' : 'var(--text)' }}
      >
        {value}
      </div>
      <div className="kpi-label" style={{ fontSize: 10 }}>
        {label}
      </div>
    </div>
  );
}

function normaliseHistory(data: number[] | { points: number[] } | null): number[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return Array.isArray(data.points) ? data.points : [];
}
