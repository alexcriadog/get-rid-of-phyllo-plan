import { useLive, POLL } from '@/lib/useLive';
import { cn } from '@/lib/utils';

/**
 * Runtime Settings panel (id `runtime-settings`).
 *
 * Ports the legacy `/admin/settings` page into the Mint Terminal idiom. Renders
 * the effective operational configuration (worker, scheduler, retention) as
 * grouped key/value rows in mono. Values tagged `env` came from an explicit
 * environment variable override; `default` means the built-in fallback is in
 * effect. Secrets are never present in this endpoint — all values are numeric
 * or boolean knobs, rendered exactly as the legacy page shows them.
 * Read-only by design.
 *
 * Data: GET /admin/system/config
 * Polled at `config` cadence (15 s) — changes only on redeploys.
 */

type ResolvedNumber = {
  value: number;
  source: 'env' | 'default';
  env: string;
};

type SystemConfig = {
  worker: {
    concurrency: ResolvedNumber;
    engagement_lookback_days: ResolvedNumber;
  };
  scheduler: {
    tick_ms: ResolvedNumber;
    backpressure_max: ResolvedNumber;
  };
  retention: {
    inbound_log_days: ResolvedNumber;
    outbound_delivery_days: ResolvedNumber;
    api_call_log_days: ResolvedNumber;
    mongo_raw_days: ResolvedNumber;
    dry_run: boolean;
    schedule: string;
  };
};

const fmtDays = (n: number) => `${n}d`;
const fmtMs = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}s` : `${n}ms`;

export default function RuntimeSettingsPanel() {
  const cfg = useLive<SystemConfig>('/admin/system/config', POLL.config);
  const c = cfg.data;
  const apiDown = !!cfg.error && !c;

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-3 font-mono text-xs">
      <HeaderRow apiDown={apiDown} error={cfg.error} />

      {!apiDown && !c && (
        <div className="flex items-center gap-2 text-term-faint">
          <span className="animate-term-blink text-term-mint">▮</span>
          connecting…
        </div>
      )}

      {c && (
        <>
          <Group label="WORKER" icon="⬡">
            <KnobRow label="Concurrency" knob={c.worker.concurrency} />
            <KnobRow
              label="Engagement lookback"
              knob={c.worker.engagement_lookback_days}
              format={fmtDays}
            />
          </Group>

          <Group label="SCHEDULER" icon="◷">
            <KnobRow label="Tick interval" knob={c.scheduler.tick_ms} format={fmtMs} />
            <KnobRow label="Backpressure max" knob={c.scheduler.backpressure_max} />
          </Group>

          <Group label="RETENTION" icon="⌛">
            <RetentionModeRow dryRun={c.retention.dry_run} schedule={c.retention.schedule} />
            <KnobRow
              label="Inbound webhook log"
              knob={c.retention.inbound_log_days}
              format={fmtDays}
            />
            <KnobRow
              label="Outbound deliveries"
              knob={c.retention.outbound_delivery_days}
              format={fmtDays}
            />
            <KnobRow
              label="API call log"
              knob={c.retention.api_call_log_days}
              format={fmtDays}
            />
            <KnobRow
              label="Mongo raw responses"
              knob={c.retention.mongo_raw_days}
              format={fmtDays}
            />
          </Group>
        </>
      )}

      <div className="mt-auto border-t border-term-line pt-1.5 text-[10px] text-term-faint">
        read-only · to change: set env var + redeploy ·{' '}
        <span className="text-term-mint">env</span> = explicit override ·{' '}
        <span className="text-term-muted">default</span> = built-in fallback
      </div>
    </div>
  );
}

function HeaderRow({ apiDown, error }: { apiDown: boolean; error: string | null }) {
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
    <div className="flex items-center gap-2 border-b border-term-line pb-2">
      <span className="text-[10px] uppercase tracking-[0.12em] text-term-faint">
        RUNTIME SETTINGS
      </span>
    </div>
  );
}

function Group({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-term-line/60">
      <div className="border-b border-term-line/60 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-term-faint">
        {icon && <span className="mr-1.5">{icon}</span>}
        {label}
      </div>
      <div className="divide-y divide-term-line/40">{children}</div>
    </div>
  );
}

function KnobRow({
  label,
  knob,
  format,
}: {
  label: string;
  knob: ResolvedNumber;
  format?: (n: number) => string;
}) {
  const formatted = format ? format(knob.value) : String(knob.value);
  return (
    <div className="flex items-baseline justify-between gap-3 px-2 py-1.5">
      <div className="min-w-0">
        <span className="text-term-text">{label}</span>
        <span className="ml-2 text-[10px] text-term-faint">{knob.env}</span>
      </div>
      <div className="flex shrink-0 items-baseline gap-1.5 text-right">
        <span className="text-term-mint tabular-nums">{formatted}</span>
        <SourceTag source={knob.source} env={knob.env} />
      </div>
    </div>
  );
}

function RetentionModeRow({ dryRun, schedule }: { dryRun: boolean; schedule: string }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <span
        className={cn(
          'rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em]',
          dryRun
            ? 'border-term-warn/60 bg-term-warn/10 text-term-warn'
            : 'border-term-mint/60 bg-term-mint/10 text-term-mint',
        )}
      >
        {dryRun ? 'dry-run' : 'live'}
      </span>
      <span className="text-[10px] text-term-muted">{schedule}</span>
    </div>
  );
}

function SourceTag({ source, env }: { source: 'env' | 'default'; env: string }) {
  return (
    <span
      className={cn(
        'text-[10px] uppercase tracking-wider',
        source === 'env' ? 'text-term-mint' : 'text-term-faint',
      )}
      title={source === 'env' ? `Set via ${env}` : `Default (override with ${env})`}
    >
      {source}
    </span>
  );
}
