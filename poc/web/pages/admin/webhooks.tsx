import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { useLive } from '../../lib/useLive';
import { adminPost } from '../../lib/api';
import { fmtTime, fmtRelative } from '../../lib/format';
import { LineChart, HBarChart, STATUS_COLORS, seriesColor } from '../../components/charts';
import { Section } from '@/components/admin/section';
import { Empty } from '@/components/admin/empty';
import { KpiCard } from '@/components/admin/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type WebhookStatus = 'invalid_signature' | 'enqueued' | 'skipped' | 'unresolved';

type WebhookRow = {
  id: string;
  platform: string;
  topic?: string | null;
  object?: string | null;
  received_at?: string;
  entry_id?: string | null;
  account_id?: string | null;
  account_handle?: string | null;
  status?: WebhookStatus;
  body_excerpt?: string | null;
};

type SilenceRow = {
  account_id: string;
  account_handle?: string | null;
  platform: string;
  product?: string;
  last_received_at?: string | null;
  silence_seconds?: number;
};

const ROW_GRID =
  'grid-cols-[118px_84px_120px_minmax(110px,160px)_92px_minmax(0,1fr)_56px]';

const STATUS_META: Record<WebhookStatus, { label: string; color: string }> = {
  enqueued: { label: 'enqueued', color: STATUS_COLORS.ok },
  skipped: { label: 'skipped', color: STATUS_COLORS.info },
  unresolved: { label: 'unresolved', color: STATUS_COLORS.warn },
  invalid_signature: { label: 'bad sig', color: STATUS_COLORS.danger },
};

