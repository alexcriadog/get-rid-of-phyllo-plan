import { useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, Pause, Play, RefreshCw } from 'lucide-react';
import AdminLayout from '../../../components/AdminLayout';
import { useLive } from '../../../lib/useLive';
import { adminPost } from '../../../lib/api';
import { fmtRelative, fmtMs, fmtTime, productFromCall, type ProductKind } from '../../../lib/format';
import {
  LineChart,
  HBarChart,
  STATUS_COLORS,
  pickStatusTone,
} from '../../../components/charts';
import { Section } from '@/components/admin/section';
import { Empty } from '@/components/admin/empty';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
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

type ProductHealth = {
  product?: string;
  last_success_at?: string | null;
  next_run_at?: string | null;
  failure_count?: number;
  freshness?: 'green' | 'yellow' | 'red';
  status?: string;
  last_error?: string | null;
  override_active?: boolean;
};

type AccountDetail = {
  id: string;
  platform: string;
  handle?: string | null;
  display_name?: string | null;
  status?: string;
  sync_tier?: string;
  canonical_user_id?: string;
  connected_at?: string | null;
  token_expires_at?: string | null;
  products?: ProductHealth[] | Record<string, ProductHealth>;
  sync_jobs?: Array<{
    id?: string;
    product: string;
    status: string;
    next_run_at?: string | null;
    last_success_at?: string | null;
    last_attempt_at?: string | null;
    failure_count?: number;
    last_error?: string | null;
  }>;
};

type ApiCall = {
  called_at?: string;
  platform?: string;
  endpoint?: string;
  status_code?: number;
  duration_ms?: number;
  account_id?: string | null;
  account_handle?: string | null;
  product?: string | null;
};

const PRODUCTS = ['identity', 'audience', 'engagement_new', 'stories'];

export default function AccountDetailPage() {
  const router = useRouter();
  const id = router.query.id as string | undefined;

  const { data, error, refresh } = useLive<AccountDetail>(
    id ? `/admin/accounts/${id}` : null,
    5000,
  );
  const callsLive = useLive<ApiCall[]>('/admin/api-calls?limit=500', 5000);

  const [tab, setTab] = useState('timeline');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const account = data;
  const allCalls = callsLive.data ?? [];
  const myCalls = useMemo(
    () => allCalls.filter((c) => String(c.account_id ?? '') === id),
    [allCalls, id],
  );

  const productSeries = useMemo(() => buildPerProductSeries(myCalls), [myCalls]);
  const topErrors = useMemo(() => buildTopErrors(myCalls), [myCalls]);
  const topEndpoints = useMemo(() => buildTopEndpoints(myCalls), [myCalls]);

  const action = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!id) return <AdminLayout title="Account">Loading…</AdminLayout>;

  return (
    <AdminLayout
      title={account?.handle || account?.display_name || `Account ${id}`}
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/accounts">
            <ArrowLeft className="h-3.5 w-3.5" />
            All accounts
          </Link>
        </Button>
      }
    >
      {error && !account && (
        <div className="mb-5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}
      {err && (
        <div className="mb-5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {err}
        </div>
      )}

      {!account ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading account…</Card>
      ) : (
        <>
          <Card className="mb-5 flex flex-wrap items-start gap-5 p-6">
            <div className="min-w-0 flex-1 basis-[280px]">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {account.platform}
              </div>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight">
                {account.handle || account.display_name || `Account ${id}`}
              </h2>
              <div className="mt-1 font-mono text-xs text-muted-foreground/70">
                #{id} · {account.canonical_user_id ?? '—'}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant={account.status === 'paused' ? 'danger' : 'ok'}>
                  {account.status ?? '—'}
                </Badge>
                <Badge variant="default">{account.sync_tier ?? '—'}</Badge>
                {account.connected_at && (
                  <Badge variant="default">
                    connected {fmtRelative(account.connected_at)}
                  </Badge>
                )}
                {account.token_expires_at && (
                  <Badge variant="default">
                    token {fmtRelative(account.token_expires_at)}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                onClick={() =>
                  action('refresh', () =>
                    adminPost(`/admin/accounts/${id}/refresh-now`, {}),
                  )
                }
                disabled={busy === 'refresh'}
                size="sm"
              >
                <RefreshCw className={cn('h-4 w-4', busy === 'refresh' && 'animate-spin')} />
                {busy === 'refresh' ? 'Refreshing…' : 'Refresh now'}
              </Button>
              <Button
                onClick={() =>
                  action('pause', () =>
                    adminPost(
                      `/admin/accounts/${id}/${account.status === 'paused' ? 'unpause' : 'pause'}`,
                      {},
                    ),
                  )
                }
                disabled={busy === 'pause'}
                variant="outline"
                size="sm"
              >
                {account.status === 'paused' ? (
                  <Play className="h-4 w-4" />
                ) : (
                  <Pause className="h-4 w-4" />
                )}
                {account.status === 'paused' ? 'Unpause' : 'Pause'}
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={`/admin/accounts/${id}/sync-settings`}>
                  Sync settings
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={`/account/${id}`}>
                  Public view
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </Card>

          <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PRODUCTS.map((p) => (
              <ProductStatusCard
                key={p}
                product={p}
                health={getProductHealth(account, p)}
              />
            ))}
          </div>

          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList>
              <TabsTrigger value="timeline">Activity timeline</TabsTrigger>
              <TabsTrigger value="calls">Recent calls</TabsTrigger>
              <TabsTrigger value="jobs">Sync jobs</TabsTrigger>
            </TabsList>

            <TabsContent value="timeline">
              <Section
                title="Calls per minute · last 60 min"
                description="Stacked area · per status class"
              >
                <LineChart
                  series={buildThroughputSeries(myCalls)}
                  height={220}
                  area
                  stacked
                  xLabels={{ left: '-60m', mid: '-30m', right: 'now' }}
                  emptyMessage="No calls in window."
                />
              </Section>

              <Section
                title="Per-product activity · last 24h"
                description="Calls per hour grouped by product"
              >
                <LineChart
                  series={productSeries}
                  height={200}
                  area
                  emptyMessage="No activity in the last 24h."
                  xLabels={{ left: '24h ago', mid: '12h ago', right: 'now' }}
                />
              </Section>

              <div className="grid gap-4 lg:grid-cols-2">
                <Section title="Top endpoints (24h)">
                  <HBarChart items={topEndpoints} showPct emptyMessage="No data." />
                </Section>
                <Section title="Top errors (24h)">
                  <HBarChart items={topErrors} showPct emptyMessage="No errors." />
                </Section>
              </div>
            </TabsContent>

            <TabsContent value="calls">
              <Section
                title={`Recent API calls (${myCalls.length})`}
                description="Most recent 80 calls for this account"
              >
                <CallsTable calls={myCalls.slice(0, 80)} />
              </Section>
            </TabsContent>

            <TabsContent value="jobs">
              <Section
                title="Sync jobs"
                description="Per-product cadence + last run + next run"
              >
                <SyncJobsTable jobs={account.sync_jobs ?? []} />
              </Section>
            </TabsContent>
          </Tabs>
        </>
      )}
    </AdminLayout>
  );
}

