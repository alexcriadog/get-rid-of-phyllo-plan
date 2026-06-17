/**
 * AccountDirectoryPanel — Phase 4 workbench panel (id: "account-directory").
 *
 * Ports legacy pages/admin/accounts.tsx into the Mint Terminal idiom:
 *   · TermTable: handle, PlatformTag, workspace, token status, last sync
 *   · TermInput free-text filter + platform facet chips (LiveActivityPanel idiom)
 *   · Workspace scoping via useWorkspaceFilter()
 *   · Row click → selectAccount(id) with mint active accent
 *
 * No props — self-fetches via useLive. Follows SystemVitalsPanel canonical pattern.
 */

'use client';

import { useMemo, useState } from 'react';
import { POLL } from '@/lib/useLive';
import { useScopedLive, useWorkspaceFilter } from '@/lib/workspace-context';
import { fmtRelative } from '@/lib/format';
import { useTermSelection, selectAccount } from '@/lib/term/selection';
import TermTable, { type TermColumn } from '@/components/term/TermTable';
import PlatformTag from '@/components/term/PlatformTag';
import TermInput from '@/components/term/TermInput';
import ActionChip from '@/components/term/ActionChip';
import { platformTag } from '@/lib/term/platforms';
import { cn } from '@/lib/utils';
import {
  type AdminAccount,
  tokenStatus,
  tokenStatusClass,
  tokenDaysLabel,
  normalizeProducts,
  productHealthTone,
  healthToneClass,
} from './account-shared';

// ── Constants ─────────────────────────────────────────────────────────────────

const KNOWN_PLATFORMS = [
  'instagram',
  'facebook',
  'tiktok',
  'youtube',
  'linkedin',
  'threads',
  'twitch',
];

type PlatformFacet = 'all' | string;

// A compact badge that distinguishes the two Instagram connection flows
// (Instagram Login vs Facebook Login) so two coexisting rows for the same
// handle are tellable apart. Renders nothing for single-connection platforms.
function ConnectionFlowTag({ flow }: { flow?: string | null }) {
  if (flow !== 'ig_direct' && flow !== 'fb_login') return null;
  const isDirect = flow === 'ig_direct';
  return (
    <span
      title={isDirect ? 'Instagram Login (IG-direct)' : 'Facebook Login'}
      className={cn(
        'shrink-0 rounded-sm border px-1 text-[9px] font-medium leading-tight',
        isDirect
          ? 'border-term-mint/60 text-term-mint'
          : 'border-term-line/60 text-term-faint',
      )}
    >
      {isDirect ? 'IG' : 'FB'}
    </span>
  );
}

// ── Columns ───────────────────────────────────────────────────────────────────

