import { Cpu, Clock3, Trash2, Database } from 'lucide-react';
import { useLive, POLL } from '../../lib/useLive';
import AdminLayout from '../../components/AdminLayout';
import ScopeBadge from '../../components/ScopeBadge';
import { Section } from '@/components/admin/section';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Platform settings — the effective operational configuration the worker,
 * scheduler, and retention sweep resolve at runtime, read from
 * /admin/system/config. Read-only by design: these are process-level env
 * knobs, surfaced so an operator can see how the platform is tuned (and spot
 * a misconfiguration) without shelling into the containers. Each numeric
 * value shows whether it came from an explicit env override or the default.
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

function SourceTag({ source, env }: { source: 'env' | 'default'; env: string }) {
  return (
    <span
      className={cn(
        'font-mono text-[10px] uppercase tracking-wider',
        source === 'env' ? 'text-primary' : 'text-muted-foreground/70',
      )}
      title={source === 'env' ? `Set via ${env}` : `Default (override with ${env})`}
    >
      {source}
    </span>
  );
}

function Knob({
  label,
  knob,
  format,
}: {
  label: string;
  knob: ResolvedNumber;
  format?: (n: number) => string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5 last:border-0">
      <div className="min-w-0">
        <div className="text-sm text-foreground">{label}</div>
        <div className="font-mono text-[10.5px] text-muted-foreground/70">{knob.env}</div>
      </div>
      <div className="flex items-baseline gap-2 text-right">
        <span className="font-mono text-base font-semibold text-foreground">
          {format ? format(knob.value) : knob.value}
        </span>
        <SourceTag source={knob.source} env={knob.env} />
      </div>
    </div>
  );
}

const fmtDays = (n: number) => `${n}d`;
const fmtMsLabel = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}s` : `${n}ms`;

export default function SettingsPage() {
  const cfg = useLive<SystemConfig>('/admin/system/config', POLL.config);
  const c = cfg.data;

  return (
    <AdminLayout title="Platform settings">
      <ScopeBadge
        scope="global"
        reason="These are process-level env knobs that apply to the whole platform."
      />

      {cfg.error && !c && (
        <div className="mb-6 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          Unable to load configuration: {cfg.error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Section
          title={
            <span className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-muted-foreground" /> Worker
            </span>
          }
          description="Sync worker tuning"
          className="mb-0"
        >
          {c ? (
            <div>
              <Knob label="Concurrency" knob={c.worker.concurrency} />
              <Knob
                label="Engagement lookback"
                knob={c.worker.engagement_lookback_days}
                format={fmtDays}
              />
            </div>
          ) : (
            <Skeleton />
          )}
        </Section>

        <Section
          title={
            <span className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-muted-foreground" /> Scheduler
            </span>
          }
          description="Tick cadence + backpressure"
          className="mb-0"
        >
          {c ? (
            <div>
              <Knob label="Tick interval" knob={c.scheduler.tick_ms} format={fmtMsLabel} />
              <Knob label="Backpressure max" knob={c.scheduler.backpressure_max} />
            </div>
          ) : (
            <Skeleton />
          )}
        </Section>

        <Section
          title={
            <span className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-muted-foreground" /> Retention
            </span>
          }
          description="Data lifecycle windows"
          className="mb-0"
        >
          {c ? (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <Badge variant={c.retention.dry_run ? 'warn' : 'ok'}>
                  {c.retention.dry_run ? 'dry-run' : 'live'}
                </Badge>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {c.retention.schedule}
                </span>
              </div>
              <Knob label="Inbound webhook log" knob={c.retention.inbound_log_days} format={fmtDays} />
              <Knob label="Outbound deliveries" knob={c.retention.outbound_delivery_days} format={fmtDays} />
              <Knob label="API call log" knob={c.retention.api_call_log_days} format={fmtDays} />
              <Knob label="Mongo raw responses" knob={c.retention.mongo_raw_days} format={fmtDays} />
            </div>
          ) : (
            <Skeleton />
          )}
        </Section>
      </div>

      <Card className="mt-6">
        <CardContent className="flex items-start gap-3 p-4 text-xs text-muted-foreground">
          <Database className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Configuration is read-only here. To change a value, set the
            corresponding environment variable on the service and redeploy —
            the worker, scheduler, and retention sweep read these at boot.
            Values tagged <span className="font-mono text-primary">env</span> are
            explicit overrides; <span className="font-mono">default</span> means
            the built-in fallback is in effect.
          </p>
        </CardContent>
      </Card>
    </AdminLayout>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2.5">
      {[0, 1].map((i) => (
        <div key={i} className="h-8 animate-pulse rounded bg-secondary/60" />
      ))}
    </div>
  );
}