// ── Components ────────────────────────────────────────────────────────────

function ProductStatusCard({
  product,
  health,
}: {
  product: string;
  health: ProductHealth | null;
}) {
  const failureCount = health?.failure_count ?? 0;
  let tone: 'ok' | 'warn' | 'danger' | 'muted' = 'muted';
  if (!health) tone = 'muted';
  else if (failureCount >= 3) tone = 'danger';
  else if (health.freshness === 'green') tone = 'ok';
  else tone = 'warn';
  const color = STATUS_COLORS[tone];

  const toneTextClass =
    tone === 'ok'
      ? 'text-ok'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'danger'
          ? 'text-danger'
          : 'text-muted-foreground';

  return (
    <Card
      className="p-4"
      style={{ borderTop: `2px solid ${color}` }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {product.replace('_', ' ')}
      </div>
      <div className={cn('mt-1.5 text-sm font-semibold', toneTextClass)}>
        {!health
          ? 'no data'
          : failureCount >= 3
            ? `${failureCount} fails`
            : health.freshness === 'green'
              ? 'healthy'
              : 'stale'}
      </div>
      <div className="mt-1 font-mono text-[11px] text-muted-foreground/70">
        last ok · {fmtRelative(health?.last_success_at)}
      </div>
      <div className="font-mono text-[11px] text-muted-foreground/70">
        next · {fmtRelative(health?.next_run_at)}
      </div>
      {health?.last_error && (
        <div
          className="mt-1.5 truncate font-mono text-[10px] text-danger"
          title={health.last_error}
        >
          {health.last_error}
        </div>
      )}
    </Card>
  );
}

function CallsTable({ calls }: { calls: ApiCall[] }) {
  if (calls.length === 0) {
    return <Empty message="No calls yet." />;
  }
  return (
    <ScrollArea className="h-[480px] rounded-md border border-border bg-secondary/30">
      {calls.map((c, i) => {
        const tone = pickStatusTone(c.status_code);
        return (
          <div
            key={`${c.called_at}:${c.endpoint}:${i}`}
            className="grid grid-cols-[64px_50px_1fr_70px] items-center gap-3 border-b border-border/70 px-3 py-1.5 font-mono text-[11.5px] last:border-0"
          >
            <span className="text-muted-foreground/70">{fmtTime(c.called_at)}</span>
            <span
              className="text-center font-semibold"
              style={{ color: STATUS_COLORS[tone] }}
            >
              {c.status_code ?? '—'}
            </span>
            <span className="truncate" title={c.endpoint}>
              {c.endpoint}
            </span>
            <span className="text-right">{fmtMs(c.duration_ms)}</span>
          </div>
        );
      })}
    </ScrollArea>
  );
}

function SyncJobsTable({
  jobs,
}: {
  jobs: NonNullable<AccountDetail['sync_jobs']>;
}) {
  if (jobs.length === 0) return <Empty message="No sync jobs." />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Product</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Last attempt</TableHead>
          <TableHead>Last success</TableHead>
          <TableHead>Next run</TableHead>
          <TableHead className="text-right">Fails</TableHead>
          <TableHead>Last error</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((j) => {
          const fails = j.failure_count ?? 0;
          return (
            <TableRow key={j.id ?? j.product}>
              <TableCell className="font-mono text-xs">{j.product}</TableCell>
              <TableCell>
                <Badge variant="default">{j.status}</Badge>
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground/80">
                {fmtRelative(j.last_attempt_at)}
              </TableCell>
              <TableCell
                className={cn(
                  'font-mono text-xs',
                  !j.last_success_at && 'text-muted-foreground/60',
                )}
              >
                {fmtRelative(j.last_success_at)}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground/80">
                {fmtRelative(j.next_run_at)}
              </TableCell>
              <TableCell
                className={cn(
                  'text-right font-mono text-xs',
                  fails > 0 ? 'text-danger' : 'text-muted-foreground',
                )}
              >
                {fails}
              </TableCell>
              <TableCell
                className="max-w-[320px] truncate font-mono text-[11px] text-danger"
                title={j.last_error ?? ''}
              >
                {j.last_error ?? ''}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function getProductHealth(account: AccountDetail, product: string): ProductHealth | null {
  const raw = account.products;
  if (!raw) return null;
  if (Array.isArray(raw)) return raw.find((p) => p.product === product) ?? null;
  return raw[product] ?? null;
}

function buildThroughputSeries(calls: ApiCall[]) {
  const now = Date.now();
  const start = now - 60 * 60_000;
  const bins: Array<{ ts: number; ok: number; warn: number; err: number }> = [];
  for (let i = 0; i < 60; i++)
    bins.push({ ts: start + i * 60_000, ok: 0, warn: 0, err: 0 });
  for (const c of calls) {
    if (!c.called_at) continue;
    const t = new Date(c.called_at).getTime();
    if (isNaN(t) || t < start || t > now) continue;
    const idx = Math.floor((t - start) / 60_000);
    if (idx < 0 || idx >= bins.length) continue;
    const sc = c.status_code ?? 0;
    if (sc >= 200 && sc < 300) bins[idx].ok += 1;
    else if (sc >= 400 && sc < 500) bins[idx].warn += 1;
    else bins[idx].err += 1;
  }
  return [
    { label: '2xx', color: STATUS_COLORS.ok, points: bins.map((b) => ({ x: b.ts, y: b.ok })) },
    { label: '4xx', color: STATUS_COLORS.warn, points: bins.map((b) => ({ x: b.ts, y: b.warn })) },
    { label: '5xx', color: STATUS_COLORS.danger, points: bins.map((b) => ({ x: b.ts, y: b.err })) },
  ];
}

function buildPerProductSeries(calls: ApiCall[]) {
  const now = Date.now();
  const start = now - 24 * 3600_000;
  const products: ProductKind[] = ['identity', 'audience', 'engagement_new', 'stories'];
  const colors = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)'];
  const productIndex = new Map<ProductKind, number>(products.map((p, i) => [p, i]));
  const bins = products.map(() =>
    Array.from({ length: 24 }, (_, h) => ({ ts: start + h * 3600_000, count: 0 })),
  );
  for (const c of calls) {
    if (!c.called_at) continue;
    const t = new Date(c.called_at).getTime();
    if (t < start || t > now) continue;
    const idx = Math.floor((t - start) / 3600_000);
    if (idx < 0 || idx >= 24) continue;
    const pi = productIndex.get(productFromCall(c)) ?? 0;
    bins[pi][idx].count += 1;
  }
  return products.map((p, i) => ({
    label: p,
    color: colors[i],
    points: bins[i].map((b) => ({ x: b.ts, y: b.count })),
  }));
}

function buildTopErrors(calls: ApiCall[]) {
  const cutoff = Date.now() - 24 * 3600_000;
  const errs = calls.filter(
    (c) =>
      c.called_at &&
      new Date(c.called_at).getTime() >= cutoff &&
      typeof c.status_code === 'number' &&
      (c.status_code === 0 || c.status_code >= 400),
  );
  const grouped = new Map<string, number>();
  for (const c of errs) {
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
    .slice(0, 6);
}

function buildTopEndpoints(calls: ApiCall[]) {
  const cutoff = Date.now() - 24 * 3600_000;
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
    .slice(0, 6);
}