function buildColumns(showWorkspace: boolean): TermColumn<AdminAccount>[] {
  const cols: TermColumn<AdminAccount>[] = [
    {
      key: 'platform',
      header: 'PLT',
      render: (a) => (
        <span className="flex items-center gap-1">
          <PlatformTag platform={a.platform} />
          <ConnectionFlowTag flow={a.connection_flow} />
        </span>
      ),
    },
    {
      key: 'handle',
      header: 'Handle',
      render: (a) => (
        <span className="truncate text-term-text">
          {a.handle || a.display_name || `#${a.id}`}
        </span>
      ),
    },
  ];

  if (showWorkspace) {
    cols.push({
      key: 'workspace',
      header: 'Workspace',
      render: (a) => (
        <span className="truncate text-[10px] text-term-faint">
          {a.workspace_slug ?? '—'}
        </span>
      ),
    });
  }

  cols.push(
    {
      key: 'token',
      header: 'Token',
      render: (a) => {
        const ts = tokenStatus(a.token_expires_at);
        return (
          <span className={cn('tabular-nums', tokenStatusClass(ts))}>
            {tokenDaysLabel(a.token_expires_at)}
          </span>
        );
      },
    },
    {
      key: 'sync',
      header: 'Last sync',
      render: (a) => {
        const products = normalizeProducts(a.products);
        const paused =
          a.status === 'paused' || a.sync_tier === 'paused';
        // Most recent last_success_at across all products
        let latestTs: string | null = null;
        let worstTone: 'ok' | 'warn' | 'danger' | 'faint' = 'faint';
        for (const [, h] of products) {
          if (
            h.last_success_at &&
            (!latestTs || h.last_success_at > latestTs)
          ) {
            latestTs = h.last_success_at;
          }
          const t = productHealthTone(h, paused);
          if (t === 'danger') worstTone = 'danger';
          else if (t === 'warn' && worstTone !== 'danger') worstTone = 'warn';
          else if (t === 'ok' && worstTone === 'faint') worstTone = 'ok';
        }
        return (
          <span
            className={cn('tabular-nums text-[10px]', healthToneClass(worstTone))}
          >
            {latestTs ? fmtRelative(latestTs) : '—'}
          </span>
        );
      },
    },
  );

  return cols;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AccountDirectoryPanel() {
  const { slug: wsSlug } = useWorkspaceFilter();
  const accounts = useScopedLive<AdminAccount[]>('/admin/accounts', POLL.list);
  const { accountId: selectedId } = useTermSelection();

  const [filterText, setFilterText] = useState('');
  const [platformFacet, setPlatformFacet] = useState<PlatformFacet>('all');

  const data = accounts.data ?? [];
  const apiDown = !!accounts.error && !accounts.data;
  const loading = accounts.loading && !accounts.data;

  // Collect platforms present in data for dynamic facets
  const presentPlatforms = useMemo(() => {
    const seen = new Set<string>();
    for (const a of data) seen.add(a.platform);
    return KNOWN_PLATFORMS.filter((p) => seen.has(p));
  }, [data]);

  const filtered = useMemo(() => {
    const lower = filterText.toLowerCase();
    return data.filter((a) => {
      if (platformFacet !== 'all' && a.platform !== platformFacet)
        return false;
      if (lower) {
        const hay = `${a.handle ?? ''} ${a.display_name ?? ''} ${a.id}`.toLowerCase();
        if (!hay.includes(lower)) return false;
      }
      return true;
    });
  }, [data, filterText, platformFacet]);

  const showWorkspace = wsSlug == null;
  const columns = useMemo(
    () => buildColumns(showWorkspace),
    [showWorkspace],
  );

  return (
    <div className="flex h-full flex-col gap-2 p-3 font-mono text-xs">
      {/* Header */}
      <HeaderRow
        loading={loading}
        apiDown={apiDown}
        error={accounts.error}
        total={data.length}
      />

      {/* Controls */}
      {!apiDown && (
        <div className="flex flex-wrap items-center gap-2">
          <TermInput
            placeholder="filter handle, name, id…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            aria-label="Filter accounts"
            className="flex-1"
          />
          <div
            className="flex items-center gap-1"
            role="group"
            aria-label="Filter by platform"
          >
            <ActionChip
              size="sm"
              variant={platformFacet === 'all' ? 'primary' : 'ghost'}
              onClick={() => setPlatformFacet('all')}
              aria-pressed={platformFacet === 'all'}
            >
              ALL
            </ActionChip>
            {presentPlatforms.map((p) => (
              <ActionChip
                key={p}
                size="sm"
                variant={platformFacet === p ? 'primary' : 'ghost'}
                onClick={() => setPlatformFacet(p)}
                aria-pressed={platformFacet === p}
              >
                {platformTag(p).abbr}
              </ActionChip>
            ))}
          </div>
          <span
            className="text-[10px] text-term-faint"
            aria-live="polite"
            aria-atomic="true"
          >
            {filtered.length}/{data.length}
          </span>
        </div>
      )}

      {/* Table */}
      {!apiDown && (
        <div className="flex-1 overflow-y-auto">
          <TermTable<AdminAccount>
            columns={columns}
            rows={filtered}
            rowKey={(a) => String(a.id)}
            activeKey={selectedId}
            onRowClick={(a) => selectAccount(String(a.id))}
            empty="no accounts match filter"
          />
        </div>
      )}
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function HeaderRow({
  loading,
  apiDown,
  error,
  total,
}: {
  loading: boolean;
  apiDown: boolean;
  error: string | null;
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
    <div className="flex items-center gap-2 border-b border-term-line pb-2">
      <span aria-hidden="true" className="text-term-mint">
        ●
      </span>
      <span className="uppercase tracking-[0.12em] text-term-mint">
        ACCOUNTS
      </span>
      <span className="text-term-faint">· {total} total</span>
    </div>
  );
}
