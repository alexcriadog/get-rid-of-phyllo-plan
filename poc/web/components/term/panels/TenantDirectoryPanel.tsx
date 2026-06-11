'use client';

/**
 * TenantDirectoryPanel — Phase 4 workbench panel (id: "tenant-directory").
 *
 * Ports the legacy `pages/admin/workspaces.tsx` into the Mint Terminal idiom.
 * Shows all workspaces in a TermTable: slug, name, account count, key count,
 * plan tier. A client-side TermInput narrows rows by slug or name. Clicking a
 * row calls `selectWorkspace(slug)` and lights the active-accent stripe so the
 * TenantInspectorPanel can subscribe and render the selection.
 *
 * Data: GET /admin/workspaces — polled at POLL.list (5 s).
 */

import { useMemo, useState } from 'react';
import { useLive, POLL } from '@/lib/useLive';
import { selectWorkspace, useTermSelection } from '@/lib/term/selection';
import TermTable, { type TermColumn } from '@/components/term/TermTable';
import TermInput from '@/components/term/TermInput';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

type Workspace = {
  id: string;
  slug: string;
  name: string;
  plan_tier: string;
  created_at: string;
  account_count: number;
  api_key_count: number;
};

// ── Columns ──────────────────────────────────────────────────────────────────

const COLUMNS: TermColumn<Workspace>[] = [
  {
    key: 'slug',
    header: 'Slug',
    render: (w) => (
      <span className="text-term-mint">{w.slug}</span>
    ),
  },
  {
    key: 'name',
    header: 'Name',
    render: (w) => <span className="truncate">{w.name}</span>,
  },
  {
    key: 'plan',
    header: 'Plan',
    render: (w) => (
      <span className="uppercase tracking-[0.08em] text-term-muted text-[10px]">
        {w.plan_tier}
      </span>
    ),
  },
  {
    key: 'accounts',
    header: 'Accts',
    align: 'right',
    render: (w) => <span className="tabular-nums">{w.account_count}</span>,
  },
  {
    key: 'keys',
    header: 'Keys',
    align: 'right',
    render: (w) => <span className="tabular-nums">{w.api_key_count}</span>,
  },
];

// ── Panel ─────────────────────────────────────────────────────────────────────

export default function TenantDirectoryPanel() {
  const live = useLive<Workspace[]>('/admin/workspaces', POLL.list);
  const data = live.data ?? [];
  const apiDown = !!live.error && !live.data;
  const loading = live.loading && !live.data;

  const { workspaceSlug: activeSlug } = useTermSelection();
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return data;
    return data.filter(
      (w) =>
        w.slug.toLowerCase().includes(q) || w.name.toLowerCase().includes(q),
    );
  }, [data, filter]);

  return (
    <div className="flex h-full flex-col gap-2 p-3 font-mono text-xs">
      <HeaderRow loading={loading} apiDown={apiDown} error={live.error} count={filtered.length} total={data.length} />

      {!apiDown && (
        <>
          <TermInput
            placeholder="filter slug or name…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter workspaces"
          />

          <div className="flex-1 overflow-y-auto">
            <TermTable<Workspace>
              columns={COLUMNS}
              rows={filtered}
              rowKey={(w) => w.slug}
              onRowClick={(w) => selectWorkspace(w.slug)}
              activeKey={activeSlug}
              empty="no workspaces"
            />
          </div>
        </>
      )}
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function HeaderRow({
  loading,
  apiDown,
  error,
  count,
  total,
}: {
  loading: boolean;
  apiDown: boolean;
  error: string | null;
  count: number;
  total: number;
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
  if (loading) {
    return (
      <div className="flex items-center gap-2 border-b border-term-line pb-2 text-term-faint">
        <span className="animate-term-blink text-term-mint">▮</span>
        connecting…
      </div>
    );
  }
  return (
    <div className={cn('flex items-center gap-2 border-b border-term-line pb-2')}>
      <span aria-hidden="true" className="text-term-mint">●</span>
      <span className="uppercase tracking-[0.12em] text-term-mint">TENANTS</span>
      <span className="ml-auto text-[10px] text-term-faint" aria-live="polite" aria-atomic="true">
        {count}/{total}
      </span>
    </div>
  );
}
