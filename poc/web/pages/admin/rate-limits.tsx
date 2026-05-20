import { useMemo, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import GlobalScopeBadge from '../../components/GlobalScopeBadge';
import { useLive } from '../../lib/useLive';
import { adminPost } from '../../lib/api';
import {
  Gauge,
  Sparkline,
  HBarChart,
  STATUS_COLORS,
  compactNumber,
} from '../../components/charts';
import { Section } from '@/components/admin/section';
import { Empty } from '@/components/admin/empty';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type BucketAccount = {
  id: string;
  platform: string;
  handle: string | null;
  display_name: string | null;
};

type Bucket = {
  key: string;
  platform: string;
  scope?: string;
  tokens: number;
  capacity: number;
  hits?: number;
  denies?: number;
  account?: BucketAccount | null;
};

type BucketHistory = {
  key: string;
  samples: Array<{ ts: string; tokens: number }>;
};

export default function RateLimitsPage() {
  const { data, refresh } = useLive<Bucket[]>('/admin/rate-buckets', 2500);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState<string>('all');

  const buckets = data ?? [];
  const platformsSet = useMemo(() => {
    const s = new Set<string>(['all']);
    for (const b of buckets) if (b.platform) s.add(b.platform);
    return Array.from(s);
  }, [buckets]);

  const filtered = useMemo(
    () =>
      buckets.filter((b) => {
        if (platform !== 'all' && b.platform !== platform) return false;
        if (search && !b.key.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    [buckets, search, platform],
  );

  const denyRanking = useMemo(
    () =>
      buckets
        .filter((b) => (b.denies ?? 0) > 0)
        .sort((a, b) => (b.denies ?? 0) - (a.denies ?? 0))
        .slice(0, 8)
        .map((b) => ({
          label: rankingLabel(b),
          value: b.denies ?? 0,
          color: STATUS_COLORS.warn,
        })),
    [buckets],
  );

  const reset = async (key: string) => {
    setBusy(key);
    setErr(null);
    try {
      await adminPost(`/admin/rate-buckets/${encodeURIComponent(key)}/reset`, {});
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminLayout title="Rate buckets">
      <GlobalScopeBadge reason="Rate buckets live at the account / app-token level. The topbar workspace filter doesn't apply here — every bucket across every workspace is shown." />
      {err && (
        <div className="mb-5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {err}
        </div>
      )}

      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Input
            placeholder="Filter by key…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-[220px] flex-1"
          />
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Platform</span>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger className="w-[160px] font-mono text-xs">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                {platformsSet.map((p) => (
                  <SelectItem key={p} value={p} className="font-mono text-xs">
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="ml-auto font-mono text-[10.5px] text-muted-foreground/70">
            {filtered.length} of {buckets.length}
          </span>
        </CardContent>
      </Card>

      {denyRanking.length > 0 && (
        <Section
          title="Top buckets by denies"
          description="Buckets that have been throttling traffic"
        >
          <HBarChart items={denyRanking} showPct={false} />
        </Section>
      )}

      <BucMirrorPanel />

      <Section
        title="All rate buckets"
        description="Click Reset to refill a bucket immediately."
      >
        {filtered.length === 0 ? (
          <Empty message="No buckets yet — they register on the first API call to that scope." />
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
            {filtered.map((b) => (
              <BucketCard
                key={b.key}
                bucket={b}
                busy={busy === b.key}
                onReset={() => reset(b.key)}
              />
            ))}
          </div>
        )}
      </Section>
    </AdminLayout>
  );
}

function BucketCard({
  bucket,
  busy,
  onReset,
}: {
  bucket: Bucket;
  busy: boolean;
  onReset: () => void;
}) {
  const tokens = Math.round(bucket.tokens);
  const capacity = bucket.capacity || 0;
  const hasCapacity = capacity > 0;
  const ratio = hasCapacity ? tokens / capacity : 0;
  const tone: 'ok' | 'warn' | 'danger' = !hasCapacity
    ? 'ok'
    : ratio > 0.5
      ? 'ok'
      : ratio > 0.2
        ? 'warn'
        : 'danger';
  const history = useBucketHistory(bucket.key);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-secondary/40 p-4">
      <div className="flex min-h-[140px] items-center justify-center">
        {hasCapacity ? (
          <Gauge value={tokens} max={capacity} size={140} tone={tone} />
        ) : (
          <UnmeteredDisplay tokens={tokens} />
        )}
      </div>

      <div className="text-center">
        <div className="mb-1 flex items-center justify-center gap-2 font-mono text-xs">
          <Badge variant="outline">{bucket.platform}</Badge>
          <span className="text-muted-foreground/70">{scopeLabel(bucket)}</span>
        </div>
        <div className="mb-1 min-h-[18px]">
          {bucket.account ? (
            <div className="flex flex-col items-center gap-0.5">
              <span className="font-mono text-[12px] font-semibold text-foreground">
                {bucket.account.handle ?? bucket.account.display_name ?? `account #${bucket.account.id}`}
              </span>
              {bucket.account.display_name && bucket.account.handle && (
                <span className="font-mono text-[10px] text-muted-foreground/70">
                  {bucket.account.display_name}
                </span>
              )}
            </div>
          ) : isAppWide(bucket) ? (
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              app-wide · all accounts
            </span>
          ) : (
            <span className="font-mono text-[10px] text-muted-foreground/70" title={bucket.key}>
              {idHashTail(bucket)}
            </span>
          )}
        </div>
        <div className="font-mono text-[10px] text-muted-foreground">
          hits {compactNumber(bucket.hits ?? 0)} · denies{' '}
          {compactNumber(bucket.denies ?? 0)}
        </div>
        {!hasCapacity && (
          <div className="mt-1 font-mono text-[10px] text-muted-foreground/70">
            capacity reported once worker calls the platform
          </div>
        )}
      </div>

      {history.length > 1 && (
        <div>
          <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/70">
            tokens · last 60min
          </div>
          <Sparkline points={history} color={STATUS_COLORS[tone]} height={32} />
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        className="mt-auto w-full"
        onClick={onReset}
        disabled={busy}
      >
        {busy ? 'resetting…' : '↻ Reset bucket'}
      </Button>
    </div>
  );
}

function UnmeteredDisplay({ tokens }: { tokens: number }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="font-mono text-4xl font-semibold leading-none text-foreground">
        {tokens}
      </div>
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
        tokens
      </div>
      <Badge variant="outline" className="mt-1.5">
        unmetered
      </Badge>
    </div>
  );
}

function shortKey(b: Bucket): string {
  if (b.scope) return b.scope;
  return b.key.split(':').slice(-2).join(':');
}

/** Label for the deny-ranking bar chart — prefer account handle over bucket key. */
function rankingLabel(b: Bucket): string {
  if (b.account?.handle) return `${b.account.handle} · ${scopeLabel(b)}`;
  if (b.account?.display_name) return `${b.account.display_name} · ${scopeLabel(b)}`;
  if (isAppWide(b)) return `${b.platform} · app-wide`;
  return shortKey(b);
}

/** Human-readable label for the bucket's scope segment ('app', 'user_token', 'page', etc.). */
function scopeLabel(b: Bucket): string {
  if (b.scope) return b.scope.replace(/_/g, ' ');
  // Fallback: parse from key. Strip the namespace + 'rate' + platform prefix
  // and take the next segment, which is the scope.
  const parts = b.key.split(':');
  const rateIdx = parts.indexOf('rate');
  return rateIdx >= 0 && parts[rateIdx + 2] ? parts[rateIdx + 2].replace(/_/g, ' ') : 'bucket';
}

function isAppWide(b: Bucket): boolean {
  // app-level buckets have no per-account suffix — keys end at the scope segment.
  // e.g. `connector-poc:rate:fb:app`, `connector-poc:rate:tt:qps_app`
  return /:(?:app|qps_app)$/.test(b.key);
}

/** Last few chars of the id hash for keys that have one but no account match. */
function idHashTail(b: Bucket): string {
  const parts = b.key.split(':');
  const tail = parts[parts.length - 1] ?? '';
  return tail.length > 12 ? `…${tail.slice(-8)}` : tail;
}

function useBucketHistory(key: string) {
  const path = `/admin/rate-buckets/history?key=${encodeURIComponent(key)}&mins=60`;
  const { data } = useLive<BucketHistory>(path, 5000);
  if (!data || !data.samples) return [];
  return data.samples.map((s) => ({
    x: new Date(s.ts).getTime(),
    y: s.tokens,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Meta BUC mirror panel — Phase 1-3 of the rate-limit mirror.
// Reads /admin/rate-limits, which returns the snapshot maintained by
// BucTelemetryService from X-App-Usage and X-Business-Use-Case-Usage on
// every Meta response. This is what actually gates IG/FB calls today —
// the legacy buckets shown below are only the local runaway fuse.
// ──────────────────────────────────────────────────────────────────────────

type MirrorBucket = {
  scopeKey: string;       // e.g. 'app:273356382408695' or 'asset:17841...'
  source: 'app' | 'buc';
  type: string;            // 'instagram' | 'pages' | 'threads' | 'app'
  callCountPct: number;    // 0-100
  totalTimePct: number;
  totalCpuPct: number;
  retryAfterMs: number;    // Meta-supplied estimated_time_to_regain_access in ms
  lastSeenAt: number;      // epoch ms
};

type MirrorSnapshot = {
  generated_at: string;
  buckets: MirrorBucket[];
};

function BucMirrorPanel() {
  const { data, refresh } = useLive<MirrorSnapshot>('/admin/rate-limits', 5000);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const buckets = data?.buckets ?? [];

  const replay = async () => {
    setBusy(true);
    setErr(null);
    try {
      await adminPost('/admin/rate-limits/replay', { since_hours: 24 });
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Meta BUC mirror"
      description="Live state of Meta's own rate-limit headers (X-App-Usage + X-Business-Use-Case-Usage). This is the primary gate for IG/FB calls. Threshold for deny: 75% of call_count, or any retry-after > 0."
    >
      <div className="mb-3 flex items-center gap-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={replay}
              disabled={busy}
              variant="outline"
              className="text-xs"
            >
              {busy ? 'Rebuilding…' : 'Rebuild buckets from logs'}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[320px] text-left">
            <div className="space-y-1">
              <div className="font-semibold">What does this button do?</div>
              <div className="opacity-90">
                Rebuilds Meta&apos;s rate-limit buckets (BUC) from the API
                call logs of the last 24 hours. Only useful if the Redis
                snapshot was lost (e.g. after a container restart) and you
                want to rebuild it without waiting for the next sync. In
                normal operation you don&apos;t need to touch it — buckets
                update on every Meta API call.
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
        {data?.generated_at && (
          <span className="font-mono text-[10.5px] text-muted-foreground/70">
            generated {data.generated_at}
          </span>
        )}
        {err && <span className="text-xs text-danger">{err}</span>}
      </div>
      {buckets.length === 0 ? (
        <Empty message="No BUC mirror state yet. Run a Meta sync, or replay from api_call_log." />
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {buckets.map((b) => (
            <MirrorCard key={b.scopeKey} bucket={b} />
          ))}
        </div>
      )}
    </Section>
  );
}

function MirrorCard({ bucket }: { bucket: MirrorBucket }) {
  const pct = Math.round(bucket.callCountPct);
  const tone: 'ok' | 'warn' | 'danger' =
    pct >= 75 || bucket.retryAfterMs > 0
      ? 'danger'
      : pct >= 50
        ? 'warn'
        : 'ok';
  const ageMs = Date.now() - bucket.lastSeenAt;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-secondary/40 p-4">
      <div className="flex min-h-[140px] items-center justify-center">
        <Gauge value={pct} max={100} size={140} tone={tone} />
      </div>
      <div className="text-center">
        <div className="mb-1 flex items-center justify-center gap-2 font-mono text-xs">
          <Badge variant="outline">{bucket.type}</Badge>
          <span className="text-muted-foreground/70">{bucket.source}</span>
        </div>
        <div
          className="mb-1 font-mono text-[11px] text-foreground"
          title={bucket.scopeKey}
        >
          {bucket.scopeKey}
        </div>
        <div className="font-mono text-[10px] text-muted-foreground">
          time {Math.round(bucket.totalTimePct)}% · cpu{' '}
          {Math.round(bucket.totalCpuPct)}% · seen {formatAge(ageMs)}
        </div>
        {bucket.retryAfterMs > 0 && (
          <div className="mt-1 font-mono text-[10px] text-danger">
            Meta retry-after: {Math.round(bucket.retryAfterMs / 1000)}s
          </div>
        )}
      </div>
    </div>
  );
}

function formatAge(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}
