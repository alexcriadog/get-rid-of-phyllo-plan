import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/AdminLayout';
import { useLive } from '../../lib/useLive';
import { useWorkspaceFilter } from '../../lib/workspace-context';
import { adminPost, CONNECTOR_API_URL } from '../../lib/api';
import { fmtRelative, fmtTime } from '../../lib/format';
import { Timeline, STATUS_COLORS } from '../../components/charts';
import { Section } from '@/components/admin/section';
import { Empty } from '@/components/admin/empty';
import { Button } from '@/components/ui/button';
import { ConnectionFlowBadge } from '@/components/account/ConnectionFlowBadge';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

type NextRun = {
  /** sync_job id — used for /admin/sync-jobs/:id/{risk-check,reenqueue}. */
  id?: string;
  accountId: string;
  accountHandle?: string | null;
  platform: string;
  connection_flow?: string | null;
  product: string;
  next_run_at: string;
  status?: string;
  failure_count?: number;
  last_success_at?: string | null;
};

type RiskSeverity = 'ok' | 'warn' | 'block';

type RiskSignal = {
  key: string;
  severity: RiskSeverity;
  message: string;
  value?: string | number;
};

type RiskCheckResponse = {
  sync_job: {
    id: string;
    account_id: string;
    account_handle: string | null;
    platform: string;
    product: string;
    status: string;
    next_run_at: string | null;
    last_success_at: string | null;
    failure_count: number;
  };
  severity: RiskSeverity;
  signals: RiskSignal[];
};

const TAB_HOURS: Record<string, number> = {
  '6h': 6,
  '24h': 24,
  '72h': 72,
};

/**
 * One color per product so the timeline rows (one per cuenta) read at a glance
 * which marker corresponds to which sync product. Only used when an event is
 * `info`/healthy — failing events keep the warn/danger palette so red is
 * always "something is wrong".
 */
const PRODUCT_COLOR: Record<string, string> = {
  identity: '#6dd3ff',
  audience: '#bd9eff',
  engagement_new: '#3cffd0',
  stories: '#ffd166',
  comments: '#ff9aa2',
  mentions: '#f6b46e',
  default: '#9aa0aa',
};

/**
 * Two-step modal that lets the operator schedule an immediate run of a
 * sync_job after reading a risk report. Step 1 reviews the target; step 2
 * loads /admin/sync-jobs/:id/risk-check and decides whether to allow,
 * warn, or block the manual enqueue.
 *
 * Cadence note shown on step 1: when the worker finishes a manual run, it
 * recomputes nextRunAt = now + cadence ± jitter. So a manual "run now" of
 * an engagement_new (cadence 2h) shifts the *next* automatic run to "2h
 * from now" — it doesn't duplicate work.
 */
