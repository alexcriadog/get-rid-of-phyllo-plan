import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart3 } from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { useLive } from '../../lib/useLive';
import { Empty } from '@/components/admin/empty';
import { Card, CardContent } from '@/components/ui/card';

type UsageResponse = {
  days: string[];
  workspaces: Array<{
    id: string;
    slug: string;
    name: string;
    counts: number[];
    total: number;
  }>;
};

const RANGES = [
  { label: '7d', days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

export default function UsagePage() {
  const [days, setDays] = useState(7);
  const { data, error, loading } = useLive<UsageResponse>(
    `/admin/usage?days=${days}`,
    10_000,
  );

  const maxCount = useMemo(() => {
    if (!data) return 0;
    let m = 0;
    for (const ws of data.workspaces) {
      for (const c of ws.counts) if (c > m) m = c;
    }
    return m;
  }, [data]);

  return (
    <AdminLayout
      title="Usage telemetry"
      actions={
        <div className="flex items-center gap-1">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setDays(r.days)}
              className={
                'rounded-md border px-2 py-1 text-xs transition-colors ' +
                (days === r.days
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border bg-secondary/30 text-muted-foreground hover:text-foreground')
              }
            >
              {r.label}
            </button>
          ))}
        </div>
      }
    >
      {error && (
        <div className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
          ↯ {error}
        </div>
      )}

      {!loading && (!data || data.workspaces.length === 0) ? (
        <Empty
          icon={<BarChart3 className="h-6 w-6" />}
          message="No telemetry yet — counters populate as workspaces start hitting /v1/*."
        />
      ) : data ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-secondary/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="sticky left-0 z-10 bg-secondary/30 px-3 py-2">
                      Workspace
                    </th>
                    {data.days.map((d) => (
                      <th
                        key={d}
                        className="px-2 py-2 text-right font-mono text-[10px]"
                      >
                        {d.slice(5)}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.workspaces.map((ws) => (
                    <tr key={ws.id} className="border-b border-border/40">
                      <td className="sticky left-0 z-10 bg-background px-3 py-2">
                        <Link
                          href={`/admin/workspaces/${ws.slug}`}
                          className="font-medium hover:underline"
                        >
                          {ws.name}
                        </Link>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {ws.slug}
                        </div>
                      </td>
                      {ws.counts.map((c, i) => (
                        <td
                          key={i}
                          className="px-2 py-2 text-right font-mono text-xs"
                          title={`${data.days[i]}: ${c.toLocaleString()} requests`}
                        >
                          {c === 0 ? (
                            <span className="text-muted-foreground/40">·</span>
                          ) : (
                            <HeatCell count={c} max={maxCount} />
                          )}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-mono font-semibold">
                        {ws.total.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <p className="mt-4 text-[11px] text-muted-foreground">
        Counts every /v1/* request per workspace per UTC day. Retained 90 days
        in Redis; older buckets are dropped automatically.
      </p>
    </AdminLayout>
  );
}

function HeatCell({ count, max }: { count: number; max: number }) {
  const intensity = max > 0 ? Math.min(1, count / max) : 0;
  const bg = `rgba(60, 255, 208, ${(intensity * 0.7).toFixed(2)})`;
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5"
      style={{ background: bg }}
    >
      {count.toLocaleString()}
    </span>
  );
}
