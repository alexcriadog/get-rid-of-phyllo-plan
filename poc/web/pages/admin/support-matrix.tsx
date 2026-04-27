import { useMemo, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { useLive } from '../../lib/useLive';
import { Section } from '@/components/admin/section';
import { KpiCard } from '@/components/admin/kpi-card';
import { Empty } from '@/components/admin/empty';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

type FieldSupport = 'supported' | 'empty_possible' | 'not_supported' | string;

type SupportMatrix = {
  platforms?: Record<string, Record<string, Record<string, FieldSupport>>>;
};

type Tone = 'ok' | 'warn' | 'danger';

export default function SupportMatrixPage() {
  const { data, error } = useLive<SupportMatrix>('/admin/support-matrix', 30000);

  const platforms = useMemo(() => {
    if (!data?.platforms) return [];
    return Object.keys(data.platforms);
  }, [data]);

  const [activePlatform, setActivePlatform] = useState<string>('');
  const platform = activePlatform || platforms[0] || '';

  const products = useMemo(() => {
    if (!data?.platforms?.[platform]) return [];
    return Object.entries(data.platforms[platform]);
  }, [data, platform]);

  const summary = useMemo(() => buildSummary(data), [data]);

  return (
    <AdminLayout title="Support matrix">
      {error && !data && (
        <div className="mb-5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {!data ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Loading capability matrix…
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-3">
            <KpiCard label="Supported" value={summary.supported} tone="ok" />
            <KpiCard label="Empty possible" value={summary.empty} tone="warn" />
            <KpiCard label="Not supported" value={summary.unsupported} tone="danger" />
          </div>

          {platforms.length > 1 ? (
            <Tabs
              value={platform}
              onValueChange={setActivePlatform}
              className="space-y-5"
            >
              <TabsList>
                {platforms.map((p) => (
                  <TabsTrigger key={p} value={p} className="capitalize">
                    {p}
                  </TabsTrigger>
                ))}
              </TabsList>

              {platforms.map((p) => (
                <TabsContent key={p} value={p} className="mt-0">
                  <PlatformGrid
                    platform={p}
                    products={
                      data.platforms?.[p]
                        ? Object.entries(data.platforms[p])
                        : []
                    }
                  />
                </TabsContent>
              ))}
            </Tabs>
          ) : (
            <PlatformGrid platform={platform} products={products} />
          )}
        </>
      )}
    </AdminLayout>
  );
}

function PlatformGrid({
  platform,
  products,
}: {
  platform: string;
  products: Array<[string, Record<string, FieldSupport>]>;
}) {
  if (products.length === 0) {
    return <Empty message={`No data for ${platform}.`} />;
  }
  return (
    <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
      {products.map(([product, fields]) => (
        <ProductPanel key={product} product={product} fields={fields} />
      ))}
    </div>
  );
}

function ProductPanel({
  product,
  fields,
}: {
  product: string;
  fields: Record<string, FieldSupport>;
}) {
  const entries = Object.entries(fields);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {product.replace(/_/g, ' ')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5 pt-0">
        {entries.map(([field, support]) => (
          <SupportRow key={field} field={field} support={support} />
        ))}
      </CardContent>
    </Card>
  );
}

function SupportRow({ field, support }: { field: string; support: FieldSupport }) {
  const tone = supportTone(support);
  const accentClass =
    tone === 'ok'
      ? 'border-l-ok'
      : tone === 'warn'
        ? 'border-l-warn'
        : 'border-l-danger';
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 rounded-md border-l-[3px] bg-secondary/40 px-2.5 py-1.5',
        accentClass,
      )}
    >
      <span className="font-mono text-xs text-foreground">{field}</span>
      <Badge variant={tone}>{humanizeSupport(support)}</Badge>
    </div>
  );
}

function supportTone(s: FieldSupport): Tone {
  if (s === 'supported') return 'ok';
  if (s === 'empty_possible') return 'warn';
  return 'danger';
}

function humanizeSupport(s: FieldSupport): string {
  if (s === 'supported') return 'supported';
  if (s === 'empty_possible') return 'empty possible';
  if (s === 'not_supported') return 'not supported';
  return s;
}

function buildSummary(data: SupportMatrix | null): {
  supported: number;
  empty: number;
  unsupported: number;
} {
  let supported = 0;
  let empty = 0;
  let unsupported = 0;
  if (!data?.platforms) return { supported, empty, unsupported };
  for (const products of Object.values(data.platforms)) {
    for (const fields of Object.values(products)) {
      for (const v of Object.values(fields)) {
        if (v === 'supported') supported += 1;
        else if (v === 'empty_possible') empty += 1;
        else unsupported += 1;
      }
    }
  }
  return { supported, empty, unsupported };
}
