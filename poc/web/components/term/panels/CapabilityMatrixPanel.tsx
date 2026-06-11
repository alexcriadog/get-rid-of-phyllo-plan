import { useMemo, useState } from 'react';
import { useLive, POLL } from '@/lib/useLive';
import PlatformTag from '@/components/term/PlatformTag';
import { cn } from '@/lib/utils';

/**
 * Capability Matrix panel (id `capability-matrix`).
 *
 * Ports the legacy `/admin/support-matrix` page into the Mint Terminal idiom.
 * Renders a platform × product dense mono grid: platforms are tab-selectable
 * rows, products are columns, cells show ● supported / ◐ empty-possible / ·
 * unsupported. Polled at the `catalog` cadence (30 s) — the support matrix
 * changes only on deploys.
 *
 * Data: GET /admin/support-matrix
 */

type FieldSupport = 'supported' | 'empty_possible' | 'not_supported' | string;

type SupportMatrix = {
  platforms?: Record<string, Record<string, Record<string, FieldSupport>>>;
};

// Cell symbols — dense mono, each visually distinct at a glance.
const CELL: Record<string, string> = {
  supported: '●',
  empty_possible: '◐',
  not_supported: '·',
};

function cellSymbol(s: FieldSupport): string {
  return CELL[s] ?? '?';
}

function cellClass(s: FieldSupport): string {
  if (s === 'supported') return 'text-term-mint';
  if (s === 'empty_possible') return 'text-term-warn';
  return 'text-term-faint';
}

export default function CapabilityMatrixPanel() {
  const matrix = useLive<SupportMatrix>('/admin/support-matrix', POLL.catalog);
  const d = matrix.data;
  const apiDown = !!matrix.error && !d;

  const platforms = useMemo(() => (d?.platforms ? Object.keys(d.platforms) : []), [d]);
  const [activePlatform, setActivePlatform] = useState<string>('');
  const platform = activePlatform && platforms.includes(activePlatform) ? activePlatform : (platforms[0] ?? '');

  const products = useMemo(
    () => (d?.platforms?.[platform] ? Object.entries(d.platforms[platform]) : []),
    [d, platform],
  );

  // Collect all unique field names across products for row headers.
  const allFields = useMemo(() => {
    const seen = new Set<string>();
    for (const [, fields] of products) {
      for (const k of Object.keys(fields)) seen.add(k);
    }
    return Array.from(seen);
  }, [products]);

  return (
    <div className="flex h-full flex-col gap-2 p-3 font-mono text-xs">
      <HeaderRow apiDown={apiDown} error={matrix.error} data={d} />

      {!apiDown && !d && (
        <div className="flex items-center gap-2 text-term-faint">
          <span className="animate-term-blink text-term-mint">▮</span>
          connecting…
        </div>
      )}

      {d && platforms.length > 1 && (
        <PlatformTabs
          platforms={platforms}
          active={platform}
          onSelect={setActivePlatform}
        />
      )}

      {d && products.length > 0 && allFields.length > 0 && (
        <div className="flex-1 overflow-auto">
          <MatrixGrid platform={platform} products={products} allFields={allFields} />
        </div>
      )}

      {d && products.length === 0 && (
        <div className="text-term-faint">
          &gt; no data for {platform} <span className="animate-term-blink">▮</span>
        </div>
      )}

      <Legend />
    </div>
  );
}

function HeaderRow({
  apiDown,
  error,
  data,
}: {
  apiDown: boolean;
  error: string | null;
  data: SupportMatrix | null;
}) {
  if (apiDown) {
    return (
      <div className="flex items-center gap-2 border-b border-term-line pb-2 text-term-danger">
        <span aria-hidden="true">●</span>
        <span className="uppercase tracking-[0.12em]">API UNREACHABLE</span>
        {error && <span className="truncate text-term-faint">{error}</span>}
      </div>
    );
  }
  if (!data) return null;

  const counts = buildCounts(data);
  return (
    <div className="flex items-center gap-3 border-b border-term-line pb-2">
      <span className="text-[10px] uppercase tracking-[0.12em] text-term-faint">
        CAPABILITY MATRIX
      </span>
      <span className="text-term-mint" title="supported">
        ● {counts.supported}
      </span>
      <span className="text-term-warn" title="empty possible">
        ◐ {counts.empty}
      </span>
      <span className="text-term-faint" title="not supported">
        · {counts.unsupported}
      </span>
    </div>
  );
}

function PlatformTabs({
  platforms,
  active,
  onSelect,
}: {
  platforms: string[];
  active: string;
  onSelect: (p: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="tablist" aria-label="Platform">
      {platforms.map((p) => (
        <button
          key={p}
          role="tab"
          aria-selected={p === active}
          onClick={() => onSelect(p)}
          className={cn(
            'rounded border px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] transition-colors',
            p === active
              ? 'border-term-mint/60 bg-term-mint/10 text-term-mint'
              : 'border-term-line text-term-faint hover:text-term-text',
          )}
        >
          <PlatformTag platform={p} showLabel={false} />
          <span className="ml-1">{p}</span>
        </button>
      ))}
    </div>
  );
}

function MatrixGrid({
  platform,
  products,
  allFields,
}: {
  platform: string;
  products: Array<[string, Record<string, FieldSupport>]>;
  allFields: string[];
}) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b border-term-line">
          <th
            scope="col"
            className="sticky left-0 bg-term-base px-2 py-1 text-left text-[10px] uppercase tracking-[0.1em] text-term-faint"
          >
            <PlatformTag platform={platform} showLabel={false} />
          </th>
          {products.map(([product]) => (
            <th
              key={product}
              scope="col"
              className="px-2 py-1 text-center text-[9px] uppercase tracking-[0.08em] text-term-faint"
              title={product}
            >
              {product.replace(/_/g, ' ')}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {allFields.map((field) => (
          <tr key={field} className="border-b border-term-line/40 last:border-0">
            <td className="sticky left-0 bg-term-base px-2 py-0.5 text-[10px] text-term-muted">
              {field}
            </td>
            {products.map(([product, fields]) => {
              const support = fields[field] ?? 'not_supported';
              return (
                <td
                  key={product}
                  className={cn('px-2 py-0.5 text-center', cellClass(support))}
                  title={`${field} · ${product}: ${support}`}
                  data-support={support}
                >
                  {cellSymbol(support)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Legend() {
  return (
    <div className="mt-auto flex items-center gap-4 border-t border-term-line pt-2 text-[10px]">
      <span className="text-term-faint uppercase tracking-[0.1em]">legend</span>
      <span className="text-term-mint">● supported</span>
      <span className="text-term-warn">◐ empty possible</span>
      <span className="text-term-faint">· not supported</span>
    </div>
  );
}

function buildCounts(data: SupportMatrix): { supported: number; empty: number; unsupported: number } {
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