function RunNowDialog({
  job,
  onClose,
  onSubmitted,
}: {
  job: NextRun;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [risk, setRisk] = useState<RiskCheckResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Step 2 entry point: fetch risk-check from the admin API.
  useEffect(() => {
    if (step !== 2 || !job.id) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(`${CONNECTOR_API_URL}/admin/sync-jobs/${job.id}/risk-check`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<RiskCheckResponse>;
      })
      .then((body) => {
        if (!cancelled) setRisk(body);
      })
      .catch((e) => {
        if (!cancelled) setErr((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, job.id]);

  // Lock body scroll + ESC-to-close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const submit = async () => {
    if (!job.id) return;
    setSubmitting(true);
    setErr(null);
    try {
      await adminPost(`/admin/sync-jobs/${job.id}/reenqueue`, {});
      onSubmitted();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-lg border border-border bg-card text-card-foreground shadow-xl"
        style={{ width: 'min(560px, 100%)', maxHeight: '90vh', overflow: 'auto' }}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Run now · step {step} of 2
            </span>
            <StepDot active={step === 1} />
            <StepDot active={step === 2} />
          </div>
          <button
            onClick={onClose}
            className="font-mono text-[11px] text-muted-foreground hover:text-foreground"
          >
            close · esc
          </button>
        </div>

        {step === 1 && (
          <div className="flex flex-col gap-4 px-5 py-5">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Target
              </div>
              <div className="mt-1 flex items-baseline gap-2 font-mono text-sm">
                <span>{job.accountHandle ?? `#${job.accountId}`}</span>
                <span className="text-muted-foreground">({job.platform})</span>
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                product: <span className="text-foreground">{job.product}</span>
                {' · '}
                sync_job: <span className="text-foreground">#{job.id}</span>
              </div>
            </div>
            <DialogRow
              label="Currently scheduled"
              value={
                job.next_run_at
                  ? `${fmtTime(job.next_run_at)} · ${fmtRelative(job.next_run_at)}`
                  : '—'
              }
            />
            <DialogRow
              label="Last success"
              value={
                job.last_success_at
                  ? `${fmtTime(job.last_success_at)} · ${fmtRelative(job.last_success_at)}`
                  : 'never'
              }
            />
            <DialogRow
              label="Status"
              value={`${job.status ?? 'idle'} · ${job.failure_count ?? 0} consecutive fails`}
            />
            <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
              ⓘ Running now resets the cadence clock. The worker recomputes{' '}
              <code>nextRunAt = now + cadence ± jitter</code> on success — so
              the next automatic run shifts to ~one cadence from now, not
              duplicated. Throttle lock (10 min post-success) prevents back-to-back
              fetches even if the queue replays.
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => setStep(2)}>Continue · check risk</Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4 px-5 py-5">
            {loading && (
              <div className="font-mono text-xs text-muted-foreground">
                Checking risk signals…
              </div>
            )}
            {err && (
              <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 font-mono text-xs text-danger">
                {err}
              </div>
            )}
            {risk && (
              <>
                <RiskHeader severity={risk.severity} />
                <div className="flex flex-col gap-2">
                  {risk.signals.map((s) => (
                    <RiskSignalRow key={s.key} signal={s} />
                  ))}
                </div>
              </>
            )}
            <div className="flex justify-between gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                ← Back
              </Button>
              {risk && (
                <RiskConfirmButton
                  severity={risk.severity}
                  submitting={submitting}
                  onConfirm={submit}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepDot({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: 999,
        background: active ? 'var(--mint, #3cffd0)' : 'rgba(255,255,255,0.18)',
      }}
    />
  );
}

function DialogRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 font-mono text-xs">
      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className="text-right text-foreground">{value}</span>
    </div>
  );
}

function RiskHeader({ severity }: { severity: RiskSeverity }) {
  const text =
    severity === 'block'
      ? 'Blocked — fix the issues below before running.'
      : severity === 'warn'
        ? 'Risky — review before confirming.'
        : 'All clear — safe to run.';
  const palette =
    severity === 'block'
      ? 'border-danger/40 bg-danger/10 text-danger'
      : severity === 'warn'
        ? 'border-warn/40 bg-warn/10 text-warn'
        : 'border-ok/40 bg-ok/10 text-ok';
  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em]',
        palette,
      )}
    >
      {text}
    </div>
  );
}

function RiskSignalRow({ signal }: { signal: RiskSignal }) {
  const palette =
    signal.severity === 'block'
      ? 'border-danger/40 bg-danger/5'
      : signal.severity === 'warn'
        ? 'border-warn/40 bg-warn/5'
        : 'border-ok/40 bg-ok/5';
  const icon =
    signal.severity === 'block' ? '⛔' : signal.severity === 'warn' ? '⚠' : '✓';
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 font-mono text-[11px] leading-relaxed',
        palette,
      )}
    >
      <span className="text-[13px]">{icon}</span>
      <div className="flex-1">
        <div className="text-foreground">{signal.message}</div>
        <div className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground/70">
          {signal.key}
          {signal.value !== undefined && ` · value=${signal.value}`}
        </div>
      </div>
    </div>
  );
}

