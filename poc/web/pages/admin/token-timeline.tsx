import { useMemo, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { useLive } from '../../lib/useLive';
import { fmtDateTime, fmtRelative } from '../../lib/format';
import { STATUS_COLORS } from '../../components/charts';
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

type TimelineRow = {
  at: string;
  kind: string;
  account_id: string;
  platform: string | null;
  handle: string | null;
  expires_at: string | null;
  detail: string | null;
};

type TimelineResponse = { days: number; events: TimelineRow[] };

const KIND_FILTER = [
  'all',
  'connect',
  'refresh',
  'token.refresh_failed',
  'token.expired',
  'token.reauth_required',
  'token.recovered',
  'account.disconnected',
];
const DAYS_OPTIONS = ['7', '14', '30', '90'];
const ACCOUNT_ALL = 'all';

const ROW_GRID = 'grid-cols-[135px_180px_210px_170px_minmax(0,1fr)]';

export default function TokenTimelinePage() {
  const [days, setDays] = useState('14');
  const [kindFilter, setKindFilter] = useState('all');
  const [accountFilter, setAccountFilter] = useState(ACCOUNT_ALL);

  const { data } = useLive<TimelineResponse>(
    `/admin/token-timeline?days=${days}`,
    15_000,
  );

  const events = data?.events ?? [];
  const filtered = useMemo(
    () =>
      events.filter((e) => {
        if (kindFilter !== 'all' && e.kind !== kindFilter) return false;
        if (accountFilter !== ACCOUNT_ALL && e.account_id !== accountFilter) return false;
        return true;
      }),
    [events, kindFilter, accountFilter],
  );

  const accountOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) set.add(e.account_id);
    return Array.from(set).sort((a, b) => Number(a) - Number(b));
  }, [events]);

  const kindCounts = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const e of events) grouped.set(e.kind, (grouped.get(e.kind) ?? 0) + 1);
    return Array.from(grouped.entries()).sort((a, b) => b[1] - a[1]);
  }, [events]);

  return (
    <AdminLayout title="Token timeline">
      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <FilterSelect label="Window" value={days} onChange={setDays} options={DAYS_OPTIONS} formatOption={(v) => `${v}d`} triggerWidth="w-[90px]" />
          <FilterSelect label="Kind" value={kindFilter} onChange={setKindFilter} options={KIND_FILTER} />
          <FilterSelect
            label="Account"
            value={accountFilter}
            onChange={setAccountFilter}
            options={[ACCOUNT_ALL, ...accountOptions]}
            formatOption={(v) => (v === ACCOUNT_ALL ? 'all' : `#${v}`)}
            triggerWidth="w-[130px]"
          />
          <span className="ml-auto font-mono text-[10.5px] text-muted-foreground/70">
            {filtered.length} of {events.length}
          </span>
        </CardContent>
      </Card>

      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          {kindCounts.length === 0 ? (
            <span className="font-mono text-[11px] text-muted-foreground/70">
              No token activity in the last {days} days.
            </span>
          ) : (
            kindCounts.map(([kind, count]) => (
              <button
                key={kind}
                type="button"
                onClick={() => setKindFilter(kind === kindFilter ? 'all' : kind)}
                className="rounded-md border border-border bg-secondary/40 px-2 py-1 font-mono text-[11px]"
                style={kindStyle(kind)}
              >
                {kind} · {count}
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Section
        title={`Token lifecycle · last ${days} days`}
        description="Connects + successful refreshes from the token history, merged with refresh-failed / expired / reauth-recommended / recovered / disconnected signals"
        bare
      >
        <TimelineList events={filtered} />
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
  triggerWidth = 'w-[200px]',
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
        <SelectTrigger className={`h-8 ${triggerWidth} text-xs font-normal normal-case tracking-normal`}>
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

function TimelineList({ events }: { events: TimelineRow[] }) {
  if (events.length === 0) {
    return (
      <div className="p-5">
        <Empty message="No token events match this filter." />
      </div>
    );
  }
  return (
    <ScrollArea className="h-[560px] rounded-md border border-border bg-secondary/30">
      <div
        className={`grid ${ROW_GRID} sticky top-0 z-10 gap-3 border-b border-border bg-secondary px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground`}
      >
        <span>When</span>
        <span>Event</span>
        <span>Account</span>
        <span>New expiry</span>
        <span>Detail</span>
      </div>
      {events.map((e) => (
        <div
          key={`${e.kind}|${e.account_id}|${e.at}`}
          className={`grid ${ROW_GRID} items-center gap-3 border-b border-border/70 px-3 py-1.5 font-mono text-[11.5px] last:border-0`}
        >
          <span className="text-muted-foreground/70" title={e.at}>
            {fmtDateTime(e.at)}
          </span>
          <span style={kindStyle(e.kind)} className="truncate">
            {e.kind}
          </span>
          <span className="flex items-center gap-1.5 overflow-hidden">
            <Badge variant="default">#{e.account_id}</Badge>
            <span className="truncate text-muted-foreground/80">
              {e.platform ?? '—'}
              {e.handle ? ` · ${e.handle}` : ''}
            </span>
          </span>
          <span className="text-muted-foreground/80" title={e.expires_at ?? undefined}>
            {e.expires_at ? fmtRelative(e.expires_at) : '—'}
          </span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-muted-foreground/70">
            {e.detail ?? ''}
          </span>
        </div>
      ))}
    </ScrollArea>
  );
}

function kindColor(kind: string): string | null {
  if (kind === 'refresh' || kind === 'token.recovered') return STATUS_COLORS.ok;
  if (kind === 'connect') return STATUS_COLORS.info;
  if (kind === 'token.expired' || kind === 'account.disconnected') return STATUS_COLORS.danger;
  if (kind === 'token.refresh_failed' || kind === 'token.reauth_required') return STATUS_COLORS.warn;
  return null;
}

function kindStyle(kind: string): React.CSSProperties {
  const c = kindColor(kind);
  return c ? { color: c } : {};
}
