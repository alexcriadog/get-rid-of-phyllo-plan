import { useMemo, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { useLive } from '../../lib/useLive';
import { useWorkspaceFilter } from '../../lib/workspace-context';
import { fmtMs, fmtTime } from '../../lib/format';
import {
  LineChart,
  HBarChart,
  STATUS_COLORS,
  pickStatusTone,
  compactNumber,
} from '../../components/charts';
import { Section } from '@/components/admin/section';
import { Empty } from '@/components/admin/empty';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ConnectionFlowBadge } from '@/components/account/ConnectionFlowBadge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type ApiCall = {
  called_at?: string;
  platform?: string;
  endpoint?: string;
  status_code?: number;
  duration_ms?: number;
  account_id?: string | null;
  account_handle?: string | null;
  connection_flow?: string | null;
};

const PLATFORMS = ['all', 'instagram', 'facebook'];
const STATUS_FILTERS = ['all', '2xx', '4xx', '5xx', '0'];

const ROW_GRID = 'grid-cols-[64px_84px_56px_minmax(0,1fr)_140px_64px]';

export default function CallsPage() {
  const { withQuery } = useWorkspaceFilter();
  const { data } = useLive<ApiCall[]>(
    withQuery('/admin/api-calls?limit=500'),
    3000,
  );

  const [platform, setPlatform] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [endpoint, setEndpoint] = useState('');

  const calls = data ?? [];
  const filtered = useMemo(
    () =>
      calls.filter((c) => {
        if (platform !== 'all' && c.platform !== platform) return false;
        if (statusFilter !== 'all' && !matchStatus(c.status_code, statusFilter)) return false;
        if (endpoint && !(c.endpoint ?? '').includes(endpoint)) return false;
        return true;
      }),
    [calls, platform, statusFilter, endpoint],
  );

  const series = useMemo(() => buildHistogram(filtered), [filtered]);
  const topEndpoints = useMemo(() => buildTopEndpoints(filtered), [filtered]);
  const topErrors = useMemo(() => buildTopErrors(filtered), [filtered]);

  return (
    <AdminLayout title="API calls">
      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Input
            placeholder="Endpoint contains…"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            className="min-w-[220px] flex-1"
          />
          <FilterSelect
            label="Platform"
            value={platform}
            onChange={setPlatform}
            options={PLATFORMS}
          />
          <FilterSelect
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_FILTERS}
          />
          <span className="ml-auto font-mono text-[10.5px] text-muted-foreground/70">
            {filtered.length} of {calls.length}
          </span>
        </CardContent>
      </Card>

      <Section
        title="Calls per minute · last 60 min"
        description="Stacked area · status class breakdown"
      >
        <LineChart
          series={series}
          height={220}
          area
          stacked
          xLabels={{ left: '-60m', mid: '-30m', right: 'now' }}
          emptyMessage="No matching calls."
        />
      </Section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title="Top endpoints (current filter)">
          <HBarChart items={topEndpoints} formatValue={compactNumber} emptyMessage="No data." />
        </Section>
        <Section title="Top errors (current filter)">
          <HBarChart items={topErrors} showPct emptyMessage="No errors in window." />
        </Section>
      </div>

      <Section
        title={`Recent ${Math.min(filtered.length, 200)} calls`}
        description="Most recent first"
        bare
      >
        <CallsTable calls={filtered.slice(0, 200)} />
      </Section>
    </AdminLayout>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
      <span>{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-[140px] text-xs font-normal normal-case tracking-normal">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o} className="font-mono text-xs">
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function CallsTable({ calls }: { calls: ApiCall[] }) {
  if (calls.length === 0) {
    return (
      <div className="p-5">
        <Empty message="No calls match these filters." />
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
        <span>St</span>
        <span>Endpoint</span>
        <span className="text-right">Account</span>
        <span className="text-right">Dur</span>
      </div>
      {calls.map((c, i) => {
        const tone = pickStatusTone(c.status_code);
        return (
          <div
            key={`${c.called_at}:${c.endpoint}:${i}`}
            className={`grid ${ROW_GRID} items-center gap-3 border-b border-border/70 px-3 py-1.5 font-mono text-[11.5px] last:border-0`}
          >
            <span className="text-muted-foreground/70">{fmtTime(c.called_at)}</span>
            <span>
              <Badge variant="default" className="w-full justify-center">
                {c.platform}
              </Badge>
            </span>
            <span
              className="text-center font-semibold"
              style={{ color: STATUS_COLORS[tone] }}
            >
              {c.status_code ?? '—'}
            </span>
            <span
              className="overflow-hidden text-ellipsis whitespace-nowrap"
              title={c.endpoint}
            >
              {c.endpoint}
            </span>
            <span
              className="flex items-center justify-end gap-1 overflow-hidden whitespace-nowrap text-right text-[10px] text-muted-foreground/70"
              title={c.account_handle ?? `#${c.account_id ?? ''}`}
            >
              <span className="truncate">
                {c.account_handle ?? `#${c.account_id ?? ''}`}
              </span>
              <ConnectionFlowBadge flow={c.connection_flow} />
            </span>
            <span className="text-right text-[10px]">{fmtMs(c.duration_ms)}</span>
          </div>
        );
      })}
    </ScrollArea>
  );
}

function matchStatus(sc: number | undefined, filter: string): boolean {
  if (filter === '0') return sc === 0 || sc == null;
  const code = sc ?? 0;
  if (filter === '2xx') return code >= 200 && code < 300;
  if (filter === '4xx') return code >= 400 && code < 500;
  if (filter === '5xx') return code >= 500;
  return true;
}

function buildHistogram(calls: ApiCall[]) {
  const now = Date.now();
  const start = now - 60 * 60_000;
  const bins: Array<{ ts: number; ok: number; warn: number; err: number }> = [];
  for (let i = 0; i < 60; i++) bins.push({ ts: start + i * 60_000, ok: 0, warn: 0, err: 0 });
  for (const c of calls) {
    if (!c.called_at) continue;
    const t = new Date(c.called_at).getTime();
    if (t < start || t > now) continue;
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

function buildTopEndpoints(calls: ApiCall[]) {
  const grouped = new Map<string, { count: number; total: number }>();
  for (const c of calls) {
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

function buildTopErrors(calls: ApiCall[]) {
  const errs = calls.filter(
    (c) => typeof c.status_code === 'number' && (c.status_code === 0 || c.status_code >= 400),
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
    .slice(0, 8);
}
