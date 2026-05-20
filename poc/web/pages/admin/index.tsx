import { useMemo, useState } from 'react';
import { Activity, AlertCircle, AlertTriangle, CheckCircle2, Inbox, Users } from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { useLive } from '../../lib/useLive';
import { useWorkspaceFilter } from '../../lib/workspace-context';
import { fmtMs, fmtTime, fmtRelative } from '../../lib/format';
import {
  LineChart,
  Donut,
  Heatmap,
  HBarChart,
  Gauge,
  STATUS_COLORS,
  compactNumber,
  pickStatusTone,
} from '../../components/charts';
import { Section } from '@/components/admin/section';
import { KpiCard } from '@/components/admin/kpi-card';
import { Empty } from '@/components/admin/empty';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────

type Overview = {
  accounts_total?: number;
  accounts_by_platform?: Record<string, number>;
  syncs_last_hour?: number;
  webhooks_last_hour?: number;
  dlq_depth?: number;
  platforms?: Array<{
    platform: string;
    buckets_active?: number;
    last_api_call_at?: string;
  }>;
};

type Bucket = {
  key: string;
  platform: string;
  scope?: string;
  tokens: number;
  capacity: number;
  hits?: number;
  denies?: number;
};

type ProductFreshness = {
  product: string;
  last_success_at?: string | null;
  next_run_at?: string | null;
  failure_count?: number;
  freshness?: 'green' | 'yellow' | 'red';
  status?: string;
  last_error?: string | null;
};

type AdminAccount = {
  id: string;
  platform: string;
  handle?: string | null;
  status: string;
  sync_tier: string;
  products: ProductFreshness[];
};

type ApiCall = {
  id?: number | string;
  called_at?: string;
  platform?: string;
  endpoint?: string;
  status_code?: number;
  duration_ms?: number;
  account_id?: string | null;
  account_handle?: string | null;
  /**
   * True when the platform's non-2xx is a documented "no data" outcome
   * (e.g. Meta IG privacy threshold). Excluded from error-rate cards
   * but still listed in the raw call view.
   */
  expected?: boolean;
};

const PRODUCTS = ['identity', 'audience', 'engagement_new', 'stories'];
const WINDOW_MIN = 60;

// ── Page ───────────────────────────────────────────────────────────────────

