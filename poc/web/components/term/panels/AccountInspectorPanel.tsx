/**
 * AccountInspectorPanel — Phase 4 workbench panel (id: "account-inspector").
 *
 * Subscribes to the cross-panel selection store and renders the selected
 * account. Empty state when no account is selected. Tabs:
 *
 *   OVERVIEW — identity strip, token health, headline StatBlocks, product grid
 *   SYNC     — sync jobs table (cadence/last-success/next-run/fails)
 *              Complex per-job settings deferred to legacy admin link.
 *   CALLS    — recent API calls for this account (FeedLine rows)
 *   ACTIONS  — pause/unpause chip + trigger sync link + DATA explorer link
 *
 * No props — subscribes to selection store, self-fetches via useLive.
 */

'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { useLive, POLL } from '@/lib/useLive';
import { adminPost } from '@/lib/api';
import { fmtRelative, fmtTime, fmtMs } from '@/lib/format';
import { useTermSelection } from '@/lib/term/selection';
import PlatformTag from '@/components/term/PlatformTag';
import StatBlock from '@/components/term/StatBlock';
import ActionChip from '@/components/term/ActionChip';
import FeedLine from '@/components/term/FeedLine';
import { cn } from '@/lib/utils';
import {
  type AdminAccount,
  type ApiCallRow,
  tokenStatus,
  tokenStatusClass,
  tokenDaysLabel,
  normalizeProducts,
  productHealthTone,
  healthToneClass,
} from './account-shared';

// ── Tab types ─────────────────────────────────────────────────────────────────

type TabId = 'overview' | 'sync' | 'calls' | 'actions';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'sync', label: 'SYNC' },
  { id: 'calls', label: 'CALLS' },
  { id: 'actions', label: 'ACTIONS' },
];

// ── Main component ────────────────────────────────────────────────────────────

