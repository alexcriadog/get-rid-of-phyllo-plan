import { useMemo, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { useLive } from '../../lib/useLive';
import { fmtTime } from '../../lib/format';
import { LineChart, HBarChart, STATUS_COLORS, seriesColor } from '../../components/charts';
import { Section } from '@/components/admin/section';
import { Empty } from '@/components/admin/empty';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type EventRow = {
  id: string;
  event_id?: string;
  event_type: string;
  account_id?: string;
  product?: string;
  emitted_at?: string;
  payload?: Record<string, unknown>;
};

const TYPE_FILTER = ['all', 'content.added', 'story.added', 'content.deleted', 'account.needs_reauth'];
const ACCOUNT_ALL = 'all';

const ROW_GRID = 'grid-cols-[64px_200px_80px_minmax(0,1fr)]';

export default function EventsPage() {
  const { data } = useLive<EventRow[]>('/admin/events?limit=300', 4000);

  const [typeFilter, setTypeFilter] = useState('all');
  const [accountFilter, setAccountFilter] = useState(ACCOUNT_ALL);

  const events = data ?? [];
  const filtered = useMemo(
    () =>
      events.filter((e) => {
        if (typeFilter !== 'all' && e.event_type !== typeFilter) return false;
        if (accountFilter !== ACCOUNT_ALL && String(e.account_id ?? '') !== accountFilter) return false;
        return true;
      }),
    [events, typeFilter, accountFilter],
  );

  const accountOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) if (e.account_id) set.add(String(e.account_id));
    return Array.from(set).sort();
  }, [events]);

  const series = useMemo(() => buildEventSeries(filtered), [filtered]);
  const topTypes = useMemo(() => buildTopTypes(filtered), [filtered]);
  const topAccounts = useMemo(() => buildTopAccounts(filtered), [filtered]);

  return (
    <AdminLayout title="Events">
      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <FilterSelect
            label="Event type"
            value={typeFilter}
            onChange={setTypeFilter}
            options={TYPE_FILTER}
          />
          <FilterSelect
            label="Account"
            value={accountFilter}
            onChange={setAccountFilter}
            options={[ACCOUNT_ALL, ...accountOptions]}
            formatOption={(v) => (v === ACCOUNT_ALL ? 'all' : `#${v}`)}
            triggerWidth="w-[160px]"
          />
          <span className="ml-auto font-mono text-[10.5px] text-muted-foreground/70">
            {filtered.length} of {events.length}
          </span>
        </CardContent>
      </Card>

      <Section
        title="Events per minute · last 60 min"
        description="Stacked area · grouped by event type"
      >
        <LineChart
          series={series}
          height={220}
          area
          stacked
          xLabels={{ left: '-60m', mid: '-30m', right: 'now' }}
          emptyMessage="No events in window."
        />
      </Section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title="Top event types">
          <HBarChart items={topTypes} showPct emptyMessage="No events." />
        </Section>
        <Section title="Top accounts by events">
          <HBarChart items={topAccounts} showPct emptyMessage="No events." />
        </Section>
      </div>

      <Section
        title={`Recent ${Math.min(filtered.length, 100)} events`}
        description="Most recent first"
        bare
      >
        <EventsList events={filtered.slice(0, 100)} />
      </Section>
    </AdminLayout>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  formatOption,
  triggerWidth = 'w-[180px]',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  formatOption?: (v: string) => string;
  triggerWidth?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
      <span>{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          className={`h-8 ${triggerWidth} text-xs font-normal normal-case tracking-normal`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o} className="font-mono text-xs">
              {formatOption ? formatOption(o) : o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function EventsList({ events }: { events: EventRow[] }) {
  if (events.length === 0) {
    return (
      <div className="p-5">
        <Empty message="No events match this filter." />
      </div>
    );
  }
  return (
    <ScrollArea className="h-[540px] rounded-md border border-border bg-secondary/30">
      <div
        className={`grid ${ROW_GRID} sticky top-0 z-10 gap-3 border-b border-border bg-secondary px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground`}
      >
        <span>Time</span>
        <span>Event type</span>
        <span>Account</span>
        <span>Payload</span>
      </div>
      {events.map((e) => (
        <div
          key={e.id}
          className={`grid ${ROW_GRID} items-center gap-3 border-b border-border/70 px-3 py-1.5 font-mono text-[11.5px] last:border-0`}
        >
          <span className="text-muted-foreground/70">{fmtTime(e.emitted_at)}</span>
          <span style={typeStyle(e.event_type)} className="truncate">
            {e.event_type}
          </span>
          <span>
            <Badge variant="default" className="w-full justify-center">
              #{e.account_id ?? '—'}
            </Badge>
          </span>
          <span
            className="overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-muted-foreground/70"
            title={JSON.stringify(e.payload ?? {})}
          >
            {summarizePayload(e.payload)}
          </span>
        </div>
      ))}
    </ScrollArea>
  );
}

function typeColor(eventType: string): string | null {
  if (eventType.startsWith('content')) return STATUS_COLORS.ok;
  if (eventType.startsWith('story')) return STATUS_COLORS.info;
  if (eventType.includes('reauth') || eventType.includes('error')) return STATUS_COLORS.danger;
  return null;
}

function typeStyle(eventType: string): React.CSSProperties {
  const c = typeColor(eventType);
  return c ? { color: c } : {};
}

function summarizePayload(p: Record<string, unknown> | undefined): string {
  if (!p) return '';
  const kind = p.kind as string | undefined;
  const size = typeof p.size === 'number' ? p.size : undefined;
  if (kind && size != null) return `${kind} · ${size} item${size === 1 ? '' : 's'}`;
  return JSON.stringify(p).slice(0, 90);
}

function buildEventSeries(events: EventRow[]) {
  const now = Date.now();
  const start = now - 60 * 60_000;
  const types = new Set<string>();
  for (const e of events) types.add(e.event_type);
  const typeList = Array.from(types).sort();

  const buckets: Record<string, number[]> = {};
  for (const t of typeList) buckets[t] = Array.from({ length: 60 }, () => 0);

  for (const e of events) {
    if (!e.emitted_at) continue;
    const t = new Date(e.emitted_at).getTime();
    if (t < start || t > now) continue;
    const idx = Math.floor((t - start) / 60_000);
    if (idx < 0 || idx >= 60) continue;
    if (buckets[e.event_type]) buckets[e.event_type][idx] += 1;
  }

  return typeList.map((t, i) => ({
    label: t,
    color: typeColor(t) ?? seriesColor(i),
    points: buckets[t].map((y, j) => ({ x: start + j * 60_000, y })),
  }));
}

function buildTopTypes(events: EventRow[]) {
  const grouped = new Map<string, number>();
  for (const e of events) grouped.set(e.event_type, (grouped.get(e.event_type) ?? 0) + 1);
  return Array.from(grouped.entries())
    .map(([label, value], i) => ({
      label,
      value,
      color: typeColor(label) ?? seriesColor(i),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

function buildTopAccounts(events: EventRow[]) {
  const grouped = new Map<string, number>();
  for (const e of events) {
    const k = e.account_id ? `#${e.account_id}` : '—';
    grouped.set(k, (grouped.get(k) ?? 0) + 1);
  }
  return Array.from(grouped.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}