export default function AdminOverview() {
  const { withQuery } = useWorkspaceFilter();
  const overviewLive = useLive<Overview>(withQuery('/admin/overview'), 3000);
  const bucketsLive = useLive<Bucket[]>(withQuery('/admin/rate-buckets'), 3000);
  const accountsLive = useLive<AdminAccount[]>(withQuery('/admin/accounts'), 5000);
  const callsLive = useLive<ApiCall[]>(
    withQuery('/admin/api-calls?limit=500'),
    3000,
  );

  const allCalls = callsLive.data ?? [];
  const overview = overviewLive.data;
  const accounts = accountsLive.data ?? [];
  const buckets = bucketsLive.data ?? [];

  const successRateStr = useMemo(() => successRate(allCalls), [allCalls]);
  const errorsCount = useMemo(() => errorsLastHour(allCalls), [allCalls]);
  const totals = useMemo(() => bucketTotals(allCalls), [allCalls]);
  const healthMix = useMemo(() => buildHealthMix(accounts), [accounts]);
  const topErrors = useMemo(() => buildTopErrors(allCalls), [allCalls]);
  const topEndpoints = useMemo(() => buildTopEndpoints(allCalls), [allCalls]);
  const heatmap = useMemo(() => buildHeatmap(allCalls, accounts), [allCalls, accounts]);
  const throughputSeries = useMemo(() => buildThroughputSeries(allCalls), [allCalls]);
  const callsPerHour = useMemo(() => Math.round(throughputThisHour(allCalls)), [allCalls]);

  return (
    <AdminLayout title="Overview">
      {overviewLive.error && !overview && (
        <div className="mb-5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          Admin API error: {overviewLive.error}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label="Accounts"
          value={overview?.accounts_total ?? '—'}
          tone="primary"
          icon={<Users className="h-4 w-4" />}
          sublabel={
            overview?.accounts_by_platform
              ? Object.entries(overview.accounts_by_platform)
                  .map(([p, n]) => `${p} ${n}`)
                  .join(' · ')
              : ''
          }
        />
        <KpiCard
          label="Success rate"
          value={successRateStr}
          tone={
            parseSuccess(successRateStr) >= 95
              ? 'ok'
              : parseSuccess(successRateStr) >= 80
                ? 'warn'
                : 'danger'
          }
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <KpiCard
          label="Errors / 1h"
          value={errorsCount}
          tone={errorsCount === 0 ? 'ok' : errorsCount < 5 ? 'warn' : 'danger'}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <KpiCard
          label="Calls / 1h"
          value={compactNumber(callsPerHour)}
          tone="info"
          icon={<Activity className="h-4 w-4" />}
          sublabel={`2xx ${totals.ok} · 4xx ${totals.warn} · 5xx ${totals.err}`}
        />
        <KpiCard
          label="DLQ depth"
          value={overview?.dlq_depth ?? 0}
          tone={(overview?.dlq_depth ?? 0) === 0 ? 'ok' : 'danger'}
          icon={<Inbox className="h-4 w-4" />}
        />
      </div>

      <Tabs defaultValue="live" className="w-full">
        <TabsList>
          <TabsTrigger value="live">Live</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="capacity">Capacity</TabsTrigger>
        </TabsList>

        <TabsContent value="live">
          <Section
            title={`API throughput · last ${WINDOW_MIN} min`}
            description="Calls grouped per minute by status class. Hover for per-class counts."
          >
            <LineChart
              series={throughputSeries}
              height={220}
              area
              stacked
              xLabels={{
                left: `-${WINDOW_MIN}m`,
                mid: `-${Math.round(WINDOW_MIN / 2)}m`,
                right: 'now',
              }}
              emptyMessage="No API calls in window. Start the worker."
            />
          </Section>

          <Section
            title="Live API calls"
            description={`Most recent ${Math.min(80, allCalls.length)} of ${allCalls.length} calls`}
          >
            <CallsTicker calls={allCalls} accounts={accounts} />
          </Section>
        </TabsContent>

        <TabsContent value="health">
          <div className="mb-5 grid gap-5 lg:grid-cols-3">
            <Section
              title="Freshness matrix"
              description="Account × product · click an account to drill down"
              className="mb-0 lg:col-span-2"
            >
              {accounts.length > 0 ? (
                <FreshnessMatrix accounts={accounts} />
              ) : (
                <Empty message="No accounts." icon={<Users className="h-5 w-5" />} />
              )}
              <div className="mt-4 flex flex-wrap gap-4 font-mono text-[10.5px]">
                <LegendDot color={STATUS_COLORS.ok} label="fresh" />
                <LegendDot color={STATUS_COLORS.warn} label="stale" />
                <LegendDot color={STATUS_COLORS.danger} label="failing / never" />
                <LegendDot color={STATUS_COLORS.muted} label="paused" />
              </div>
            </Section>

            <Section title="Health mix" description="Hover slice or legend" className="mb-0">
              <Donut
                slices={healthMix}
                size={170}
                centerLabel="Products"
                emptyMessage="No data."
              />
            </Section>
          </div>

          <Section
            title="Top errors · last 24h"
            description="Grouped by status code + endpoint"
          >
            <HBarChart items={topErrors} showPct emptyMessage="No errors recorded." />
          </Section>
        </TabsContent>

        <TabsContent value="activity">
          <Section
            title="Activity heatmap"
            description="Calls per account × hour over the last 24h. Darker = busier."
          >
            <Heatmap
              rows={heatmap.rows}
              cols={heatmap.cols}
              cells={heatmap.cells}
              unitLabel="calls"
              cellSize={20}
              emptyMessage="No calls in the last 24h."
            />
          </Section>

          <Section
            title="Top endpoints · last 24h"
            description="Ranked by call volume"
          >
            <HBarChart items={topEndpoints} showPct emptyMessage="No traffic." />
          </Section>
        </TabsContent>

        <TabsContent value="capacity">
          <Section
            title="Rate buckets"
            description="Tokens remaining vs capacity. Auto-tone by fill ratio."
          >
            {buckets.length === 0 ? (
              <Empty
                message="No buckets yet — buckets register on first API call."
                icon={<AlertCircle className="h-5 w-5" />}
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {buckets.map((b) => (
                  <BucketCard key={b.key} bucket={b} />
                ))}
              </div>
            )}
          </Section>
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-2 rounded-sm"
        style={{ background: color }}
      />
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function FreshnessMatrix({ accounts }: { accounts: AdminAccount[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="pb-3 text-left text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              Account
            </th>
            {PRODUCTS.map((p) => (
              <th
                key={p}
                className="pb-3 text-center text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {p.replace('_', ' ')}
              </th>
            ))}
            <th className="pb-3 text-right text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              Tier
            </th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => {
            const paused = a.sync_tier === 'paused' || a.status === 'paused';
            return (
              <tr key={a.id} className="border-t border-border">
                <td className="py-2.5">
                  <div
                    className={cn(
                      'font-mono text-xs',
                      paused ? 'text-muted-foreground' : 'text-foreground',
                    )}
                  >
                    {a.handle || `Account ${a.id}`}
                  </div>
                  <div className="text-[10px] text-muted-foreground/70">
                    {a.platform} · {a.status}
                  </div>
                </td>
                {PRODUCTS.map((prod) => {
                  const p = a.products?.find((x) => x.product === prod);
                  return (
                    <td key={prod} className="py-2.5 text-center">
                      <FreshnessCell product={p} paused={paused} />
                    </td>
                  );
                })}
                <td className="text-right">
                  <Badge variant={paused ? 'danger' : 'ok'}>{a.sync_tier}</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FreshnessCell({
  product,
  paused,
}: {
  product: ProductFreshness | undefined;
  paused: boolean;
}) {
  if (!product) return <span className="text-muted-foreground/60">—</span>;

  let color: string = STATUS_COLORS.muted;
  let label = 'n/a';
  if (paused) {
    color = STATUS_COLORS.muted;
    label = 'paused';
  } else if ((product.failure_count ?? 0) >= 3) {
    color = STATUS_COLORS.danger;
    label = `${product.failure_count} fails`;
  } else if (product.freshness === 'green') {
    color = STATUS_COLORS.ok;
    label = fmtRelative(product.last_success_at);
  } else if (product.freshness === 'yellow') {
    color = STATUS_COLORS.warn;
    label = fmtRelative(product.last_success_at);
  } else if (product.last_success_at) {
    color = STATUS_COLORS.warn;
    label = fmtRelative(product.last_success_at);
  } else {
    color = STATUS_COLORS.danger;
    label = 'never';
  }
  return (
    <div
      className="flex flex-col items-center gap-1"
      title={product.last_error ?? (product.last_success_at ? '' : 'never synced')}
    >
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}66` }}
      />
      <span className="font-mono text-[10px] text-muted-foreground/80">{label}</span>
    </div>
  );
}

function BucketCard({ bucket }: { bucket: Bucket }) {
  const tokens = Math.round(bucket.tokens);
  const capacity = bucket.capacity || 0;
  const ratio = capacity > 0 ? Math.max(0, Math.min(1, tokens / capacity)) : 0;
  const tone: 'ok' | 'warn' | 'danger' = ratio > 0.5 ? 'ok' : ratio > 0.2 ? 'warn' : 'danger';
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-secondary/40 p-4">
      <Gauge value={tokens} max={Math.max(capacity, 1)} size={130} tone={tone} />
      <div className="w-full text-center">
        <div className="flex items-center justify-center gap-2 font-mono text-xs">
          <Badge variant="default">{bucket.platform}</Badge>
          <span className="truncate">{bucket.scope ?? bucket.key.split(':').slice(-1)[0]}</span>
        </div>
        {(bucket.hits != null || bucket.denies != null) && (
          <div className="mt-1.5 font-mono text-[10px] text-muted-foreground/70">
            hits {bucket.hits ?? 0} · denies {bucket.denies ?? 0}
          </div>
        )}
      </div>
    </div>
  );
}

function CallsTicker({
  calls,
  accounts,
}: {
  calls: ApiCall[];
  accounts: AdminAccount[];
}) {
  const [account, setAccount] = useState<string>('all');
  const filtered =
    account === 'all'
      ? calls
      : calls.filter((c) => String(c.account_id ?? '') === account);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          Filter
        </span>
        <Select value={account} onValueChange={setAccount}>
          <SelectTrigger className="h-8 w-auto min-w-[220px] font-mono text-xs">
            <SelectValue placeholder="All accounts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All accounts</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.handle || `Account ${a.id}`} · {a.platform}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-[10.5px] text-muted-foreground/70">
          {filtered.length} rows
        </span>
      </div>
      <ScrollArea className="h-[380px] rounded-md border border-border bg-secondary/30">
        {filtered.slice(0, 80).map((c, i) => {
          const tone = pickStatusTone(c.status_code);
          return (
            <div
              key={`${c.called_at}:${c.endpoint}:${i}`}
              className="grid grid-cols-[64px_78px_50px_1fr_140px_56px] items-center gap-3 border-b border-border/70 px-3 py-1.5 font-mono text-[11.5px] last:border-0"
            >
              <span className="text-muted-foreground/70">{fmtTime(c.called_at)}</span>
              <span className="text-center">
                <Badge variant="default" className="font-normal">
                  {c.platform}
                </Badge>
              </span>
              <span
                className="text-center font-semibold"
                style={{ color: STATUS_COLORS[tone] }}
              >
                {c.status_code ?? '—'}
              </span>
              <span className="truncate" title={c.endpoint}>
                {c.endpoint}
              </span>
              <span className="text-right text-[10px] text-muted-foreground/80">
                {c.account_handle || `#${c.account_id}`}
              </span>
              <span className="text-right text-[10px]">{fmtMs(c.duration_ms)}</span>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            No calls match this filter.
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ── Helpers / aggregations ────────────────────────────────────────────────

function bucketTotals(calls: ApiCall[]) {
  const totals = { ok: 0, warn: 0, err: 0 };
  for (const c of calls) {
    const sc = c.status_code ?? 0;
    if (sc >= 200 && sc < 300) totals.ok += 1;
    else if (sc >= 400 && sc < 500) totals.warn += 1;
    else totals.err += 1;
  }
  return totals;
}

function buildThroughputSeries(calls: ApiCall[]) {
  const now = Date.now();
  const start = now - WINDOW_MIN * 60_000;
  const buckets: Array<{ ts: number; ok: number; warn: number; err: number }> = [];
  for (let i = 0; i < WINDOW_MIN; i++) {
    buckets.push({ ts: start + i * 60_000, ok: 0, warn: 0, err: 0 });
  }
  for (const c of calls) {
    if (!c.called_at) continue;
    const t = new Date(c.called_at).getTime();
    if (isNaN(t) || t < start || t > now) continue;
    const idx = Math.floor((t - start) / 60_000);
    if (idx < 0 || idx >= buckets.length) continue;
    const sc = c.status_code ?? 0;
    if (sc >= 200 && sc < 300) buckets[idx].ok += 1;
    else if (sc >= 400 && sc < 500) buckets[idx].warn += 1;
    else buckets[idx].err += 1;
  }
  return [
    {
      label: '2xx',
      color: STATUS_COLORS.ok,
      points: buckets.map((b) => ({ x: b.ts, y: b.ok })),
    },
    {
      label: '4xx',
      color: STATUS_COLORS.warn,
      points: buckets.map((b) => ({ x: b.ts, y: b.warn })),
    },
    {
      label: '5xx',
      color: STATUS_COLORS.danger,
      points: buckets.map((b) => ({ x: b.ts, y: b.err })),
    },
  ];
}

function throughputThisHour(calls: ApiCall[]): number {
  const cutoff = Date.now() - 3_600_000;
  return calls.filter((c) => c.called_at && new Date(c.called_at).getTime() >= cutoff).length;
}

function successRate(calls: ApiCall[]): string {
  // Drop "expected" non-2xx (documented no-data outcomes) from both
  // numerator and denominator so a small audience that legitimately
  // returns "Not enough users" doesn't tank the overall success score.
  const real = calls.filter((c) => !c.expected);
  if (!real.length) return '—';
  const ok = real.filter(
    (c) => typeof c.status_code === 'number' && c.status_code >= 200 && c.status_code < 300,
  ).length;
  return `${((ok / real.length) * 100).toFixed(0)}%`;
}

function parseSuccess(s: string): number {
  if (s === '—') return 100;
  const n = parseInt(s, 10);
  return isNaN(n) ? 100 : n;
}

function errorsLastHour(calls: ApiCall[]): number {
  const cutoff = Date.now() - 3_600_000;
  return calls.filter((c) => {
    if (c.expected) return false;
    if (!c.called_at) return false;
    if (new Date(c.called_at).getTime() < cutoff) return false;
    return typeof c.status_code === 'number' && c.status_code >= 400;
  }).length;
}

function buildHealthMix(accounts: AdminAccount[]) {
  let fresh = 0;
  let stale = 0;
  let failing = 0;
  let paused = 0;
  for (const a of accounts) {
    const isPaused = a.sync_tier === 'paused' || a.status === 'paused';
    for (const p of a.products ?? []) {
      if (isPaused) {
        paused += 1;
      } else if ((p.failure_count ?? 0) >= 3) {
        failing += 1;
      } else if (p.freshness === 'green') {
        fresh += 1;
      } else {
        stale += 1;
      }
    }
  }
  return [
    { label: 'Fresh', value: fresh, color: STATUS_COLORS.ok },
    { label: 'Stale', value: stale, color: STATUS_COLORS.warn },
    { label: 'Failing', value: failing, color: STATUS_COLORS.danger },
    { label: 'Paused', value: paused, color: STATUS_COLORS.muted },
  ];
}

function buildTopErrors(calls: ApiCall[]) {
  const cutoff = Date.now() - 24 * 3_600_000;
  const errorCalls = calls.filter(
    (c) =>
      !c.expected &&
      c.called_at &&
      new Date(c.called_at).getTime() >= cutoff &&
      typeof c.status_code === 'number' &&
      (c.status_code === 0 || c.status_code >= 400),
  );
  const grouped = new Map<string, number>();
  for (const c of errorCalls) {
    const key = `${c.status_code} ${c.endpoint?.split('?')[0] ?? '—'}`;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  return Array.from(grouped.entries())
    .map(([label, value]) => ({
      label,
      value,
      color: label.startsWith('0') ? STATUS_COLORS.danger : STATUS_COLORS.warn,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

function buildTopEndpoints(calls: ApiCall[]) {
  const cutoff = Date.now() - 24 * 3_600_000;
  const recent = calls.filter(
    (c) => c.called_at && new Date(c.called_at).getTime() >= cutoff,
  );
  const grouped = new Map<string, { count: number; total: number }>();
  for (const c of recent) {
    const key = c.endpoint?.split('?')[0] ?? '—';
    const cur = grouped.get(key) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += c.duration_ms ?? 0;
    grouped.set(key, cur);
  }
  return Array.from(grouped.entries())
    .map(([label, { count, total }]) => ({
      label,
      value: count,
      caption: `avg ${Math.round(total / count)} ms`,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

function buildHeatmap(calls: ApiCall[], accounts: AdminAccount[]) {
  const labelOf = new Map<string, string>();
  for (const a of accounts) labelOf.set(a.id, a.handle || `Account ${a.id}`);

  const cutoff = Date.now() - 24 * 3_600_000;
  const recent = calls.filter(
    (c) =>
      c.called_at && new Date(c.called_at).getTime() >= cutoff && c.account_id != null,
  );

  const rowSet = new Set<string>();
  const cellMap = new Map<string, number>();
  const now = new Date();

  for (const c of recent) {
    const accId = String(c.account_id);
    const label = labelOf.get(accId) ?? `#${accId}`;
    rowSet.add(label);
    const t = new Date(c.called_at as string);
    const hourLabel = pad2(t.getHours());
    const k = `${label}::${hourLabel}`;
    cellMap.set(k, (cellMap.get(k) ?? 0) + 1);
  }

  const cols = Array.from({ length: 24 }, (_, i) =>
    pad2((now.getHours() - 23 + i + 24) % 24),
  );

  const rows = Array.from(rowSet).sort();
  const cells = Array.from(cellMap.entries()).map(([k, value]) => {
    const [row, col] = k.split('::');
    return { row, col, value };
  });
  return { rows, cols, cells };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