export default function WebhooksPage() {
  const inboundLive = useLive<WebhookRow[]>('/admin/webhooks/inbound?limit=300', 4000);
  const silenceLive = useLive<SilenceRow[]>('/admin/webhooks/silence', 10000);

  const [tab, setTab] = useState('inbound');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const inbound = inboundLive.data ?? [];
  const silence = silenceLive.data ?? [];

  const series = useMemo(() => buildWebhookSeries(inbound), [inbound]);
  const topTopics = useMemo(() => buildTopTopics(inbound), [inbound]);

  const replay = async (id: string) => {
    setBusy(id);
    setErr(null);
    try {
      await adminPost(`/admin/webhooks/replay/${id}`, {});
      inboundLive.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminLayout title="Webhooks">
      {err && (
        <div className="mb-5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {err}
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList>
          <TabsTrigger value="inbound">Inbound stream</TabsTrigger>
          <TabsTrigger value="silence">Silence detector</TabsTrigger>
        </TabsList>

        <TabsContent value="inbound" className="mt-5">
          <Section
            title="Webhook deliveries · last 60 min"
            description="Stacked area · grouped by topic"
          >
            <LineChart
              series={series}
              height={200}
              area
              stacked
              xLabels={{ left: '-60m', mid: '-30m', right: 'now' }}
              emptyMessage="No webhook traffic in window. Meta will deliver IG/FB events here when subscribed."
            />
          </Section>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Section title="Top topics">
              <HBarChart items={topTopics} showPct emptyMessage="No webhook traffic." />
            </Section>
            <Section title="Stats" description="Inbound webhook overview">
              <Stats inbound={inbound} silence={silence} />
            </Section>
          </div>

          <Section
            title={`Recent ${Math.min(inbound.length, 100)} deliveries`}
            description="Click ↻ to replay through the queue"
            bare
          >
            <InboundTable inbound={inbound.slice(0, 100)} busy={busy} onReplay={replay} />
          </Section>
        </TabsContent>

        <TabsContent value="silence" className="mt-5">
          <Section
            title="Silence detector"
            description="Accounts that haven't received any webhook lately — possible subscription issue."
          >
            {silence.length === 0 ? (
              <Empty message="All subscribed accounts received recent webhooks." />
            ) : (
              <SilenceTable rows={silence} />
            )}
          </Section>
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}

function Stats({ inbound, silence }: { inbound: WebhookRow[]; silence: SilenceRow[] }) {
  const cutoff = Date.now() - 3600_000;
  const lastHour = inbound.filter(
    (w) => w.received_at && new Date(w.received_at).getTime() >= cutoff,
  ).length;
  const platforms = new Map<string, number>();
  for (const w of inbound) platforms.set(w.platform, (platforms.get(w.platform) ?? 0) + 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Total tracked" value={String(inbound.length)} tone="primary" />
        <KpiCard label="Last hour" value={String(lastHour)} tone="info" />
        <KpiCard
          label="Silenced accounts"
          value={String(silence.length)}
          tone={silence.length > 0 ? 'warn' : 'ok'}
        />
      </div>
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Platforms
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {Array.from(platforms.entries()).map(([p, n]) => (
            <Badge key={p} variant="default">
              {p} · {n}
            </Badge>
          ))}
          {platforms.size === 0 && (
            <span className="font-mono text-[11px] text-muted-foreground/70">—</span>
          )}
        </div>
      </div>
    </div>
  );
}

function InboundTable({
  inbound,
  busy,
  onReplay,
}: {
  inbound: WebhookRow[];
  busy: string | null;
  onReplay: (id: string) => void;
}) {
  if (inbound.length === 0) {
    return (
      <div className="p-5">
        <Empty message="No deliveries recorded yet." />
      </div>
    );
  }
  return (
    <ScrollArea className="h-[540px] rounded-md border border-border bg-secondary/30">
      <div
        className={`grid ${ROW_GRID} sticky top-0 z-10 gap-3 border-b border-border bg-secondary px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground`}
      >
        <span>Time</span>
        <span>Platform</span>
        <span>Topic</span>
        <span>Account</span>
        <span>Status</span>
        <span>Body excerpt</span>
        <span className="text-right">Action</span>
      </div>
      {inbound.map((w) => (
        <div
          key={w.id}
          className={`grid ${ROW_GRID} items-center gap-3 border-b border-border/70 px-3 py-1.5 font-mono text-[11.5px] last:border-0`}
        >
          <span className="flex flex-col leading-tight">
            <span className="text-muted-foreground/90">{fmtTime(w.received_at)}</span>
            <span className="text-[10px] text-muted-foreground/60">
              {fmtRelative(w.received_at)}
            </span>
          </span>
          <span>
            <Badge variant="default" className="w-full justify-center">
              {w.platform}
            </Badge>
          </span>
          <span className="flex flex-col leading-tight truncate">
            <span className="truncate" style={{ color: STATUS_COLORS.info }}>
              {w.topic ?? '—'}
            </span>
            {w.object && (
              <span className="text-[10px] text-muted-foreground/60">{w.object}</span>
            )}
          </span>
          <span className="flex flex-col leading-tight truncate">
            <span className="truncate">
              {w.account_handle ?? (w.account_id ? `#${w.account_id}` : '—')}
            </span>
            {w.account_handle && w.account_id && (
              <span className="text-[10px] text-muted-foreground/60">
                #{w.account_id}
              </span>
            )}
          </span>
          <span
            className="text-[10.5px] font-semibold"
            style={{ color: STATUS_META[w.status ?? 'unresolved'].color }}
          >
            {STATUS_META[w.status ?? 'unresolved'].label}
          </span>
          <span
            className="overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-muted-foreground/70"
            title={w.body_excerpt ?? ''}
          >
            {w.body_excerpt ?? ''}
          </span>
          <span className="flex justify-end">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => onReplay(w.id)}
              disabled={busy === w.id}
              title="Replay this webhook through the queue"
              aria-label="Replay webhook"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy === w.id ? 'animate-spin' : ''}`} />
            </Button>
          </span>
        </div>
      ))}
    </ScrollArea>
  );
}

function SilenceTable({ rows }: { rows: SilenceRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Account</TableHead>
          <TableHead>Platform</TableHead>
          <TableHead>Last received</TableHead>
          <TableHead className="text-right">Silence</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const neverReceived = r.last_received_at == null;
          const minutes = neverReceived
            ? null
            : Math.round((r.silence_seconds ?? 0) / 60);
          const tone =
            neverReceived || (minutes ?? 0) > 60
              ? STATUS_COLORS.danger
              : (minutes ?? 0) > 15
                ? STATUS_COLORS.warn
                : STATUS_COLORS.ok;
          return (
            <TableRow key={`${r.account_id}-${r.product ?? ''}`}>
              <TableCell className="font-mono text-xs">
                <div>{r.account_handle ?? `Account ${r.account_id}`}</div>
                <div className="text-[10px] text-muted-foreground/70">#{r.account_id}</div>
              </TableCell>
              <TableCell>
                <Badge variant="default">{r.platform}</Badge>
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground/80">
                {fmtRelative(r.last_received_at)}
              </TableCell>
              <TableCell
                className="text-right font-mono text-xs font-semibold"
                style={{ color: tone }}
              >
                {neverReceived ? 'never' : minutes != null ? `${minutes}m` : '—'}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function buildWebhookSeries(rows: WebhookRow[]) {
  const now = Date.now();
  const start = now - 60 * 60_000;
  const topics = new Set<string>();
  for (const w of rows) topics.add(w.topic ?? '—');
  const list = Array.from(topics).sort();
  const buckets: Record<string, number[]> = {};
  for (const t of list) buckets[t] = Array.from({ length: 60 }, () => 0);
  for (const w of rows) {
    if (!w.received_at) continue;
    const t = new Date(w.received_at).getTime();
    if (t < start || t > now) continue;
    const idx = Math.floor((t - start) / 60_000);
    if (idx < 0 || idx >= 60) continue;
    const topic = w.topic ?? '—';
    buckets[topic][idx] += 1;
  }
  return list.map((t, i) => ({
    label: t,
    color: seriesColor(i),
    points: buckets[t].map((y, j) => ({ x: start + j * 60_000, y })),
  }));
}

function buildTopTopics(rows: WebhookRow[]) {
  const grouped = new Map<string, number>();
  for (const w of rows) {
    const k = w.topic ?? '—';
    grouped.set(k, (grouped.get(k) ?? 0) + 1);
  }
  return Array.from(grouped.entries())
    .map(([label, value], i) => ({ label, value, color: seriesColor(i) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}
