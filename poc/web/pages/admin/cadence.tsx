import { useEffect, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { useLive } from '../../lib/useLive';
import { adminPatch, adminPost, adminDelete } from '../../lib/api';
import { fmtNumber } from '../../lib/format';

type Cadence = {
  platform: string;
  product: string;
  default_interval_seconds: number;
  updated_at?: string;
};

type Override = {
  product: string;
  override_interval_seconds: number;
  reason?: string;
  expires_at?: string;
};

type AdminAccount = {
  id: number | string;
  platform: string;
  handle?: string;
  display_name?: string;
  sync_tier?: string;
  overrides?: Override[];
};

type Projection =
  | { per_platform: { platform: string; calls_per_hour: number }[] }
  | { [platform: string]: { calls_per_hour: number } };

const TIERS = ['vip', 'standard', 'lite', 'demo', 'paused'];

export default function CadencePage() {
  const cadences = useLive<Cadence[]>('/admin/cadences');
  const accounts = useLive<AdminAccount[]>('/admin/accounts');
  const projection = useLive<Projection>('/admin/cadences/projection');
  const [err, setErr] = useState<string | null>(null);

  const saveCadence = async (c: Cadence, newSeconds: number) => {
    setErr(null);
    try {
      await adminPatch(`/admin/cadences/${c.platform}/${c.product}`, {
        interval_seconds: newSeconds,
      });
      cadences.refresh();
      projection.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const saveTier = async (account: AdminAccount, tier: string) => {
    setErr(null);
    try {
      await adminPatch(`/admin/accounts/${account.id}/sync-tier`, { tier });
      accounts.refresh();
      projection.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const projectionEntries = normaliseProjection(projection.data);

  return (
    <AdminLayout title="Cadence control">
      {err && <div className="banner">{err}</div>}

      <div className="panel" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="panel-title">Projected API calls / hour</div>
        {projectionEntries.length === 0 ? (
          <div className="muted">
            {projection.error ? projection.error : 'Projection unavailable.'}
          </div>
        ) : (
          <div className="row wrap" style={{ gap: 'var(--space-5)' }}>
            {projectionEntries.map((p) => (
              <div key={p.platform}>
                <div className="kpi-label">{p.platform}</div>
                <div className="kpi-value">{fmtNumber(Math.round(p.calls_per_hour))}</div>
                <div className="faint" style={{ fontSize: 11 }}>
                  calls / hour
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="panel-title">Platform defaults</div>
        {!cadences.data || cadences.data.length === 0 ? (
          <div className="muted">{cadences.error ? cadences.error : 'No cadences yet.'}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Platform</th>
                <th>Product</th>
                <th>Interval (s)</th>
                <th>Human</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cadences.data.map((c) => (
                <CadenceRow key={`${c.platform}:${c.product}`} cadence={c} onSave={saveCadence} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="panel-title">Account tiers</div>
        {!accounts.data || accounts.data.length === 0 ? (
          <div className="muted">No accounts.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Platform</th>
                <th>Tier</th>
              </tr>
            </thead>
            <tbody>
              {accounts.data.map((a) => (
                <tr key={String(a.id)}>
                  <td>
                    <div className="mono">{a.handle || `#${a.id}`}</div>
                    <div className="faint" style={{ fontSize: 11 }}>
                      {a.display_name}
                    </div>
                  </td>
                  <td className="mono">{a.platform}</td>
                  <td>
                    <select
                      value={a.sync_tier ?? 'standard'}
                      onChange={(e) => saveTier(a, e.target.value)}
                    >
                      {TIERS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <OverridesPanel
        accounts={accounts.data || []}
        onChange={() => {
          accounts.refresh();
          projection.refresh();
        }}
      />
    </AdminLayout>
  );
}

function CadenceRow({
  cadence,
  onSave,
}: {
  cadence: Cadence;
  onSave: (c: Cadence, seconds: number) => void;
}) {
  const [value, setValue] = useState(String(cadence.default_interval_seconds));
  useEffect(() => {
    setValue(String(cadence.default_interval_seconds));
  }, [cadence.default_interval_seconds]);

  const dirty = Number(value) !== cadence.default_interval_seconds;
  return (
    <tr>
      <td className="mono">{cadence.platform}</td>
      <td className="mono">{cadence.product}</td>
      <td>
        <input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ width: 100 }}
        />
      </td>
      <td className="faint mono">{secondsHuman(Number(value))}</td>
      <td>
        <button
          className={dirty ? 'primary' : ''}
          disabled={!dirty || !Number.isFinite(Number(value))}
          onClick={() => onSave(cadence, Number(value))}
        >
          Save
        </button>
      </td>
    </tr>
  );
}

function OverridesPanel({
  accounts,
  onChange,
}: {
  accounts: AdminAccount[];
  onChange: () => void;
}) {
  const [accountId, setAccountId] = useState('');
  const [product, setProduct] = useState('identity');
  const [seconds, setSeconds] = useState('300');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    setErr(null);
    try {
      await adminPost(`/admin/accounts/${accountId}/cadence-overrides`, {
        product,
        interval_seconds: Number(seconds),
        reason: reason || undefined,
      });
      setReason('');
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const remove = async (id: string | number, prod: string) => {
    setErr(null);
    try {
      await adminDelete(`/admin/accounts/${id}/cadence-overrides/${prod}`);
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const rows = accounts.flatMap((a) => (a.overrides || []).map((o) => ({ ...o, account: a })));

  return (
    <div className="panel">
      <div className="panel-title">Per-account overrides</div>
      {err && <div className="banner">{err}</div>}

      <div className="row wrap" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">— pick account —</option>
          {accounts.map((a) => (
            <option key={String(a.id)} value={String(a.id)}>
              {a.handle || `#${a.id}`} ({a.platform})
            </option>
          ))}
        </select>
        <select value={product} onChange={(e) => setProduct(e.target.value)}>
          <option value="identity">identity</option>
          <option value="audience">audience</option>
          <option value="engagement_new">engagement_new</option>
          <option value="stories">stories</option>
        </select>
        <input
          type="number"
          value={seconds}
          onChange={(e) => setSeconds(e.target.value)}
          placeholder="seconds"
          style={{ width: 100 }}
        />
        <input
          placeholder="reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{ flex: 1, minWidth: 180 }}
        />
        <button className="primary" disabled={!accountId || !seconds} onClick={add}>
          Add override
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="muted">No active overrides.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Product</th>
              <th>Interval</th>
              <th>Reason</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.account.id}:${r.product}`}>
                <td className="mono">{r.account.handle || `#${r.account.id}`}</td>
                <td className="mono">{r.product}</td>
                <td className="mono">{secondsHuman(r.override_interval_seconds)}</td>
                <td className="faint">{r.reason || '—'}</td>
                <td>
                  <button className="danger" onClick={() => remove(r.account.id, r.product)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function secondsHuman(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

function normaliseProjection(
  p: Projection | null,
): { platform: string; calls_per_hour: number }[] {
  if (!p) return [];
  if ('per_platform' in p && Array.isArray(p.per_platform)) return p.per_platform;
  return Object.entries(p as Record<string, { calls_per_hour: number }>).map(([platform, v]) => ({
    platform,
    calls_per_hour: v?.calls_per_hour ?? 0,
  }));
}
