'use client';

/**
 * TenantInspectorPanel — Phase 4 workbench panel (id: "tenant-inspector").
 *
 * Tabbed object view for the workspace selected in TenantDirectoryPanel.
 * Subscribes via `useTermSelection().workspaceSlug`; falls back to the global
 * workspace filter (`useWorkspaceFilter()`) when selection is null and the
 * filter has a concrete workspace set.
 *
 * Tabs shipped (porting legacy `pages/admin/workspaces/[slug].tsx`):
 *   OVERVIEW  — headline stats: accounts, keys, webhooks. StatBlocks + id/plan.
 *   ACCOUNTS  — connected accounts table (handle, platform, status). Row click
 *               → selectAccount(id) in the selection store.
 *   KEYS      — API keys list. Key material masked to prefix only (never more
 *               than the legacy UI shows: `<prefix>…`). NEVER renders raw key.
 *   WEBHOOKS  — registered webhook endpoints for this workspace.
 *
 * Tabs intentionally NOT shipped:
 *   USAGE — the legacy page has no per-workspace usage endpoint; left out.
 *
 * Data endpoints (all polled at POLL.list):
 *   GET /admin/workspaces/:slug            → WorkspaceDetail
 *   GET /admin/workspaces/:slug/api-keys   → ApiKey[]
 *   GET /admin/workspaces/:slug/webhook-endpoints → WebhookEndpoint[]
 *   GET /admin/workspaces/:slug/accounts   → Account[]  (best-effort)
 */

import { useState } from 'react';
import { useLive, POLL } from '@/lib/useLive';
import { useTermSelection, selectAccount } from '@/lib/term/selection';
import { useWorkspaceFilter } from '@/lib/workspace-context';
import StatBlock from '@/components/term/StatBlock';
import TermTable, { type TermColumn } from '@/components/term/TermTable';
import PlatformTag from '@/components/term/PlatformTag';
import ActionChip from '@/components/term/ActionChip';
import { fmtRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

type WorkspaceDetail = {
  id: string;
  slug: string;
  name: string;
  plan_tier: string;
  account_count: number;
  active_api_key_count: number;
  webhook_endpoint_count: number;
};

type Account = {
  id: string;
  handle: string | null;
  platform: string;
  status: string;
};

type ApiKey = {
  id: string;
  key_prefix: string;
  scope: string;
  label: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

type WebhookEndpoint = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  description: string | null;
  createdAt: string;
};

// ── Tab ids ───────────────────────────────────────────────────────────────────

type TabId = 'overview' | 'accounts' | 'keys' | 'webhooks';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'accounts', label: 'ACCOUNTS' },
  { id: 'keys', label: 'KEYS' },
  { id: 'webhooks', label: 'WEBHOOKS' },
];

// ── Account table columns ─────────────────────────────────────────────────────

const ACCOUNT_COLS: TermColumn<Account>[] = [
  {
    key: 'handle',
    header: 'Handle',
    render: (a) => (
      <span className="truncate text-term-text">
        {a.handle ?? <span className="text-term-faint">—</span>}
      </span>
    ),
  },
  {
    key: 'platform',
    header: 'Platform',
    render: (a) => <PlatformTag platform={a.platform} />,
  },
  {
    key: 'status',
    header: 'Status',
    render: (a) => (
      <span
        className={cn(
          'text-[10px] uppercase tracking-[0.08em]',
          a.status === 'active' ? 'text-term-mint' : 'text-term-faint',
        )}
      >
        {a.status}
      </span>
    ),
  },
];

// ── Keys table columns ────────────────────────────────────────────────────────

