import { useMemo, useState } from 'react';
import { useLive, POLL } from '@/lib/useLive';
import { useWorkspaceFilter } from '@/lib/workspace-context';
import { fmtRelative, fmtTime } from '@/lib/format';
import { MiniBar } from '@/components/term/charts';
import PlatformTag from '@/components/term/PlatformTag';
import TermInput from '@/components/term/TermInput';
import { cn } from '@/lib/utils';

/**
 * SchedulePanel — Phase 3 workbench panel (id: "schedule").
 *
 * Ports the core "Up next" list from `pages/admin/next-runs.tsx` into the
 * Mint Terminal idiom. Shows the next N upcoming scheduled sync runs: a
 * relative countdown ("in 4m"), PlatformTag, account handle, product, a
 * MiniBar toward run-time, and a failure-count badge in danger tone.
 *
 * Intentionally left out vs the legacy page:
 * – Timeline/gantt chart (requires heavy SVG layout, wrong for a tile)
 * – Horizon tabs (6h/24h/72h) — fixed 24h window; simpler in a dense tile
 * – Run-now modal + risk-check flow (heavy UX, left to the full page)
 * – URL account filter (replaced by in-panel text filter)
 *
 * Workspace scoping: respects the topbar workspace selector via
 * `useWorkspaceFilter().withQuery(...)` exactly like the legacy page.
 *
 * Data: GET /admin/next-runs?horizon_hours=24 (+ optional workspace query).
 * Polled at POLL.list (5 s) — scheduled times change infrequently.
 */

type NextRun = {
  id?: string;
  accountId: string;
  accountHandle?: string | null;
  platform: string;
  product: string;
  next_run_at: string;
  status?: string;
  failure_count?: number;
  last_success_at?: string | null;
};

/** Rows shown in the panel (trimmed to keep the tile scannable). */
const MAX_ROWS = 20;

/** Horizon is fixed at 24 h for the tile view. */
const HORIZON_HOURS = 24;

type FailureTone = 'mint' | 'warn' | 'danger';

function failureTone(failureCount: number): FailureTone {
  if (failureCount >= 3) return 'danger';
  if (failureCount > 0) return 'warn';
  return 'mint';
}

function toneText(tone: FailureTone): string {
  switch (tone) {
    case 'danger': return 'text-term-danger';
    case 'warn': return 'text-term-warn';
    default: return 'text-term-mint';
  }
}

/**
 * Progress of "now" toward the scheduled run time within the current hour.
 * Returns 0–1 so the MiniBar shows how close the job is to firing.
 * When the run is overdue (past) we return 1 (full bar).
 */
function progressToRun(nextRunAt: string): number {
  const runMs = new Date(nextRunAt).getTime();
  const nowMs = Date.now();
  if (isNaN(runMs)) return 0;
  if (nowMs >= runMs) return 1;
  // Progress within a 1-hour window ahead of now.
  const windowMs = 60 * 60_000;
  const remaining = runMs - nowMs;
  if (remaining >= windowMs) return 0;
  return 1 - remaining / windowMs;
}

export default function SchedulePanel() {
  const { withQuery } = useWorkspaceFilter();
  const url = withQuery(`/admin/next-runs?horizon_hours=${HORIZON_HOURS}`);
  const { data, error, loading } = useLive<NextRun[]>(url, POLL.list);
  const apiDown = !!error && !data;

  const [filter, setFilter] = useState('');

  const rows = useMemo(() => {
    const now = Date.now();
    const all = (data ?? [])
      .filter((r) => {
        const t = new Date(r.next_run_at).getTime();
        return !isNaN(t) && t >= now;
      })
      .sort(
        (a, b) =>
          new Date(a.next_run_at).getTime() - new Date(b.next_run_at).getTime(),
      );

    if (!filter.trim()) return all.slice(0, MAX_ROWS);

    const q = filter.toLowerCase();
    return all
      .filter(
        (r) =>
          r.platform.toLowerCase().includes(q) ||
          (r.accountHandle ?? '').toLowerCase().includes(q) ||
          r.product.toLowerCase().includes(q),
      )
      .slice(0, MAX_ROWS);
  }, [data, filter]);

  return (
    <div className="flex h-full flex-col gap-2 p-3 font-mono text-xs">
      <HeaderRow
        apiDown={apiDown}
        error={error}
        loading={loading && !data}
        total={data?.length ?? 0}
      />

      {!apiDown && (
        <>
          <TermInput
            placeholder="filter platform / handle / product"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter schedule rows"
          />

          <div className="flex flex-col gap-0.5 overflow-y-auto">
            {rows.length === 0 && !loading && (
              <span className="text-term-faint">
                {filter ? 'no matches' : 'nothing scheduled in the next 24h'}
              </span>
            )}
            {rows.map((r) => {
              const tone = failureTone(r.failure_count ?? 0);
              const prog = progressToRun(r.next_run_at);
              const handle = r.accountHandle ?? `#${r.accountId}`;
              return (
                <div
                  key={`${r.accountId}:${r.product}`}
                  className="grid grid-cols-[3.5rem_auto_1fr_2.5rem] items-center gap-x-1.5 border-b border-term-line/40 py-0.5 last:border-b-0"
                >
                  {/* Countdown */}
                  <span className={cn('tabular-nums', toneText(tone))}>
                    {fmtRelative(r.next_run_at)}
                  </span>

                  {/* Platform tag */}
                  <PlatformTag platform={r.platform} />

                  {/* Handle + product */}
                  <div className="min-w-0 flex flex-col">
                    <span className="truncate text-term-text">{handle}</span>
                    <span className="truncate text-[10px] text-term-faint">{r.product}</span>
                  </div>

                  {/* Progress bar toward run + failure badge */}
                  <div className="flex flex-col items-end gap-0.5">
                    <MiniBar
                      value={prog}
                      max={1}
                      tone={tone === 'mint' ? 'mint' : tone}
                      label={`Progress to ${fmtTime(r.next_run_at)}`}
                      className="w-full"
                    />
                    {(r.failure_count ?? 0) > 0 && (
                      <span className={cn('text-[9px] tabular-nums', toneText(tone))}>
                        {r.failure_count}f
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function HeaderRow({
  apiDown,
  error,
  loading,
  total,
}: {
  apiDown: boolean;
  error: string | null;
  loading: boolean;
  total: number;
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
  if (loading) {
    return (
      <div className="flex items-center gap-2 border-b border-term-line pb-2 text-term-faint">
        <span className="animate-term-blink text-term-mint">▮</span>
        connecting…
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 border-b border-term-line pb-2">
      <span aria-hidden="true" className="text-term-mint">●</span>
      <span className="uppercase tracking-[0.12em] text-term-mint">SCHEDULE</span>
      <span className="text-term-faint">· next 24h · {total} jobs</span>
    </div>
  );
}