function RiskConfirmButton({
  severity,
  submitting,
  onConfirm,
}: {
  severity: RiskSeverity;
  submitting: boolean;
  onConfirm: () => void;
}) {
  if (severity === 'block') {
    return (
      <Button disabled title="One or more blocking signals — resolve first.">
        Blocked
      </Button>
    );
  }
  return (
    <Button
      onClick={onConfirm}
      disabled={submitting}
      variant={severity === 'warn' ? 'destructive' : 'default'}
    >
      {submitting
        ? 'Enqueuing…'
        : severity === 'warn'
          ? 'Confirm despite risk'
          : 'Run now'}
    </Button>
  );
}

function visibleProducts(rows: NextRun[]): string[] {
  const set = new Set<string>();
  for (const r of rows) set.add(r.product);
  return Array.from(set).sort();
}

function ProductLegend({ products }: { products: string[] }) {
  if (products.length === 0) return null;
  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[10px] text-muted-foreground"
      aria-label="Timeline color legend"
    >
      <span className="uppercase tracking-[0.16em] text-muted-foreground/70">
        legend
      </span>
      {products.map((p) => (
        <span key={p} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: 2,
              background: PRODUCT_COLOR[p] ?? PRODUCT_COLOR.default,
            }}
          />
          {p}
        </span>
      ))}
      <span className="ml-2 inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: 2,
            background: 'var(--warn, #f6b46e)',
          }}
        />
        failing (1+ fails)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: 2,
            background: 'var(--danger, #ff5c69)',
          }}
        />
        broken (3+ fails)
      </span>
    </div>
  );
}

