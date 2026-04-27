import { useMemo, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { useLive } from '../../lib/useLive';
import { fmtRelative, fmtTime } from '../../lib/format';
import { Timeline, STATUS_COLORS } from '../../components/charts';
import { Section } from '@/components/admin/section';
import { Empty } from '@/components/admin/empty';
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
  accountId: string;
  accountHandle?: string | null;
  platform: string;
  product: string;
  next_run_at: string;
  status?: string;
  failure_count?: number;
};

const TAB_HOURS: Record<string, number> = {
  '6h': 6,
  '24h': 24,
  '72h': 72,
};

export default function NextRunsPage() {
  const [tab, setTab] = useState<'6h' | '24h' | '72h'>('24h');
  const horizonHours = TAB_HOURS[tab] ?? 24;

  const { data, error } = useLive<NextRun[]>(
    `/admin/next-runs?horizon_hours=${horizonHours}`,
    8000,
  );

  const rows = data ?? [];

  const { timelineRows, timelineEvents, startMs, endMs } = useMemo(() => {
    const now = Date.now();
    const start = now;
    const end = now + horizonHours * 3600_000;
    const rowMap = new Map<string, { id: string; label: string }>();
    const events: Array<{
      rowId: string;
      startMs: number;
      endMs: number;
      tone: 'ok' | 'warn' | 'danger' | 'info';
      title: string;
      meta: Array<{ label: string; value: string }>;
    }> = [];

    for (const r of rows) {
      const t = new Date(r.next_run_at).getTime();
      if (isNaN(t) || t < start || t > end) continue;
      const rowId = `${r.accountId}:${r.product}`;
      const label = `${r.accountHandle ?? `#${r.accountId}`} · ${r.product}`;
      if (!rowMap.has(rowId)) rowMap.set(rowId, { id: rowId, label });
      const tone: 'ok' | 'warn' | 'danger' | 'info' =
        (r.failure_count ?? 0) >= 3
          ? 'danger'
          : (r.failure_count ?? 0) > 0
            ? 'warn'
            : 'info';
      events.push({
        rowId,
        startMs: t,
        endMs: t + 4 * 60_000,
        tone,
        title: r.product,
        meta: [
          { label: 'platform', value: r.platform },
          { label: 'fires', value: fmtTime(r.next_run_at) ?? '—' },
          { label: 'status', value: r.status ?? 'idle' },
          { label: 'fails', value: String(r.failure_count ?? 0) },
        ],
      });
    }
    return {
      timelineRows: Array.from(rowMap.values()).sort((a, b) =>
        a.label.localeCompare(b.label),
      ),
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
            description="Each marker is one scheduled (account, product) run. Color = health."
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
                          <div>{r.accountHandle ?? `#${r.accountId}`}</div>
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
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Section>
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}
