import { useMemo, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
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
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Bucket = {
  key: string;
  platform: string;
  scope?: string;
  tokens: number;
  capacity: number;
  hits?: number;
  denies?: number;
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
          label: shortKey(b),
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
          <span>{shortKey(bucket)}</span>
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

function useBucketHistory(key: string) {
  const path = `/admin/rate-buckets/history?key=${encodeURIComponent(key)}&mins=60`;
  const { data } = useLive<BucketHistory>(path, 5000);
  if (!data || !data.samples) return [];
  return data.samples.map((s) => ({
    x: new Date(s.ts).getTime(),
    y: s.tokens,
  }));
}
