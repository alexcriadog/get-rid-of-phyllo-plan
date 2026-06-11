import { useState } from 'react';
import { useLive, POLL } from '@/lib/useLive';
import { MiniBar } from '@/components/term/charts';
import { cn } from '@/lib/utils';

/**
 * Usage panel (id `usage`).
 *
 * Ports the legacy `/admin/usage` page into the Mint Terminal idiom. Shows
 * per-workspace API request telemetry: workspace name/slug, daily heat cells,
 * and a proportional MiniBar vs the per-day max. Range selector (7 / 14 / 30 /
 * 90 d) is built into the panel header.
 *
 * Data: GET /admin/usage?days=<n>
 * Polled at `list` cadence (5 s) — counters update frequently.
 */

type UsageResponse = {
  days: string[];
  workspaces: Array<{
    id: string;
    slug: string;
    name: string;
    counts: number[];
    total: number;
  }>;
};

const RANGES: { label: string; days: number }[] = [
  { label: '7d', days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

export default function UsagePanel() {
  const [days, setDays] = useState(7);
  const usage = useLive<UsageResponse>(`/admin/usage?days=${days}`, POLL.list);
  const d = usage.data;
  const apiDown = !!usage.error && !d;

  const maxCount = d
    ? d.workspaces.reduce((m, ws) => Math.max(m, ...ws.counts), 0)
    : 0;

  return (
    <div className="flex h-full flex-col gap-2 p-3 font-mono text-xs">
      <HeaderRow apiDown={apiDown} error={usage.error} days={days} onDaysChange={setDays} />

      {!apiDown && !d && (
        <div className="flex items-center gap-2 text-term-faint">
          <span className="animate-term-blink text-term-mint">▮</span>
          connecting…
        </div>
      )}

      {d && d.workspaces.length === 0 && (
        <div className="py-4 text-center text-term-faint">
          &gt; no telemetry yet — counters populate as workspaces hit /v1/*{' '}
          <span className="animate-term-blink">▮</span>
        </div>
      )}

      {d && d.workspaces.length > 0 && (
        <div className="flex-1 overflow-auto">
          <WorkspaceTable data={d} maxCount={maxCount} />
        </div>
      )}

      <div className="mt-auto border-t border-term-line pt-1.5 text-[10px] text-term-faint">
        /v1/* requests per workspace per UTC day · retained 90 d in Redis
      </div>
    </div>
  );
}

function HeaderRow({
  apiDown,
  error,
  days,
  onDaysChange,
}: {
  apiDown: boolean;
  error: string | null;
  days: number;
  onDaysChange: (d: number) => void;
}) {
  if (apiDown) {
    return (
      <div className="flex items-center gap-2 border-b border-term-line pb-2 text-term-danger">
        <span aria-hidden="true">●</span>
        <span className="uppercase tracking-[0.12em]">API UNREACHABLE</span>
        {error && <span className="truncate text-term-faint">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 border-b border-term-line pb-2">
      <span className="text-[10px] uppercase tracking-[0.12em] text-term-faint">
        USAGE TELEMETRY
      </span>
      <div className="flex gap-1" role="group" aria-label="Date range">
        {RANGES.map((r) => (
          <button
            key={r.label}
            aria-pressed={days === r.days}
            onClick={() => onDaysChange(r.days)}
            className={cn(
              'rounded border px-1.5 py-0.5 text-[10px] transition-colors',
              days === r.days
                ? 'border-term-mint/60 bg-term-mint/10 text-term-mint'
                : 'border-term-line text-term-faint hover:text-term-text',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkspaceTable({
  data,
  maxCount,
}: {
  data: UsageResponse;
  maxCount: number;
}) {
  const maxTotal = data.workspaces.reduce((m, w) => Math.max(m, w.total), 0);
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b border-term-line">
          <th
            scope="col"
            className="sticky left-0 bg-term-base px-2 py-1 text-left text-[10px] uppercase tracking-[0.1em] text-term-faint"
          >
            Workspace
          </th>
          {data.days.map((day) => (
            <th
              key={day}
              scope="col"
              className="px-1.5 py-1 text-right text-[10px] tabular-nums text-term-faint"
            >
              {day.slice(5)}
            </th>
          ))}
          <th
            scope="col"
            className="px-2 py-1 text-right text-[10px] uppercase tracking-[0.1em] text-term-faint"
          >
            Total
          </th>
        </tr>
      </thead>
      <tbody>
        {data.workspaces.map((ws) => (
          <tr key={ws.id} className="border-b border-term-line/40 last:border-0">
            <td className="sticky left-0 bg-term-base px-2 py-1">
              <div className="text-term-text">{ws.name}</div>
              <div className="text-[10px] text-term-faint">{ws.slug}</div>
            </td>
            {ws.counts.map((count, i) => (
              <td
                key={i}
                className="px-1.5 py-1 text-right tabular-nums"
                title={`${data.days[i]}: ${count.toLocaleString()} requests`}
              >
                {count === 0 ? (
                  <span className="text-term-faint">·</span>
                ) : (
                  <HeatCell count={count} max={maxCount} />
                )}
              </td>
            ))}
            <td className="px-2 py-1 text-right tabular-nums">
              <div className="flex items-center justify-end gap-1.5">
                <MiniBar
                  value={ws.total}
                  max={maxTotal}
                  tone="mint"
                  label={`${ws.name} total requests`}
                  className="w-8"
                />
                <span className="text-term-text">{ws.total.toLocaleString()}</span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HeatCell({ count, max }: { count: number; max: number }) {
  const intensity = max > 0 ? Math.min(1, count / max) : 0;
  // Mint terminal accent at varying opacity — matches the terminal colour palette.
  const alpha = (intensity * 0.65).toFixed(2);
  return (
    <span
      className="inline-block rounded px-1 py-0.5 tabular-nums text-term-text"
      style={{ background: `rgba(var(--term-mint), ${alpha})` }}
    >
      {count.toLocaleString()}
    </span>
  );
}
