import { useMemo, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import DataTable, { Column } from '../../components/DataTable';
import { useLive } from '../../lib/useLive';
import { fmtRelative, fmtDateTime } from '../../lib/format';

type NextRun = {
  job_id: number | string;
  account_id: number | string;
  handle?: string;
  platform: string;
  product: string;
  next_run_at: string;
  priority?: string;
  status?: string;
};

const HOUR_MS = 3600000;
const WINDOW_HOURS = 24;

export default function NextRunsPage() {
  const { data, error } = useLive<NextRun[]>(`/admin/next-runs?horizon_hours=${WINDOW_HOURS}`);
  const [pausedSim, setPausedSim] = useState<Set<string>>(new Set());

  const rows = data || [];
  const active = useMemo(
    () => rows.filter((r) => !pausedSim.has(String(r.account_id))),
    [rows, pausedSim],
  );

  const grouped = useMemo(() => groupByPlatformAccount(active), [active]);
  const now = Date.now();
  const horizonEnd = now + WINDOW_HOURS * HOUR_MS;

  const columns: Column<NextRun>[] = [
    {
      key: 'next_run_at',
      label: 'When',
      sortable: true,
      render: (r) => fmtDateTime(r.next_run_at),
    },
    {
      key: 'rel',
      label: 'Due',
      render: (r) => fmtRelative(r.next_run_at),
      accessor: (r) => new Date(r.next_run_at).getTime(),
    },
    {
      key: 'platform',
      label: 'Platform',
      sortable: true,
      render: (r) => <span className="badge">{r.platform}</span>,
    },
    {
      key: 'handle',
      label: 'Account',
      sortable: true,
      render: (r) => <span className="mono">{r.handle || `#${r.account_id}`}</span>,
    },
    { key: 'product', label: 'Product', sortable: true, render: (r) => <span className="mono">{r.product}</span> },
    {
      key: 'priority',
      label: 'Priority',
      render: (r) => <span className="badge">{r.priority || 'NORMAL'}</span>,
    },
    { key: 'status', label: 'Status', render: (r) => <span className="mono">{r.status || 'idle'}</span> },
  ];

  return (
    <AdminLayout title="Next executions · 24h">
      {error && !data && <div className="banner">{error}</div>}

      <div className="panel" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="panel-title">Timeline</div>
        {grouped.length === 0 ? (
          <div className="muted">Nothing scheduled in the next {WINDOW_HOURS}h.</div>
        ) : (
          <div>
            <HourAxis now={now} />
            {grouped.map((g) => (
              <TimelineRow key={`${g.platform}::${g.account_id}`} group={g} now={now} />
            ))}
          </div>
        )}
        <div className="faint" style={{ fontSize: 11, marginTop: 'var(--space-3)' }}>
          Range: {new Date(now).toLocaleString()} → {new Date(horizonEnd).toLocaleString()}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="panel-title">Simulator — paused accounts</div>
        {rows.length === 0 ? (
          <div className="muted">No accounts.</div>
        ) : (
          <div className="row wrap" style={{ gap: 'var(--space-2)' }}>
            {Array.from(new Set(rows.map((r) => String(r.account_id)))).map((aid) => {
              const sample = rows.find((r) => String(r.account_id) === aid)!;
              const paused = pausedSim.has(aid);
              return (
                <button
                  key={aid}
                  onClick={() =>
                    setPausedSim((prev) => {
                      const next = new Set(prev);
                      if (next.has(aid)) next.delete(aid);
                      else next.add(aid);
                      return next;
                    })
                  }
                  className={paused ? 'primary' : ''}
                  style={{ opacity: paused ? 0.6 : 1 }}
                >
                  {paused ? '▶ ' : '❚❚ '} {sample.handle || `#${aid}`}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-title">Next 50 due</div>
        <DataTable<NextRun>
          rows={active.slice(0, 50)}
          columns={columns}
          rowKey={(r) => String(r.job_id)}
        />
      </div>
    </AdminLayout>
  );
}

type Group = {
  platform: string;
  account_id: string;
  handle?: string;
  runs: NextRun[];
};

function groupByPlatformAccount(rows: NextRun[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const key = `${r.platform}::${r.account_id}`;
    if (!map.has(key)) {
      map.set(key, {
        platform: r.platform,
        account_id: String(r.account_id),
        handle: r.handle,
        runs: [],
      });
    }
    map.get(key)!.runs.push(r);
  }
  return [...map.values()].sort((a, b) => a.platform.localeCompare(b.platform));
}

function HourAxis({ now }: { now: number }) {
  const ticks = Array.from({ length: WINDOW_HOURS + 1 }, (_, i) => i);
  return (
    <div
      className="row"
      style={{
        position: 'relative',
        height: 22,
        borderBottom: '1px solid var(--border)',
        marginBottom: 6,
        paddingLeft: 160,
      }}
    >
      <div style={{ position: 'relative', flex: 1, height: '100%' }}>
        {ticks.map((h) => (
          <div
            key={h}
            style={{
              position: 'absolute',
              left: `${(h / WINDOW_HOURS) * 100}%`,
              top: 0,
              bottom: 0,
              borderLeft: '1px solid var(--border)',
              color: 'var(--text-muted)',
              fontSize: 10,
              fontFamily: 'var(--mono)',
              paddingLeft: 2,
              transform: h === WINDOW_HOURS ? 'translateX(-100%)' : undefined,
            }}
          >
            {new Date(now + h * HOUR_MS).getHours()}h
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineRow({ group, now }: { group: Group; now: number }) {
  return (
    <div
      className="row"
      style={{ alignItems: 'stretch', borderBottom: '1px solid var(--border)', padding: '4px 0' }}
    >
      <div
        style={{
          width: 160,
          paddingRight: 8,
          borderRight: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div className="badge" style={{ marginBottom: 2 }}>
          {group.platform}
        </div>
        <div
          className="mono"
          style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {group.handle || `#${group.account_id}`}
        </div>
      </div>
      <div
        style={{
          position: 'relative',
          flex: 1,
          height: 28,
          background:
            'repeating-linear-gradient(90deg, transparent, transparent calc(100% / 24 - 1px), var(--border) calc(100% / 24 - 1px), var(--border) calc(100% / 24))',
        }}
      >
        {group.runs.map((r) => {
          const ts = new Date(r.next_run_at).getTime();
          const pct = ((ts - now) / (WINDOW_HOURS * HOUR_MS)) * 100;
          if (pct < -1 || pct > 101) return null;
          const clamped = Math.max(0, Math.min(99.5, pct));
          const colour = r.priority === 'HIGH' ? 'var(--danger)' : 'var(--accent)';
          return (
            <div
              key={String(r.job_id)}
              title={`${r.product} · ${fmtDateTime(r.next_run_at)} · ${r.priority || 'NORMAL'}`}
              style={{
                position: 'absolute',
                left: `${clamped}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: colour,
                border: '2px solid var(--bg-panel)',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
