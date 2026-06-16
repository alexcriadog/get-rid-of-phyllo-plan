import { useMemo } from 'react';
import { POLL } from '@/lib/useLive';
import { useScopedLive } from '@/lib/workspace-context';
import StatBlock from '@/components/term/StatBlock';
import { Sparkline } from '@/components/term/charts';

/**
 * Phase 3 workbench panel: "KPI Stats"
 *
 * Extracts the five headline KPI cards from `pages/admin/index.tsx` and
 * renders them in the Mint Terminal idiom using the StatBlock primitive. Also
 * renders a Sparkline of per-minute API throughput over the last 60 minutes,
 * derived from the same `/admin/api-calls` payload the legacy page uses.
 *
 * Data:
 *   GET /admin/overview          → Overview (accounts_total, dlq_depth, …)
 *   GET /admin/api-calls?limit=500 → ApiCall[]
 *
 * KPIs shown (mirrors the legacy KpiCard grid):
 *   1. Accounts total
 *   2. Success rate (%)  — excludes "expected" non-2xx
 *   3. Errors / 1 h      — non-expected 4xx/5xx in last 60 min
 *   4. Calls / 1 h       — all calls in last 60 min
 *   5. DLQ depth         — from /admin/overview
 *
 * Sparkline: 2xx call counts per minute over the last 60 minutes.
 *
 * Panel id: `kpi-stats`
 */

// ── Types ─────────────────────────────────────────────────────────────────

type Overview = {
  accounts_total?: number;
  accounts_by_platform?: Record<string, number>;
  dlq_depth?: number;
};

type ApiCall = {
  called_at?: string;
  status_code?: number;
  expected?: boolean;
};

// ── Aggregation helpers (extracted from legacy page) ──────────────────────

const HOUR_MS = 3_600_000;
const WINDOW_MIN = 60;

function successRate(calls: ApiCall[]): string {
  const real = calls.filter((c) => !c.expected);
  if (!real.length) return '—';
  const ok = real.filter(
    (c) => typeof c.status_code === 'number' && c.status_code >= 200 && c.status_code < 300,
  ).length;
  return `${((ok / real.length) * 100).toFixed(0)}%`;
}

function errorsLastHour(calls: ApiCall[]): number {
  const cutoff = Date.now() - HOUR_MS;
  return calls.filter((c) => {
    if (c.expected) return false;
    if (!c.called_at) return false;
    if (new Date(c.called_at).getTime() < cutoff) return false;
    return typeof c.status_code === 'number' && c.status_code >= 400;
  }).length;
}

function callsLastHour(calls: ApiCall[]): number {
  const cutoff = Date.now() - HOUR_MS;
  return calls.filter(
    (c) => c.called_at && new Date(c.called_at).getTime() >= cutoff,
  ).length;
}

/**
 * Build a 60-element array of 2xx call counts, one per minute from oldest to
 * now. Used as the Sparkline data series.
 */
function buildSparklinePoints(calls: ApiCall[]): number[] {
  const now = Date.now();
  const start = now - WINDOW_MIN * 60_000;
  const buckets = new Array<number>(WINDOW_MIN).fill(0);
  for (const c of calls) {
    if (!c.called_at) continue;
    const t = new Date(c.called_at).getTime();
    if (isNaN(t) || t < start || t > now) continue;
    const sc = c.status_code ?? 0;
    if (sc < 200 || sc >= 300) continue;
    const idx = Math.floor((t - start) / 60_000);
    if (idx >= 0 && idx < WINDOW_MIN) buckets[idx] += 1;
  }
  return buckets;
}

/**
 * Map success rate % to a delta tone (up/flat/down) for the StatBlock delta.
 * No previous-period data is available from this endpoint, so this reflects
 * absolute health level rather than a true trend.
 */
function successTone(rateStr: string): 'up' | 'down' | 'flat' {
  if (rateStr === '—') return 'flat';
  const n = parseInt(rateStr, 10);
  if (isNaN(n)) return 'flat';
  if (n >= 95) return 'up';
  if (n >= 80) return 'flat';
  return 'down';
}

// ── Panel ─────────────────────────────────────────────────────────────────

export default function KpiStatsPanel() {
  const overviewLive = useScopedLive<Overview>('/admin/overview', POLL.live);
  const callsLive = useScopedLive<ApiCall[]>(
    '/admin/api-calls?limit=500',
    POLL.live,
  );

  const apiDown =
    !!overviewLive.error && !overviewLive.data &&
    !!callsLive.error && !callsLive.data;

  const loading = overviewLive.loading && !overviewLive.data;

  if (apiDown) {
    return (
      <div className="flex h-full flex-col gap-3 p-3 font-mono text-xs">
        <div className="flex items-center gap-2 border-b border-term-line pb-2 text-term-danger">
          <span aria-hidden="true">●</span>
          <span className="uppercase tracking-[0.12em]">API UNREACHABLE</span>
          {(overviewLive.error || callsLive.error) && (
            <span className="truncate text-term-faint">
              {overviewLive.error ?? callsLive.error}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-3 p-3 font-mono text-xs">
        <div className="flex items-center gap-2 border-b border-term-line pb-2 text-term-faint">
          <span className="animate-term-blink text-term-mint">▮</span>
          connecting…
        </div>
      </div>
    );
  }

  const allCalls = callsLive.data ?? [];
  const overview = overviewLive.data;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rateStr = useMemo(() => successRate(allCalls), [allCalls]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const errCount = useMemo(() => errorsLastHour(allCalls), [allCalls]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const callCount = useMemo(() => callsLastHour(allCalls), [allCalls]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sparkPoints = useMemo(() => buildSparklinePoints(allCalls), [allCalls]);

  const dlqDepth = overview?.dlq_depth ?? 0;
  const accountsTotal = overview?.accounts_total;

  const platformSub = overview?.accounts_by_platform
    ? Object.entries(overview.accounts_by_platform)
        .map(([p, n]) => `${p} ${n}`)
        .join(' · ')
    : undefined;

  return (
    <div className="flex h-full flex-col gap-3 p-3 font-mono text-xs">
      {/* Section label */}
      <div className="border-b border-term-line pb-2 uppercase tracking-[0.12em] text-term-faint">
        KPI · LIVE
      </div>

      {/* Stat grid — 2 columns */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        <StatBlock
          label="Accounts"
          value={accountsTotal ?? '—'}
          sub={platformSub}
        />

        <StatBlock
          label="Success rate"
          value={rateStr}
          delta={
            rateStr !== '—'
              ? { text: rateStr, tone: successTone(rateStr) }
              : undefined
          }
        />

        <StatBlock
          label="Errors / 1h"
          value={errCount}
          delta={
            errCount === 0
              ? { text: 'none', tone: 'up' }
              : errCount < 5
                ? { text: `${errCount} warn`, tone: 'flat' }
                : { text: `${errCount} high`, tone: 'down' }
          }
        />

        <StatBlock
          label="Calls / 1h"
          value={callCount}
        />

        <StatBlock
          label="DLQ depth"
          value={dlqDepth}
          delta={
            dlqDepth === 0
              ? { text: 'clear', tone: 'up' }
              : { text: `${dlqDepth} stuck`, tone: 'down' }
          }
        />
      </div>

      {/* Throughput sparkline — 2xx calls/min over last 60 min */}
      <div className="mt-auto border-t border-term-line pt-2">
        <div className="mb-1 text-[10px] uppercase tracking-[0.1em] text-term-faint">
          2xx / min · last 60 min
        </div>
        <Sparkline points={sparkPoints} tone="mint" height={24} />
      </div>
    </div>
  );
}
