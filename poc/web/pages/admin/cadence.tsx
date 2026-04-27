import { useMemo, useState } from 'react';
import Link from 'next/link';
import AdminLayout from '../../components/AdminLayout';
import { useLive } from '../../lib/useLive';
import { adminPatch } from '../../lib/api';
import { fmtRelative } from '../../lib/format';
import { Heatmap } from '../../components/charts';
import { Section } from '@/components/admin/section';
import { Empty } from '@/components/admin/empty';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

type Cadence = {
  platform: string;
  product: string;
  default_interval_seconds: number;
};

type ProductHealth = {
  product?: string;
  override_active?: boolean;
  next_run_at?: string | null;
};

type AdminAccount = {
  id: string;
  platform: string;
  handle?: string | null;
  sync_tier?: string;
  status?: string;
  products?: ProductHealth[] | Record<string, ProductHealth>;
};

type NextRun = {
  accountId: string;
  accountHandle?: string | null;
  platform: string;
  product: string;
  next_run_at: string;
};

const PRESETS: Array<{ label: string; s: number }> = [
  { label: '30m', s: 1800 },
  { label: '1h', s: 3600 },
  { label: '2h', s: 7200 },
  { label: '6h', s: 21600 },
  { label: '24h', s: 86400 },
];

export default function CadencePage() {
  const cadencesLive = useLive<Cadence[]>('/admin/cadences', 5000);
  const accountsLive = useLive<AdminAccount[]>('/admin/accounts', 8000);
  const nextRunsLive = useLive<NextRun[]>(
    '/admin/next-runs?horizon_hours=24',
    8000,
  );

  const [tab, setTab] = useState('defaults');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const cadences = cadencesLive.data ?? [];
  const accounts = accountsLive.data ?? [];
  const nextRuns = nextRunsLive.data ?? [];

  const heatmap = useMemo(() => buildScheduleHeatmap(nextRuns), [nextRuns]);
  const overrides = useMemo(() => collectOverrides(accounts), [accounts]);

  const updateInterval = async (
    platform: string,
    product: string,
    intervalSeconds: number,
  ) => {
    const k = `${platform}:${product}`;
    setBusy(k);
    setErr(null);
    try {
      await adminPatch(`/admin/cadences/${platform}/${product}`, {
        interval_seconds: intervalSeconds,
      });
      cadencesLive.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminLayout title="Cadence">
      {err && (
        <div className="mb-5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {err}
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList>
          <TabsTrigger value="defaults">Defaults</TabsTrigger>
          <TabsTrigger value="schedule">Upcoming schedule</TabsTrigger>
          <TabsTrigger value="overrides">Active overrides</TabsTrigger>
        </TabsList>

        <TabsContent value="defaults">
          <Section
            title="Default cadences"
            description="Edit the interval applied to every account on this (platform, product). Per-account overrides are kept separately."
          >
            {cadences.length === 0 ? (
              <Empty message="No cadences registered yet." />
            ) : (
              <DefaultsTable
                cadences={cadences}
                busy={busy}
                onSave={updateInterval}
              />
            )}
          </Section>
        </TabsContent>

        <TabsContent value="schedule">
          <Section
            title="Upcoming sync schedule · next 24h"
            description="Each cell counts how many syncs are scheduled for that (account · product) in that hour."
          >
            {heatmap.rows.length === 0 ? (
              <Empty message="No upcoming syncs in the next 24h." />
            ) : (
              <Heatmap
                rows={heatmap.rows}
                cols={heatmap.cols}
                cells={heatmap.cells}
                cellSize={20}
                unitLabel="syncs"
              />
            )}
          </Section>
        </TabsContent>

        <TabsContent value="overrides">
          <Section
            title="Active per-account overrides"
            description="Products where the account-level override is currently active. To change them, open the account detail page."
          >
            {overrides.length === 0 ? (
              <Empty message="No active overrides — every account uses the default cadence." />
            ) : (
              <OverridesTable overrides={overrides} />
            )}
          </Section>
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}

function DefaultsTable({
  cadences,
  busy,
  onSave,
}: {
  cadences: Cadence[];
  busy: string | null;
  onSave: (platform: string, product: string, sec: number) => Promise<void>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Platform</TableHead>
          <TableHead>Product</TableHead>
          <TableHead className="text-right">Interval</TableHead>
          <TableHead>Quick presets</TableHead>
          <TableHead className="text-right">Save</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {cadences.map((c) => (
          <CadenceRow
            key={`${c.platform}:${c.product}`}
            cadence={c}
            busy={busy}
            onSave={onSave}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function CadenceRow({
  cadence,
  busy,
  onSave,
}: {
  cadence: Cadence;
  busy: string | null;
  onSave: (platform: string, product: string, sec: number) => Promise<void>;
}) {
  const [value, setValue] = useState(cadence.default_interval_seconds);
  const k = `${cadence.platform}:${cadence.product}`;
  const dirty = value !== cadence.default_interval_seconds;
  return (
    <TableRow className="font-mono text-xs">
      <TableCell>
        <Badge variant="outline">{cadence.platform}</Badge>
      </TableCell>
      <TableCell>{cadence.product}</TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          <Input
            type="number"
            value={value}
            min={60}
            max={30 * 86_400}
            onChange={(e) => setValue(Number(e.target.value))}
            className="h-8 w-[110px] text-right font-mono text-xs"
          />
          <span className="text-muted-foreground">
            s · {humanInterval(value)}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              variant={value === p.s ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2 text-[10px]"
              onClick={() => setValue(p.s)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          variant={dirty ? 'default' : 'outline'}
          disabled={!dirty || busy === k}
          onClick={() => onSave(cadence.platform, cadence.product, value)}
          className={cn(!dirty && 'opacity-50')}
        >
          {busy === k ? '…' : 'Save'}
        </Button>
      </TableCell>
    </TableRow>
  );
}

type Override = {
  accountId: string;
  accountHandle?: string | null;
  platform: string;
  product: string;
  nextRunAt?: string | null;
};

function collectOverrides(accounts: AdminAccount[]): Override[] {
  const out: Override[] = [];
  for (const a of accounts) {
    const products = normalizeProducts(a.products);
    for (const [product, p] of products.entries()) {
      if (p.override_active) {
        out.push({
          accountId: a.id,
          accountHandle: a.handle,
          platform: a.platform,
          product,
          nextRunAt: p.next_run_at ?? null,
        });
      }
    }
  }
  return out;
}

function OverridesTable({ overrides }: { overrides: Override[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Account</TableHead>
          <TableHead>Product</TableHead>
          <TableHead>Next run</TableHead>
          <TableHead className="text-right" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {overrides.map((o) => (
          <TableRow
            key={`${o.accountId}:${o.product}`}
            className="font-mono text-xs"
          >
            <TableCell>
              <div>{o.accountHandle ?? `Account ${o.accountId}`}</div>
              <div className="font-mono text-[10px] text-muted-foreground">
                {o.platform} · #{o.accountId}
              </div>
            </TableCell>
            <TableCell>{o.product}</TableCell>
            <TableCell className="text-muted-foreground">
              {fmtRelative(o.nextRunAt)}
            </TableCell>
            <TableCell className="text-right">
              <Button asChild variant="ghost" size="sm">
                <Link href={`/admin/accounts/${o.accountId}`}>
                  Open detail →
                </Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function humanInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = seconds / 60;
  if (m < 60) return `${m.toFixed(0)}m`;
  const h = m / 60;
  if (h < 24) return `${h.toFixed(h < 4 ? 1 : 0)}h`;
  return `${(h / 24).toFixed(0)}d`;
}

function normalizeProducts(
  raw: AdminAccount['products'],
): Map<string, ProductHealth> {
  const m = new Map<string, ProductHealth>();
  if (!raw) return m;
  if (Array.isArray(raw)) {
    for (const p of raw) {
      if (p.product) m.set(p.product, p);
    }
  } else {
    for (const [k, v] of Object.entries(raw)) {
      m.set(k, v);
    }
  }
  return m;
}

function buildScheduleHeatmap(runs: NextRun[]) {
  const now = new Date();
  const cols = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(now.getTime() + i * 3600_000);
    return pad2(d.getHours());
  });

  const rowSet = new Set<string>();
  const cellMap = new Map<string, number>();
  const start = now.getTime();
  const end = start + 24 * 3600_000;

  for (const r of runs) {
    if (!r.next_run_at) continue;
    const t = new Date(r.next_run_at).getTime();
    if (t < start || t > end) continue;
    const offsetH = Math.floor((t - start) / 3600_000);
    if (offsetH < 0 || offsetH >= 24) continue;
    const colHour = cols[offsetH];
    const rowLabel = `${r.accountHandle ?? `#${r.accountId}`} · ${r.product}`;
    rowSet.add(rowLabel);
    const k = `${rowLabel}::${colHour}`;
    cellMap.set(k, (cellMap.get(k) ?? 0) + 1);
  }

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
