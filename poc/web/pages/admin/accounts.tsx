import { useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { useLive } from '../../lib/useLive';
import { adminPatch, adminPost } from '../../lib/api';
import { fmtRelative } from '../../lib/format';

type ProductHealth = {
  last_success_at?: string;
  next_run_at?: string;
  last_error?: string | null;
  failure_count?: number;
  override_active?: boolean;
};

type AdminAccount = {
  id: number | string;
  platform: string;
  handle?: string;
  display_name?: string;
  sync_tier?: string;
  status?: string;
  token_expires_at?: string;
  products?: Record<string, ProductHealth>;
};

const TIERS = ['vip', 'standard', 'lite', 'demo', 'paused'];
const PRODUCTS = ['identity', 'audience', 'engagement_new', 'stories'];

export default function AccountsPage() {
  const { data, error, refresh } = useLive<AdminAccount[]>('/admin/accounts');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const call = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const refreshCell = (id: string | number, product: string) =>
    call(`refresh:${id}:${product}`, () =>
      adminPost(`/admin/accounts/${id}/refresh-now`, { products: [product] }),
    );

  const setTier = (id: string | number, tier: string) =>
    call(`tier:${id}`, () => adminPatch(`/admin/accounts/${id}/sync-tier`, { tier }));

  const pause = (id: string | number, paused: boolean) =>
    call(`pause:${id}`, () =>
      adminPost(`/admin/accounts/${id}/${paused ? 'unpause' : 'pause'}`, {}),
    );

  return (
    <AdminLayout title="Account health">
      {error && !data && <div className="banner">{error}</div>}
      {err && <div className="banner">{err}</div>}

      <div className="panel" style={{ overflowX: 'auto' }}>
        {!data || data.length === 0 ? (
          <div className="muted">No accounts.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Platform</th>
                <th>Tier</th>
                {PRODUCTS.map((p) => (
                  <th key={p} style={{ minWidth: 140 }}>
                    {p}
                  </th>
                ))}
                <th>Token</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((a) => {
                const paused = a.status === 'paused';
                return (
                  <tr key={String(a.id)}>
                    <td>
                      <div className="mono" style={{ fontWeight: 600 }}>
                        {a.handle || `#${a.id}`}
                      </div>
                      <div className="faint" style={{ fontSize: 11 }}>
                        {a.display_name}
                      </div>
                    </td>
                    <td>
                      <span className="badge">{a.platform}</span>
                    </td>
                    <td>
                      <select
                        value={a.sync_tier ?? 'standard'}
                        disabled={busy === `tier:${a.id}`}
                        onChange={(e) => setTier(a.id, e.target.value)}
                      >
                        {TIERS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    {PRODUCTS.map((p) => (
                      <td key={p} style={{ verticalAlign: 'top' }}>
                        <ProductCell
                          health={a.products?.[p]}
                          onRefresh={() => refreshCell(a.id, p)}
                          busy={busy === `refresh:${a.id}:${p}`}
                        />
                      </td>
                    ))}
                    <td>
                      <TokenCountdown at={a.token_expires_at} />
                    </td>
                    <td>
                      <button
                        className={paused ? 'primary' : ''}
                        disabled={busy === `pause:${a.id}`}
                        onClick={() => pause(a.id, paused)}
                      >
                        {paused ? 'Unpause' : 'Pause'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </AdminLayout>
  );
}

function ProductCell({
  health,
  onRefresh,
  busy,
}: {
  health?: ProductHealth;
  onRefresh: () => void;
  busy: boolean;
}) {
  if (!health) {
    return (
      <div className="faint" style={{ fontSize: 11 }}>
        —
      </div>
    );
  }
  const tone = cellTone(health);
  const bg =
    tone === 'danger'
      ? '#1f0a0a'
      : tone === 'warn'
      ? '#1f1808'
      : tone === 'ok'
      ? '#0d1f12'
      : 'var(--bg-panel-hi)';
  const border =
    tone === 'danger'
      ? '#5a2020'
      : tone === 'warn'
      ? '#5a3e10'
      : tone === 'ok'
      ? '#1f4d2c'
      : 'var(--border)';
  return (
    <div
      title={health.last_error || ''}
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 'var(--radius)',
        padding: '6px 8px',
        fontSize: 11,
        lineHeight: 1.4,
      }}
    >
      <div className="mono">last {fmtRelative(health.last_success_at)}</div>
      <div className="mono faint">next {fmtRelative(health.next_run_at)}</div>
      {(health.failure_count ?? 0) > 0 && (
        <div className="mono" style={{ color: 'var(--danger)' }}>
          {health.failure_count} fails
        </div>
      )}
      {health.override_active && <div className="badge warn">override</div>}
      <button
        onClick={onRefresh}
        disabled={busy}
        style={{ marginTop: 4, padding: '3px 6px', fontSize: 11 }}
      >
        {busy ? '…' : 'Refresh'}
      </button>
    </div>
  );
}

function cellTone(h: ProductHealth): 'ok' | 'warn' | 'danger' | '' {
  if (h.failure_count && h.failure_count > 0) return 'danger';
  if (!h.last_success_at) return 'warn';
  if (h.next_run_at) {
    const nxt = new Date(h.next_run_at).getTime();
    if (!isNaN(nxt) && nxt < Date.now()) return 'warn';
  }
  return 'ok';
}

function TokenCountdown({ at }: { at?: string }) {
  if (!at) return <span className="faint">—</span>;
  const ms = new Date(at).getTime() - Date.now();
  const days = Math.floor(ms / 86400000);
  if (days < 0) return <span className="badge danger">expired</span>;
  if (days < 7) return <span className="badge warn">{days}d</span>;
  return <span className="mono">{days}d</span>;
}
