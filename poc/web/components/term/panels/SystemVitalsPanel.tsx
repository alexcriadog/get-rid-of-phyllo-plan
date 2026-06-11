import { useLive, POLL } from '@/lib/useLive';
import { MiniBar, type ChartTone } from '@/components/term/charts';
import { fmtRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The Phase 2 reference panel. Proves the workbench data path end-to-end:
 * a registered panel that self-fetches via the existing `useLive` polling
 * layer (no props, no wiring from the shell) and composes Phase 1 term
 * primitives. Mirrors the legacy `system-health` page payload but renders it
 * in the Mint Terminal idiom. Phase 3/4 panels follow this exact shape.
 *
 * Data: GET /admin/system/health (same endpoint that powers the status bar
 * health dot). Polled at the `config` cadence — health changes slowly.
 */
type StoreHealth = { ok: boolean; latency_ms: number | null; error?: string };

type SystemHealth = {
  mysql: StoreHealth;
  mongo: StoreHealth;
  redis: StoreHealth;
  worker: {
    last_attempt_at: string | null;
    idle_seconds: number | null;
    overdue_active_jobs?: number;
  };
  summary: 'ok' | 'warn' | 'danger';
};

const STORES: { key: 'mysql' | 'mongo' | 'redis'; label: string }[] = [
  { key: 'mysql', label: 'MYSQL' },
  { key: 'mongo', label: 'MONGO' },
  { key: 'redis', label: 'REDIS' },
];

// Latency scale for the MiniBar — 200ms is a generous full-width ceiling so
// healthy sub-20ms stores read as a thin sliver and a degraded store fills.
const LATENCY_MAX_MS = 200;

const SUMMARY_TONE: Record<SystemHealth['summary'], { dot: string; word: string }> = {
  ok: { dot: 'text-term-mint', word: 'OK' },
  warn: { dot: 'text-term-warn', word: 'WARN' },
  danger: { dot: 'text-term-danger', word: 'DEGRADED' },
};

function latencyTone(store: StoreHealth | undefined): ChartTone {
  if (!store || !store.ok || store.latency_ms == null) return 'danger';
  if (store.latency_ms >= 120) return 'warn';
  return 'mint';
}

export default function SystemVitalsPanel() {
  const health = useLive<SystemHealth>('/admin/system/health', POLL.config);
  const h = health.data;
  const apiDown = !!health.error && !h;

  return (
    <div className="flex h-full flex-col gap-3 p-3 font-mono text-xs">
      <SummaryRow health={h} apiDown={apiDown} error={health.error} />

      <div className="space-y-2">
        {STORES.map((s) => {
          const store = h?.[s.key];
          const tone = latencyTone(store);
          return (
            <div key={s.key} className="grid grid-cols-[4rem_1fr_4rem] items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.12em] text-term-faint">
                {s.label}
              </span>
              <MiniBar
                value={store?.ok && store.latency_ms != null ? store.latency_ms : LATENCY_MAX_MS}
                max={LATENCY_MAX_MS}
                tone={tone}
                label={`${s.label} latency`}
                className="w-full"
              />
              <span className={cn('text-right tabular-nums', toneText(tone))}>
                {store?.ok && store.latency_ms != null ? `${store.latency_ms}ms` : 'down'}
              </span>
            </div>
          );
        })}
      </div>

      <WorkerRow worker={h?.worker} />
    </div>
  );
}

function SummaryRow({
  health,
  apiDown,
  error,
}: {
  health: SystemHealth | null;
  apiDown: boolean;
  error: string | null;
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
  if (!health) {
    return (
      <div className="flex items-center gap-2 border-b border-term-line pb-2 text-term-faint">
        <span className="animate-term-blink text-term-mint">▮</span>
        connecting…
      </div>
    );
  }
  const tone = SUMMARY_TONE[health.summary] ?? SUMMARY_TONE.danger;
  return (
    <div className="flex items-center gap-2 border-b border-term-line pb-2">
      <span aria-hidden="true" className={tone.dot}>
        ●
      </span>
      <span className={cn('uppercase tracking-[0.12em]', tone.dot)}>{tone.word}</span>
      <span className="text-term-faint">· data stores + worker</span>
    </div>
  );
}

function WorkerRow({ worker }: { worker: SystemHealth['worker'] | undefined }) {
  const overdue = worker?.overdue_active_jobs ?? 0;
  return (
    <div className="mt-auto border-t border-term-line pt-2">
      <div className="grid grid-cols-[4rem_1fr] items-baseline gap-2">
        <span className="text-[10px] uppercase tracking-[0.12em] text-term-faint">WORKER</span>
        <span className="text-term-text">
          {worker?.last_attempt_at
            ? `last ${fmtRelative(worker.last_attempt_at)}`
            : 'no attempts'}
          {worker?.idle_seconds != null && (
            <span className="text-term-muted"> · idle {worker.idle_seconds}s</span>
          )}
        </span>
      </div>
      {overdue > 0 && (
        <div className="mt-1 text-term-danger">
          <span aria-hidden="true">▮ </span>
          {overdue} overdue active job(s) — not draining
        </div>
      )}
    </div>
  );
}

function toneText(tone: ChartTone): string {
  switch (tone) {
    case 'mint':
      return 'text-term-mint';
    case 'warn':
      return 'text-term-warn';
    case 'danger':
      return 'text-term-danger';
    default:
      return 'text-term-uv-tint';
  }
}