export default function AccountInspectorPanel() {
  const { accountId } = useTermSelection();

  const accountLive = useLive<AdminAccount>(
    accountId ? `/admin/accounts/${accountId}` : null,
    POLL.list,
  );
  const callsLive = useLive<ApiCallRow[]>(
    accountId
      ? `/admin/api-calls?account_id=${encodeURIComponent(String(accountId))}&limit=200`
      : null,
    POLL.live,
  );

  const [tab, setTab] = useState<TabId>('overview');

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!accountId) {
    return (
      <div className="flex h-full items-center justify-center p-4 font-mono text-xs text-term-faint">
        <span>select an account </span>
        <span className="animate-term-blink text-term-mint">▮</span>
      </div>
    );
  }

  const apiDown = !!accountLive.error && !accountLive.data;
  const loading = accountLive.loading && !accountLive.data;
  const account = accountLive.data;

  if (apiDown) {
    return (
      <div className="flex h-full flex-col gap-2 p-3 font-mono text-xs">
        <div className="flex items-center gap-2 border-b border-term-line pb-2 text-term-danger">
          <span aria-hidden="true">●</span>
          <span className="uppercase tracking-[0.12em]">API UNREACHABLE</span>
          <span className="truncate text-term-faint">{accountLive.error}</span>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-4 font-mono text-xs text-term-faint">
        <span className="animate-term-blink text-term-mint">▮</span>
        <span className="ml-2">loading account {accountId}…</span>
      </div>
    );
  }

  if (!account) return null;

  return (
    <div className="flex h-full flex-col gap-2 p-3 font-mono text-xs">
      {/* Identity strip */}
      <IdentityStrip account={account} />

      {/* Tab bar */}
      <div
        className="flex items-center gap-1 border-b border-term-line pb-2"
        role="tablist"
        aria-label="Inspector tabs"
      >
        {TABS.map((t) => (
          <ActionChip
            key={t.id}
            size="sm"
            role="tab"
            variant={tab === t.id ? 'primary' : 'ghost'}
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </ActionChip>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'overview' && <OverviewTab account={account} />}
        {tab === 'sync' && (
          <SyncTab account={account} accountId={accountId} />
        )}
        {tab === 'calls' && (
          <CallsTab
            calls={callsLive.data ?? []}
            loading={callsLive.loading && !callsLive.data}
          />
        )}
        {tab === 'actions' && (
          <ActionsTab
            account={account}
            accountId={accountId}
            onRefresh={() => accountLive.refresh()}
          />
        )}
      </div>
    </div>
  );
}

// ── Identity strip ────────────────────────────────────────────────────────────

function IdentityStrip({ account }: { account: AdminAccount }) {
  const ts = tokenStatus(account.token_expires_at);
  return (
    <div className="flex items-baseline gap-2 border-b border-term-line pb-2">
      <PlatformTag platform={account.platform} />
      <span className="truncate font-medium text-term-text">
        {account.handle || account.display_name || `#${account.id}`}
      </span>
      {account.workspace_slug && (
        <span className="text-[10px] text-term-faint">
          · {account.workspace_slug}
        </span>
      )}
      <span className={cn('ml-auto shrink-0 text-[10px]', tokenStatusClass(ts))}>
        token {tokenDaysLabel(account.token_expires_at)}
      </span>
    </div>
  );
}

// ── OVERVIEW tab ──────────────────────────────────────────────────────────────

function OverviewTab({ account }: { account: AdminAccount }) {
  const products = normalizeProducts(account.products);
  const paused =
    account.status === 'paused' || account.sync_tier === 'paused';
  const ts = tokenStatus(account.token_expires_at);

  // Products with at least one successful sync
  const totalSynced = [...products.values()].filter(
    (h) => h.last_success_at,
  ).length;

  // Most recent last_success_at across all products
  let lastSyncTs: string | null = null;
  for (const [, h] of products) {
    if (h.last_success_at && (!lastSyncTs || h.last_success_at > lastSyncTs)) {
      lastSyncTs = h.last_success_at;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Token health */}
      <Section label="TOKEN HEALTH">
        <div className="flex flex-wrap gap-4">
          <KVRow label="status">
            <span className={tokenStatusClass(ts)}>{ts.toUpperCase()}</span>
          </KVRow>
          <KVRow label="expires">
            <span className={tokenStatusClass(ts)}>
              {tokenDaysLabel(account.token_expires_at)}
            </span>
          </KVRow>
          {account.token_refreshable !== undefined && (
            <KVRow label="refreshable">
              <span
                className={
                  account.token_refreshable
                    ? 'text-term-mint'
                    : 'text-term-faint'
                }
              >
                {account.token_refreshable ? 'YES' : 'NO'}
              </span>
            </KVRow>
          )}
        </div>
      </Section>

      {/* Headline stats */}
      <Section label="HEADLINE">
        <div className="grid grid-cols-3 gap-3">
          <StatBlock
            label="Products synced"
            value={totalSynced}
            sub={`of ${products.size}`}
          />
          <StatBlock
            label="Last sync"
            value={lastSyncTs ? fmtRelative(lastSyncTs) : '—'}
          />
          <StatBlock label="Status" value={account.status ?? '—'} />
        </div>
      </Section>

      {/* Identity fields */}
      <Section label="IDENTITY">
        <div className="flex flex-col gap-1">
          <KVRow label="id">
            <span className="font-mono text-[10px] text-term-muted">
              {account.id}
            </span>
          </KVRow>
          {account.canonical_user_id && (
            <KVRow label="canonical">
              <span className="font-mono text-[10px] text-term-muted">
                {account.canonical_user_id}
              </span>
            </KVRow>
          )}
          {account.connected_at && (
            <KVRow label="connected">
              <span className="text-term-muted">
                {fmtRelative(account.connected_at)}
              </span>
            </KVRow>
          )}
          <KVRow label="tier">
            <span className="text-term-muted">{account.sync_tier ?? '—'}</span>
          </KVRow>
        </div>
      </Section>

      {/* Products grid */}
      {products.size > 0 && (
        <Section label="PRODUCTS">
          <div className="grid grid-cols-2 gap-1.5">
            {[...products.entries()].map(([prod, h]) => {
              const tone = productHealthTone(h, paused);
              return (
                <div
                  key={prod}
                  className={cn(
                    'flex items-center gap-2 border border-term-line p-1.5',
                    tone === 'danger' && 'border-term-danger/40',
                    tone === 'warn' && 'border-term-warn/40',
                    tone === 'ok' && 'border-term-mint/30',
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      tone === 'ok' && 'bg-term-mint',
                      tone === 'warn' && 'bg-term-warn',
                      tone === 'danger' && 'bg-term-danger',
                      tone === 'faint' && 'bg-term-faint',
                    )}
                    aria-hidden="true"
                  />
                  <span className="truncate text-[10px] uppercase tracking-[0.08em] text-term-faint">
                    {prod.replace(/_/g, ' ').slice(0, 8)}
                  </span>
                  <span
                    className={cn(
                      'ml-auto shrink-0 text-[10px] tabular-nums',
                      healthToneClass(tone),
                    )}
                  >
                    {h.last_success_at ? fmtRelative(h.last_success_at) : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}

// ── SYNC tab ──────────────────────────────────────────────────────────────────

function SyncTab({
  account,
  accountId,
}: {
  account: AdminAccount;
  accountId: string;
}) {
  const jobs = account.sync_jobs ?? [];

  return (
    <div className="flex flex-col gap-3">
      {jobs.length === 0 ? (
        <p className="text-term-faint">no sync jobs</p>
      ) : (
        <div className="flex flex-col gap-1">
          {jobs.map((j) => {
            const fails = j.failure_count ?? 0;
            const toneClass =
              fails >= 3
                ? 'text-term-danger'
                : j.last_success_at
                  ? 'text-term-mint'
                  : 'text-term-faint';
            return (
              <div
                key={j.id ?? j.product}
                className="flex flex-col gap-0.5 border-b border-term-line/50 pb-2 last:border-0"
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-term-text">
                    {j.product}
                  </span>
                  <span className="text-[10px] text-term-faint">
                    {j.status}
                  </span>
                  {fails > 0 && (
                    <span className="ml-auto text-[10px] text-term-danger">
                      {fails} fails
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-3 text-[10px] text-term-faint">
                  <span>
                    last ok:{' '}
                    <span className={toneClass}>
                      {fmtRelative(j.last_success_at)}
                    </span>
                  </span>
                  <span>
                    next:{' '}
                    <span className="text-term-muted">
                      {fmtRelative(j.next_run_at)}
                    </span>
                  </span>
                </div>
                {j.last_error && (
                  <div
                    className="truncate text-[10px] text-term-danger"
                    title={j.last_error}
                  >
                    {j.last_error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Deferred complex settings link */}
      <div className="mt-2 border-t border-term-line/50 pt-2">
        <a
          href={`/admin/accounts/${accountId}/sync-settings`}
          target="_blank"
          rel="noreferrer"
          className="text-[10px] text-term-faint underline underline-offset-2 hover:text-term-text"
        >
          edit cadence overrides + per-job knobs in legacy admin →
        </a>
      </div>
    </div>
  );
}

// ── CALLS tab ─────────────────────────────────────────────────────────────────

import type { FeedTone } from '@/components/term/FeedLine';

function pickCallTone(code: number | undefined): FeedTone {
  if (code == null) return 'queued';
  if (code >= 200 && code < 300) return 'ok';
  if (code >= 400 && code < 500) return 'warn';
  return 'danger';
}

function CallsTab({
  calls,
  loading,
}: {
  calls: ApiCallRow[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-term-faint">
        <span className="animate-term-blink text-term-mint">▮</span>
        loading calls…
      </div>
    );
  }
  if (calls.length === 0) {
    return <p className="text-term-faint">no calls recorded</p>;
  }
  return (
    <div className="flex flex-col">
      {calls.slice(0, 80).map((c, i) => {
        const tone = pickCallTone(c.status_code);
        return (
          <FeedLine
            key={`${c.called_at ?? ''}:${c.endpoint ?? ''}:${i}`}
            time={fmtTime(c.called_at)}
            platform={c.platform}
            status={{
              text: c.status_code != null ? String(c.status_code) : '—',
              tone,
            }}
          >
            <span className="truncate" title={c.endpoint}>
              {c.endpoint}
            </span>
            {c.duration_ms != null && (
              <span className="ml-1 shrink-0 text-term-faint">
                {fmtMs(c.duration_ms)}
              </span>
            )}
          </FeedLine>
        );
      })}
    </div>
  );
}

// ── ACTIONS tab ───────────────────────────────────────────────────────────────

function ActionsTab({
  account,
  accountId,
  onRefresh,
}: {
  account: AdminAccount;
  accountId: string;
  onRefresh: () => void;
}) {
  const [pauseState, setPauseState] = useState<'idle' | 'loading' | string>(
    'idle',
  );

  const paused = account.status === 'paused';

  const handlePause = async () => {
    setPauseState('loading');
    try {
      await adminPost(
        `/admin/accounts/${accountId}/${paused ? 'unpause' : 'pause'}`,
        {},
      );
      onRefresh();
      setPauseState('idle');
    } catch (e) {
      setPauseState((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Section label="SYNC">
        <div className="flex flex-col gap-2">
          <p className="text-term-faint">
            Trigger via the risk-check dialog — reviews target and signals
            before queueing.
          </p>
          <a
            href={`/admin/next-runs?account=${accountId}`}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-term-faint underline underline-offset-2 hover:text-term-text"
          >
            open trigger sync dialog →
          </a>
        </div>
      </Section>

      <Section label="PAUSE / UNPAUSE">
        <div className="flex items-center gap-2">
          <ActionChip
            size="sm"
            variant="action"
            disabled={pauseState === 'loading'}
            onClick={handlePause}
            aria-label={paused ? 'Unpause account' : 'Pause account'}
          >
            {pauseState === 'loading'
              ? '…'
              : paused
                ? '▶ UNPAUSE'
                : '‖ PAUSE'}
          </ActionChip>
          {pauseState !== 'idle' && pauseState !== 'loading' && (
            <span className="truncate text-term-danger">{pauseState}</span>
          )}
        </div>
        <p className="mt-1 text-[10px] text-term-faint">
          current: {account.status ?? '—'}
        </p>
      </Section>

      <Section label="DATA EXPLORER">
        <a
          href={`/account/${accountId}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-none border border-term-line-2 px-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-term-muted transition-[background-color,border-color,color] duration-150 hover:border-term-faint hover:text-term-text"
        >
          DATA →
        </a>
        <p className="mt-1 text-[10px] text-term-faint">
          public data explorer for this account
        </p>
      </Section>
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] uppercase tracking-[0.12em] text-term-faint">
        {label}
      </div>
      {children}
    </div>
  );
}

function KVRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] items-baseline gap-2">
      <span className="text-[10px] uppercase tracking-[0.1em] text-term-faint/70">
        {label}
      </span>
      {children}
    </div>
  );
}
