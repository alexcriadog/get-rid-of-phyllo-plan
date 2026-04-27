import { useEffect, useMemo, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { useLive } from '../../lib/useLive';
import { CONNECTOR_API_URL } from '../../lib/api';
import { fmtTime, fmtNumber } from '../../lib/format';
import { Section } from '@/components/admin/section';
import { Empty } from '@/components/admin/empty';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type RawResponse = {
  id: string;
  accountId?: string;
  platform?: string;
  endpoint?: string;
  contentHash?: string;
  sizeBytes?: number;
  fetchedAt?: string;
};

type RawDetail = RawResponse & {
  body?: unknown;
};

export default function RawResponsesPage() {
  const { data, error } = useLive<RawResponse[]>('/admin/raw-responses?limit=200', 5000);

  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = data ?? [];
  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (platform !== 'all' && r.platform !== platform) return false;
        if (search && !(r.endpoint ?? '').toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    [rows, search, platform],
  );

  const platforms = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.platform) set.add(r.platform);
    return Array.from(set);
  }, [rows]);

  const totalBytes = useMemo(
    () => filtered.reduce((a, r) => a + (r.sizeBytes ?? 0), 0),
    [filtered],
  );

  return (
    <AdminLayout title="Raw responses">
      {error && !data && (
        <div className="mb-5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Input
            placeholder="Filter endpoint…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-[220px] flex-1"
          />
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Platform</span>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger className="h-9 w-[160px] font-mono text-xs">
                <SelectValue placeholder="all" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all</SelectItem>
                {platforms.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="ml-auto font-mono text-[10.5px] text-muted-foreground/70">
            {filtered.length} rows · {fmtBytes(totalBytes)}
          </span>
        </CardContent>
      </Card>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Section title="Captured responses" className="mb-0">
          {filtered.length === 0 ? (
            <Empty message="No responses captured yet." />
          ) : (
            <ScrollArea className="h-[540px] rounded-md border border-border bg-secondary/30">
              <div className="sticky top-0 z-10 grid grid-cols-[64px_72px_1fr_64px] gap-3 border-b border-border bg-card/95 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 backdrop-blur">
                <span>Time</span>
                <span>Platform</span>
                <span>Endpoint</span>
                <span className="text-right">Size</span>
              </div>
              <div className="divide-y divide-border/60">
                {filtered.map((r) => {
                  const active = selectedId === r.id;
                  return (
                    <button
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className={cn(
                        'grid w-full grid-cols-[64px_72px_1fr_64px] items-center gap-3 border-l-[3px] px-3 py-1.5 text-left font-mono text-[11.5px] transition-colors',
                        active
                          ? 'border-l-primary bg-primary/10 text-foreground'
                          : 'border-l-transparent text-foreground/90 hover:bg-secondary/60',
                      )}
                    >
                      <span className="text-muted-foreground/80">{fmtTime(r.fetchedAt)}</span>
                      <Badge variant="default" className="justify-center">
                        {r.platform ?? '—'}
                      </Badge>
                      <span className="truncate" title={r.endpoint}>
                        {r.endpoint}
                      </span>
                      <span className="text-right text-[10.5px] text-muted-foreground/80">
                        {fmtBytes(r.sizeBytes ?? 0)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </Section>

        <Section title="Body inspector" className="mb-0">
          {selectedId ? (
            <BodyViewer id={selectedId} />
          ) : (
            <Empty message="Select a row to inspect its raw body." />
          )}
        </Section>
      </div>
    </AdminLayout>
  );
}

function BodyViewer({ id }: { id: string }) {
  const [data, setData] = useState<RawDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${CONNECTOR_API_URL}/admin/raw-responses/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((j) => {
        if (!cancelled) setData(j as RawDetail);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return <div className="text-xs text-muted-foreground">Loading…</div>;
  }
  if (error) {
    return (
      <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
        {error}
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="info">{data.platform ?? '—'}</Badge>
        <Badge variant="default">#{data.accountId ?? '—'}</Badge>
        <Badge variant="default">{fmtBytes(data.sizeBytes ?? 0)}</Badge>
        <Badge variant="default">{fmtTime(data.fetchedAt)}</Badge>
      </div>
      <div className="break-all font-mono text-[11px] text-muted-foreground">
        {data.endpoint}
      </div>
      {data.contentHash && (
        <div className="break-all font-mono text-[10px] text-muted-foreground/70">
          sha256: {data.contentHash}
        </div>
      )}
      <pre className="max-h-[480px] overflow-auto rounded-md border border-border bg-secondary/40 p-4 font-mono text-[11.5px] leading-relaxed">
        {JSON.stringify(data.body ?? data, null, 2)}
      </pre>
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${fmtNumber(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
