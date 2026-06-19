import { useMemo, useState } from 'react';
import Link from 'next/link';
import AdminLayout from '../../components/AdminLayout';
import GlobalScopeBadge from '../../components/GlobalScopeBadge';
import { useLive } from '../../lib/useLive';
import { adminPatch } from '../../lib/api';
import { fmtRelative } from '../../lib/format';
import { Heatmap } from '../../components/charts';
import { Section } from '@/components/admin/section';
import { Empty } from '@/components/admin/empty';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

// `/admin/cadences` returns the full (platform × product) matrix — including
// combos with no DB row yet, which surface their effective fallback so they're
// editable instead of invisible.
type Cadence = {
  platform: string;
  product: string;
  default_interval_seconds: number;
  sync_configured: boolean;
  refresh_interval_seconds: number;
  refresh_window_days: number;
  refresh_configured: boolean;
  updated_at: string | null;
};

// Only changed fields are PATCHed.
type CadencePatch = {
  interval_seconds?: number;
  refresh_interval_seconds?: number;
  refresh_window_days?: number;
};

type MutState = { busy: boolean; error: string | null };

type ProductHealth = {
  product?: string;
  override_active?: boolean;
  next_run_at?: string | null;
};

type AdminAccount = {
  id: string;
  platform: string;
  handle?: string | null;
  connection_flow?: string | null;
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

const INTERVAL_PRESETS: Array<{ label: string; s: number }> = [
  { label: '15m', s: 900 },
  { label: '30m', s: 1800 },
  { label: '1h', s: 3600 },
  { label: '6h', s: 21600 },
  { label: '24h', s: 86400 },
];

const MIN_INTERVAL = 60;
const MAX_INTERVAL = 30 * 86_400;
const MIN_WINDOW_DAYS = 1;
const MAX_WINDOW_DAYS = 365;

export default function CadencePage() {
  const cadencesLive = useLive<Cadence[]>('/admin/cadences', 5000);
  const accountsLive = useLive<AdminAccount[]>('/admin/accounts', 8000);
  const nextRunsLive = useLive<NextRun[]>(
    '/admin/next-runs?horizon_hours=24',
    8000,
  );

  const [tab, setTab] = useState('defaults');
  const [err, setErr] = useState<string | null>(null);
  const [mutState, setMutState] = useState<Record<string, MutState>>({});
  const [filter, setFilter] = useState('');
  const [openPlatforms, setOpenPlatforms] = useState<Set<string>>(new Set());

  const cadences = cadencesLive.data ?? [];
  const accounts = accountsLive.data ?? [];
  const nextRuns = nextRunsLive.data ?? [];

  const heatmap = useMemo(() => buildScheduleHeatmap(nextRuns), [nextRuns]);
  const overrides = useMemo(() => collectOverrides(accounts), [accounts]);

  // Backend already sorts platform asc → product asc; group consecutively.
  const groups = useMemo(() => groupByPlatform(cadences), [cadences]);
  const q = filter.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!q) return groups;
    return groups
      .map((g) => ({
        platform: g.platform,
        rows: g.rows.filter(
          (r) =>
            g.platform.toLowerCase().includes(q) ||
            r.product.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.rows.length > 0);
  }, [groups, q]);

  // Collapsed by default so the editor scales to many platforms; an active
  // filter force-expands every matching platform.
  const isOpen = (platform: string) => q !== '' || openPlatforms.has(platform);
  const togglePlatform = (platform: string) =>
    setOpenPlatforms((s) => {
      const next = new Set(s);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });

  const saveCadence = async (
    platform: string,
    product: string,
    patch: CadencePatch,
  ) => {
    const k = `${platform}:${product}`;
    setMutState((s) => ({ ...s, [k]: { busy: true, error: null } }));
    setErr(null);
    try {
      await adminPatch(`/admin/cadences/${platform}/${product}`, patch);
      setMutState((s) => ({ ...s, [k]: { busy: false, error: null } }));
      cadencesLive.refresh();
    } catch (e) {
      const msg = (e as Error).message;
      setMutState((s) => ({ ...s, [k]: { busy: false, error: msg } }));
      setErr(msg);
    }
  };

  return (
    <AdminLayout title="Cadence">
      <GlobalScopeBadge reason="Default cadences are defined per (platform × product) and apply to every workspace. Per-account overrides are visible at the bottom regardless of the topbar selection." />
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
            description="Per (platform × product): SYNC interval (how often we poll) + REFRESH cadence (engagement-refresh emit throttle + look-back window). Grouped by platform (click to expand); type to filter. Only changed fields are saved."
          >
            {cadences.length === 0 ? (
              <Empty message="No cadences registered yet." />
            ) : (
              <div className="space-y-3">
                <Input
                  placeholder="Filter platform / product…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="max-w-xs"
                  aria-label="Filter cadences"
                />
                {filteredGroups.length === 0 ? (
                  <Empty message="No cadences match the filter." />
                ) : (
                  <div className="space-y-2">
                    {filteredGroups.map((g) => (
                      <PlatformGroup
                        key={g.platform}
                        platform={g.platform}
                        rows={g.rows}
                        expanded={isOpen(g.platform)}
                        onToggle={togglePlatform}
                        mutState={mutState}
                        onSave={saveCadence}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="schedule">
          <Section
            title="Upcoming sync schedule · next 24h"
            description="One row per cuenta · one cell per hour. The number is total syncs (across all products) that account fires that hour. Brighter = busier."
          >
            {heatmap.rows.length === 0 ? (
              <Empty message="No upcoming syncs in the next 24h." />
            ) : (
              <Heatmap
                rows={heatmap.rows}
                cols={heatmap.cols}
                cells={heatmap.cells}
                cellSize={14}
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

// ── Defaults: collapsible per-platform groups ───────────────────────────────────

function PlatformGroup({
  platform,
  rows,
  expanded,
  onToggle,
  mutState,
  onSave,
}: {
  platform: string;
  rows: Cadence[];
  expanded: boolean;
  onToggle: (platform: string) => void;
  mutState: Record<string, MutState>;
  onSave: (p: string, prod: string, patch: CadencePatch) => Promise<void>;
}) {
  const customCount = rows.filter(
    (r) => r.sync_configured || r.refresh_configured,
  ).length;

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => onToggle(platform)}
        aria-expanded={expanded}
        aria-label={`Toggle ${platform} cadences`}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-secondary/30"
      >
        <span className="w-3 shrink-0 text-muted-foreground" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
        <Badge variant="outline">{platform}</Badge>
        <span className="text-xs text-muted-foreground">
          {rows.length} products
        </span>
        {customCount > 0 && (
          <span className="text-xs text-primary">· {customCount} custom</span>
        )}
      </button>
      <div
        className={cn(
          'divide-y divide-border/40 border-t border-border px-3',
          !expanded && 'hidden',
        )}
      >
        {rows.map((c) => (
          <CadenceRow
            key={`${c.platform}:${c.product}`}
            cadence={c}
            mut={
              mutState[`${c.platform}:${c.product}`] ?? {
                busy: false,
                error: null,
              }
            }
            onSave={onSave}
          />
        ))}
      </div>
    </div>
  );
}

// Each row tracks its own local sync interval, refresh interval and refresh
// window so values can be typed without committing. Save sends only the fields
// that differ from server state.
function CadenceRow({
  cadence,
  mut,
  onSave,
}: {
  cadence: Cadence;
  mut: MutState;
  onSave: (p: string, prod: string, patch: CadencePatch) => Promise<void>;
}) {
  const [sync, setSync] = useState(cadence.default_interval_seconds);
  const [refresh, setRefresh] = useState(cadence.refresh_interval_seconds);
  const [windowDays, setWindowDays] = useState(cadence.refresh_window_days);

  const patch = useMemo<CadencePatch>(() => {
    const p: CadencePatch = {};
    if (sync !== cadence.default_interval_seconds) p.interval_seconds = sync;
    if (refresh !== cadence.refresh_interval_seconds)
      p.refresh_interval_seconds = refresh;
    if (windowDays !== cadence.refresh_window_days)
      p.refresh_window_days = windowDays;
    return p;
  }, [sync, refresh, windowDays, cadence]);

  const dirty = Object.keys(patch).length > 0;
  const configured = cadence.sync_configured || cadence.refresh_configured;

  return (
    <div className="py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-mono text-xs font-semibold">{cadence.product}</span>
        <Badge
          variant={configured ? 'primary' : 'outline'}
          className="px-1.5 py-0 text-[9px]"
        >
          {configured ? 'custom' : 'default'}
        </Badge>
        <Button
          size="sm"
          variant={dirty ? 'default' : 'outline'}
          disabled={!dirty || mut.busy}
          onClick={() => {
            if (dirty && !mut.busy)
              void onSave(cadence.platform, cadence.product, patch);
          }}
          className={cn('ml-auto', !dirty && 'opacity-50')}
        >
          {mut.busy ? '…' : 'Save'}
        </Button>
      </div>

      <IntervalField
        label="sync"
        idPrefix={`${cadence.platform}-${cadence.product}-sync`}
        value={sync}
        onChange={setSync}
      />

      <div className="mt-1.5">
        <IntervalField
          label="refresh"
          idPrefix={`${cadence.platform}-${cadence.product}-refresh`}
          value={refresh}
          onChange={setRefresh}
        />
        <div className="mt-1 flex items-center gap-2">
          <span className="w-14 shrink-0 text-[10px] text-muted-foreground">
            window
          </span>
          <Input
            type="number"
            value={windowDays}
            min={MIN_WINDOW_DAYS}
            max={MAX_WINDOW_DAYS}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            className="h-8 w-24 font-mono text-xs"
            aria-label={`${cadence.platform} ${cadence.product} refresh window in days`}
          />
          <span className="text-[10px] text-muted-foreground">days</span>
        </div>
      </div>

      {mut.error && (
        <div
          className="mt-1 truncate text-[10px] text-danger"
          role="alert"
          title={mut.error}
        >
          {mut.error}
        </div>
      )}
    </div>
  );
}

// A labelled interval editor: presets + numeric seconds input + human label.
function IntervalField({
  label,
  idPrefix,
  value,
  onChange,
}: {
  label: string;
  idPrefix: string;
  value: number;
  onChange: (s: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-14 shrink-0 text-[10px] text-muted-foreground">
        {label}
      </span>
      <div
        className="flex flex-wrap gap-1"
        role="group"
        aria-label={`${label} presets`}
      >
        {INTERVAL_PRESETS.map((p) => (
          <Button
            key={p.label}
            variant={value === p.s ? 'default' : 'outline'}
            size="sm"
            className="h-7 px-2 text-[10px]"
            onClick={() => onChange(p.s)}
          >
            {p.label}
          </Button>
        ))}
      </div>
      <Input
        type="number"
        value={value}
        min={MIN_INTERVAL}
        max={MAX_INTERVAL}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 w-28 font-mono text-xs"
        aria-label={`${idPrefix} interval in seconds`}
      />
      <span className="text-[10px] text-muted-foreground">
        {humanInterval(value)}
      </span>
    </div>
  );
}

function groupByPlatform(
  cadences: Cadence[],
): Array<{ platform: string; rows: Cadence[] }> {
  const groups: Array<{ platform: string; rows: Cadence[] }> = [];
  for (const c of cadences) {
    const last = groups[groups.length - 1];
    if (last && last.platform === c.platform) {
      last.rows.push(c);
    } else {
      groups.push({ platform: c.platform, rows: [c] });
    }
  }
  return groups;
}

// ── Overrides ───────────────────────────────────────────────────────────────────

type Override = {
  accountId: string;
  accountHandle?: string | null;
  platform: string;
  connectionFlow?: string | null;
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
          connectionFlow: a.connection_flow,
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
              <div className="flex items-center gap-1.5">
                <span>{o.accountHandle ?? `Account ${o.accountId}`}</span>
                <ConnectionFlowBadge flow={o.connectionFlow} />
              </div>
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
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
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
  // 24-column horizon, one column per hour. Within a 24h window each hour
  // string appears at most once so a plain `HH` is unambiguous.
  const cols = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(now.getTime() + i * 3600_000);
    return pad2(d.getHours());
  });

  // Aggregate BY ACCOUNT (not by account+product). Cell value = total syncs
  // this account fires in that hour, summed over all products.
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
    const rowLabel = `${r.accountHandle ?? `#${r.accountId}`} (${r.platform})`;
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