// Key material: only the prefix is rendered (`<prefix>…`). The full raw key
// is NEVER shown — matching the exact mask the legacy admin page uses so a
// screenshot of this panel leaks no secrets.
const KEYS_COLS: TermColumn<ApiKey>[] = [
  {
    key: 'prefix',
    header: 'Prefix',
    render: (k) => (
      <span className="font-mono text-term-text">
        {k.key_prefix}…
      </span>
    ),
  },
  {
    key: 'label',
    header: 'Label',
    render: (k) => (
      <span className="truncate">
        {k.label ?? <span className="text-term-faint">—</span>}
      </span>
    ),
  },
  {
    key: 'scope',
    header: 'Scope',
    render: (k) => (
      <span className="text-[10px] uppercase tracking-[0.06em] text-term-muted">
        {k.scope}
      </span>
    ),
  },
  {
    key: 'last_used',
    header: 'Last used',
    render: (k) => (
      <span className="text-term-muted">
        {k.last_used_at ? fmtRelative(k.last_used_at) : '—'}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (k) =>
      k.revoked_at ? (
        <span className="text-[10px] uppercase tracking-[0.08em] text-term-danger">
          revoked
        </span>
      ) : (
        <span className="text-[10px] uppercase tracking-[0.08em] text-term-mint">
          active
        </span>
      ),
  },
];

// ── Webhook table columns ─────────────────────────────────────────────────────

const WEBHOOK_COLS: TermColumn<WebhookEndpoint>[] = [
  {
    key: 'url',
    header: 'URL',
    render: (e) => (
      <span className="max-w-xs truncate font-mono text-[11px] text-term-text">
        {e.url}
      </span>
    ),
  },
  {
    key: 'events',
    header: 'Events',
    render: (e) => (
      <span className="truncate text-term-muted text-[10px]">
        {e.events.join(', ')}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (ep) => (
      <span
        className={cn(
          'text-[10px] uppercase tracking-[0.08em]',
          ep.active ? 'text-term-mint' : 'text-term-faint',
        )}
      >
        {ep.active ? 'active' : 'inactive'}
      </span>
    ),
  },
];

// ── Panel ─────────────────────────────────────────────────────────────────────

export default function TenantInspectorPanel() {
  const { workspaceSlug: selectedSlug } = useTermSelection();
  const { slug: filterSlug } = useWorkspaceFilter();

  // Resolve slug: selection takes precedence; fall back to global workspace filter.
  const slug = selectedSlug ?? filterSlug;

  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const ws = useLive<WorkspaceDetail>(
    slug ? `/admin/workspaces/${slug}` : null,
    POLL.list,
  );
  const keysLive = useLive<ApiKey[]>(
    slug ? `/admin/workspaces/${slug}/api-keys` : null,
    POLL.list,
  );
  const endpointsLive = useLive<WebhookEndpoint[]>(
    slug ? `/admin/workspaces/${slug}/webhook-endpoints` : null,
    POLL.list,
  );
  const accountsLive = useLive<Account[]>(
    slug ? `/admin/workspaces/${slug}/accounts` : null,
    POLL.list,
  );

  if (!slug) {
    return (
      <div className="flex h-full items-center justify-center p-4 font-mono text-xs text-term-faint">
        select a workspace from the directory{' '}
        <span className="animate-term-blink text-term-mint">▮</span>
      </div>
    );
  }

  const apiDown = !!ws.error && !ws.data;
  const loading = ws.loading && !ws.data;

  return (
    <div className="flex h-full flex-col gap-2 p-3 font-mono text-xs">
      <HeaderRow
        slug={slug}
        ws={ws.data}
        loading={loading}
        apiDown={apiDown}
        error={ws.error}
      />

      {!apiDown && (
        <>
          {/* Tab strip */}
          <div
            className="flex items-center gap-1 border-b border-term-line pb-2"
            role="tablist"
            aria-label="Workspace inspector tabs"
          >
            {TABS.map((t) => (
              <ActionChip
                key={t.id}
                size="sm"
                variant={activeTab === t.id ? 'primary' : 'ghost'}
                role="tab"
                aria-selected={activeTab === t.id}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </ActionChip>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto" role="tabpanel">
            {activeTab === 'overview' && <OverviewTab ws={ws.data} />}
            {activeTab === 'accounts' && (
              <AccountsTab
                accounts={accountsLive.data ?? []}
                loading={accountsLive.loading && !accountsLive.data}
                error={accountsLive.error}
              />
            )}
            {activeTab === 'keys' && (
              <KeysTab
                keys={keysLive.data ?? []}
                loading={keysLive.loading && !keysLive.data}
                error={keysLive.error}
              />
            )}
            {activeTab === 'webhooks' && (
              <WebhooksTab
                endpoints={endpointsLive.data ?? []}
                loading={endpointsLive.loading && !endpointsLive.data}
                error={endpointsLive.error}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function HeaderRow({
  slug,
  ws,
  loading,
  apiDown,
  error,
}: {
  slug: string;
  ws: WorkspaceDetail | null;
  loading: boolean;
  apiDown: boolean;
  error: string | null;
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
        loading {slug}…
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 border-b border-term-line pb-2">
      <span aria-hidden="true" className="text-term-mint">●</span>
      <span className="text-term-mint">{ws?.name ?? slug}</span>
      <span className="text-term-faint">·</span>
      <span className="text-term-muted">{slug}</span>
      {ws?.plan_tier && (
        <span className="ml-auto text-[10px] uppercase tracking-[0.08em] text-term-faint">
          {ws.plan_tier}
        </span>
      )}
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({ ws }: { ws: WorkspaceDetail | null }) {
  if (!ws) {
    return (
      <div className="flex items-center gap-2 pt-4 text-term-faint">
        <span className="animate-term-blink text-term-mint">▮</span>
        loading…
      </div>
    );
  }
  return (
    <div className="space-y-3 pt-2">
      <div className="grid grid-cols-3 gap-3">
        <StatBlock label="Accounts" value={ws.account_count} />
        <StatBlock label="Active keys" value={ws.active_api_key_count} />
        <StatBlock label="Webhooks" value={ws.webhook_endpoint_count} />
      </div>
      <div className="space-y-1 border-t border-term-line pt-2">
        <div className="flex items-baseline gap-2">
          <span className="w-10 text-[10px] uppercase tracking-[0.1em] text-term-faint">
            ID
          </span>
          <code className="break-all font-mono text-[11px] text-term-muted">{ws.id}</code>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="w-10 text-[10px] uppercase tracking-[0.1em] text-term-faint">
            PLAN
          </span>
          <span className="text-[11px] uppercase tracking-[0.08em] text-term-text">
            {ws.plan_tier}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Accounts tab ──────────────────────────────────────────────────────────────

function AccountsTab({
  accounts,
  loading,
  error,
}: {
  accounts: Account[];
  loading: boolean;
  error: string | null;
}) {
  const { accountId: activeId } = useTermSelection();

  if (loading) {
    return (
      <div className="flex items-center gap-2 pt-4 text-term-faint">
        <span className="animate-term-blink text-term-mint">▮</span>
        loading accounts…
      </div>
    );
  }
  if (error && accounts.length === 0) {
    return <div className="pt-2 text-[11px] text-term-danger">↯ {error}</div>;
  }
  return (
    <TermTable<Account>
      columns={ACCOUNT_COLS}
      rows={accounts}
      rowKey={(a) => a.id}
      onRowClick={(a) => selectAccount(a.id)}
      activeKey={activeId}
      empty="no accounts connected"
    />
  );
}

// ── Keys tab ──────────────────────────────────────────────────────────────────

function KeysTab({
  keys,
  loading,
  error,
}: {
  keys: ApiKey[];
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 pt-4 text-term-faint">
        <span className="animate-term-blink text-term-mint">▮</span>
        loading keys…
      </div>
    );
  }
  if (error && keys.length === 0) {
    return <div className="pt-2 text-[11px] text-term-danger">↯ {error}</div>;
  }
  return (
    <TermTable<ApiKey>
      columns={KEYS_COLS}
      rows={keys}
      rowKey={(k) => k.id}
      empty="no keys issued"
    />
  );
}

// ── Webhooks tab ──────────────────────────────────────────────────────────────

function WebhooksTab({
  endpoints,
  loading,
  error,
}: {
  endpoints: WebhookEndpoint[];
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 pt-4 text-term-faint">
        <span className="animate-term-blink text-term-mint">▮</span>
        loading webhooks…
      </div>
    );
  }
  if (error && endpoints.length === 0) {
    return <div className="pt-2 text-[11px] text-term-danger">↯ {error}</div>;
  }
  return (
    <TermTable<WebhookEndpoint>
      columns={WEBHOOK_COLS}
      rows={endpoints}
      rowKey={(e) => e.id}
      empty="no webhook endpoints registered"
    />
  );
}