export default function NextRunsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'6h' | '24h' | '72h'>('24h');
  const horizonHours = TAB_HOURS[tab] ?? 24;
  const [runNowJob, setRunNowJob] = useState<NextRun | null>(null);

  const { withQuery } = useWorkspaceFilter();
  const { data, error, refresh } = useLive<NextRun[]>(
    withQuery(`/admin/next-runs?horizon_hours=${horizonHours}`),
    8000,
  );

  // Optional `?account=<id>` filter — when set (e.g. arriving from
  // /admin/accounts → "Refresh now"), restrict the page to a single
  // account so the operator only sees that account's sync_jobs.
  const accountFilter =
    typeof router.query.account === 'string' ? router.query.account : null;
  const rows = (data ?? []).filter(
    (r) => !accountFilter || String(r.accountId) === accountFilter,
  );

  const { timelineRows, timelineEvents, startMs, endMs } = useMemo(() => {
    const now = Date.now();
    const start = now;
    const end = now + horizonHours * 3600_000;
    // Group BY ACCOUNT (not by account+product) so 5 cuentas × 4 productos
    // render como 5 filas con 4 marcadores cada una, no como 20 filas casi
    // vacías. Color codes the product; tooltip + tone code health.
    const rowMap = new Map<
      string,
      { id: string; label: string; platform: string }
    >();
    const events: Array<{
      rowId: string;
      startMs: number;
      endMs: number;
      tone: 'ok' | 'warn' | 'danger' | 'info';
      color?: string;
      title: string;
      meta: Array<{ label: string; value: string }>;
    }> = [];

    for (const r of rows) {
      const t = new Date(r.next_run_at).getTime();
      if (isNaN(t) || t < start || t > end) continue;
      const rowId = String(r.accountId);
      const label = r.accountHandle ?? `#${r.accountId}`;
      if (!rowMap.has(rowId)) {
        rowMap.set(rowId, { id: rowId, label, platform: r.platform });
      }
      const tone: 'ok' | 'warn' | 'danger' | 'info' =
        (r.failure_count ?? 0) >= 3
          ? 'danger'
          : (r.failure_count ?? 0) > 0
            ? 'warn'
            : 'info';
      events.push({
        rowId,
        startMs: t,
        // Slightly wider bar for longer horizons so 72h doesn't show 1px ticks.
        endMs: t + Math.max(4 * 60_000, (horizonHours * 3600_000) / 200),
        tone,
        color:
          tone === 'info'
            ? PRODUCT_COLOR[r.product] ?? PRODUCT_COLOR.default
            : undefined,
        title: `${r.product} · ${label}`,
        meta: [
          { label: 'platform', value: r.platform },
          { label: 'product', value: r.product },
          { label: 'fires', value: fmtTime(r.next_run_at) ?? '—' },
          { label: 'in', value: fmtRelative(r.next_run_at) ?? '—' },
          { label: 'status', value: r.status ?? 'idle' },
          { label: 'fails', value: String(r.failure_count ?? 0) },
        ],
      });
    }
    return {
      timelineRows: Array.from(rowMap.values())
        .map((r) => ({
          id: r.id,
          label: `${r.label} · ${r.platform}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      timelineEvents: events,
      startMs: start,
      endMs: end,
    };
  }, [rows, horizonHours]);

  const upcomingNext10 = useMemo(
    () =>
      [...rows]
        .filter(
          (r) =>
            r.next_run_at && new Date(r.next_run_at).getTime() >= Date.now(),
        )
        .sort(
          (a, b) =>
            new Date(a.next_run_at).getTime() -
            new Date(b.next_run_at).getTime(),
        )
        .slice(0, 10),
    [rows],
  );

  return (
    <AdminLayout title="Next runs">
      {error && !data && (
        <div className="mb-5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as '6h' | '24h' | '72h')}
        className="w-full"
      >
        <TabsList>
          <TabsTrigger value="6h">Next 6h</TabsTrigger>
          <TabsTrigger value="24h">Next 24h</TabsTrigger>
          <TabsTrigger value="72h">Next 72h</TabsTrigger>
        </TabsList>

        <TabsContent value={tab}>
          <Section
            title={`Schedule timeline · next ${horizonHours}h`}
            description="One row per cuenta, one marker per scheduled product run. Color codes the product; red/amber means failing."
          >
            <Timeline
              rows={timelineRows}
              events={timelineEvents}
              startMs={startMs}
              endMs={endMs}
              hourTickEvery={
                horizonHours <= 12 ? 1 : horizonHours <= 24 ? 2 : 6
              }
            />
            <ProductLegend products={visibleProducts(rows)} />
          </Section>

          <Section title="Up next" description="The 10 closest scheduled runs">
            {upcomingNext10.length === 0 ? (
              <Empty message="Nothing scheduled in this window." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Fails</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcomingNext10.map((r) => {
                    const tone: 'ok' | 'warn' | 'danger' =
                      (r.failure_count ?? 0) >= 3
                        ? 'danger'
                        : (r.failure_count ?? 0) > 0
                          ? 'warn'
                          : 'ok';
                    return (
                      <TableRow
                        key={`${r.accountId}:${r.product}`}
                        className="font-mono text-xs"
                      >
                        <TableCell>
                          <div style={{ color: STATUS_COLORS[tone] }}>
                            {fmtRelative(r.next_run_at)}
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {fmtTime(r.next_run_at)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <span>{r.accountHandle ?? `#${r.accountId}`}</span>
                            <ConnectionFlowBadge flow={r.connection_flow} />
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {r.platform} · #{r.accountId}
                          </div>
                        </TableCell>
                        <TableCell>{r.product}</TableCell>
                        <TableCell
                          className={cn(
                            'text-right',
                            (r.failure_count ?? 0) > 0
                              ? 'text-danger'
                              : 'text-muted-foreground',
                          )}
                        >
                          {r.failure_count ?? 0}
                        </TableCell>
                        <TableCell className="text-right">
                          {r.id ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setRunNowJob(r)}
                            >
                              ▶ Run now
                            </Button>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Section>
        </TabsContent>
      </Tabs>

      {runNowJob && runNowJob.id && (
        <RunNowDialog
          job={runNowJob}
          onClose={() => setRunNowJob(null)}
          onSubmitted={() => {
            setRunNowJob(null);
            refresh();
          }}
        />
      )}
    </AdminLayout>
  );
}
