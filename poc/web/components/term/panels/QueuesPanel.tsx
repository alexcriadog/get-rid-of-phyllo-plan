import { useState } from 'react';
import { useLive, POLL } from '@/lib/useLive';
import { adminPost } from '@/lib/api';
import { MiniBar, type ChartTone } from '@/components/term/charts';
import ActionChip from '@/components/term/ActionChip';
import { cn } from '@/lib/utils';

/**
 * QueuesPanel — Phase 3 workbench panel (id: "queues").
 *
 * Ports the legacy `pages/admin/queues.tsx` into the Mint Terminal idiom.
 * Shows all BullMQ queue depths in a dense table: name, waiting/active/delayed/
 * failed counts. A MiniBar visualises total depth vs a sensible max. DLQ
 * (failed) rows render in danger tone when failed > 0. Retry-DLQ action chips
 * fire the same `/admin/queues/:name/retry-failed` mutation endpoint the legacy
 * page uses (confirmed via the queue-drain worker convention).
 *
 * Intentionally left out vs the legacy page:
 * – Completed counts (historical noise, wastes tile space)
 * – Paused counts (rarely non-zero in practice; re-add if needed)
 * – Card-grid layout (too spacious for a ~1/4-screen tile)
 *
 * Data: GET /admin/queues — global, no workspace filter needed (BullMQ queues
 * are shared infrastructure). Polled at POLL.live (3 s) — queue depths change
 * in real-time.
 */

type JobCounts = {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: number;
};

type QueueStats = Record<string, Partial<JobCounts>>;

const QUEUE_LABELS: Record<string, string> = {
  sync: 'SYNC',
  events: 'EVENTS',
  'sync-delivery': 'DELIVERY',
  delivery: 'DELIVERY',
};

/** Total "pending" depth for MiniBar — waiting + active + delayed + failed. */
function depth(counts: Partial<JobCounts>): number {
  return (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0) + (counts.failed ?? 0);
}

/** MiniBar max — 100 shows proportional fill for a healthy queue. */
const DEPTH_MAX = 100;

function depthTone(counts: Partial<JobCounts>): ChartTone {
  if ((counts.failed ?? 0) > 0) return 'danger';
  if ((counts.delayed ?? 0) > 10 || (counts.waiting ?? 0) > 50) return 'warn';
  return 'mint';
}

function countText(tone: ChartTone): string {
  switch (tone) {
    case 'danger': return 'text-term-danger';
    case 'warn': return 'text-term-warn';
    default: return 'text-term-mint';
  }
}

export default function QueuesPanel() {
  const queues = useLive<QueueStats>('/admin/queues', POLL.live);
  const data = queues.data ?? {};
  const names = Object.keys(data);
  const apiDown = !!queues.error && !queues.data;

  // Per-queue mutation state: undefined=idle, 'loading'=in-flight, string=error msg
  const [mutState, setMutState] = useState<Record<string, 'loading' | string>>({});

  const retryDlq = async (name: string) => {
    setMutState((s) => ({ ...s, [name]: 'loading' }));
    try {
      await adminPost(`/admin/queues/${name}/retry-failed`, {});
      setMutState((s) => {
        const next = { ...s };
        delete next[name];
        return next;
      });
      queues.refresh();
    } catch (e) {
      setMutState((s) => ({ ...s, [name]: (e as Error).message }));
    }
  };

  return (
    <div className="flex h-full flex-col gap-2 p-3 font-mono text-xs">
      {/* Header row */}
      <HeaderRow apiDown={apiDown} error={queues.error} loading={queues.loading && !queues.data} />

      {/* Queue rows */}
      {!apiDown && (
        <div className="flex flex-col gap-1.5 overflow-y-auto">
          {names.length === 0 && !queues.loading && (
            <span className="text-term-faint">no queue data</span>
          )}
          {names.map((name) => {
            const counts = data[name] ?? {};
            const label = QUEUE_LABELS[name] ?? name.toUpperCase();
            const d = depth(counts);
            const tone = depthTone(counts);
            const failed = counts.failed ?? 0;
            const mut = mutState[name];
            return (
              <div key={name} className="flex flex-col gap-1">
                {/* Name + bar + total */}
                <div className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-1.5">
                  <span className="truncate text-[10px] uppercase tracking-[0.12em] text-term-faint">
                    {label}
                  </span>
                  <MiniBar
                    value={d}
                    max={DEPTH_MAX}
                    tone={tone}
                    label={`${label} queue depth`}
                    className="w-full"
                  />
                  <span className={cn('text-right tabular-nums', countText(tone))}>
                    {d}
                  </span>
                </div>

                {/* Bucket detail: waiting / active / delayed / failed */}
                <div className="grid grid-cols-4 gap-1 pl-[4.5rem]">
                  <BucketCell label="W" value={counts.waiting ?? 0} tone="uv" />
                  <BucketCell label="A" value={counts.active ?? 0} tone="mint" highlight />
                  <BucketCell label="D" value={counts.delayed ?? 0} tone="warn" />
                  <BucketCell
                    label="F"
                    value={failed}
                    tone="danger"
                    highlight={failed > 0}
                  />
                </div>

                {/* DLQ row — retry chip + inline error */}
                {failed > 0 && (
                  <div className="flex items-center gap-2 pl-[4.5rem]">
                    <ActionChip
                      size="sm"
                      variant="destructive"
                      disabled={mut === 'loading'}
                      onClick={() => retryDlq(name)}
                      aria-label={`Retry DLQ for ${label}`}
                    >
                      {mut === 'loading' ? '…' : `↺ retry ${failed} failed`}
                    </ActionChip>
                    {mut && mut !== 'loading' && (
                      <span className="truncate text-term-danger">{mut}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HeaderRow({
  apiDown,
  error,
  loading,
}: {
  apiDown: boolean;
  error: string | null;
  loading: boolean;
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
      <span className="uppercase tracking-[0.12em] text-term-mint">QUEUES</span>
      <span className="text-term-faint">· bullmq · W/A/D/F</span>
    </div>
  );
}

function BucketCell({
  label,
  value,
  tone,
  highlight = false,
}: {
  label: string;
  value: number;
  tone: ChartTone;
  highlight?: boolean;
}) {
  const textClass = highlight && value > 0 ? countText(tone) : 'text-term-faint';
  return (
    <div className="flex items-baseline gap-0.5">
      <span className="text-[9px] uppercase text-term-faint/60">{label}</span>
      <span className={cn('tabular-nums', textClass)}>{value}</span>
    </div>
  );
}
