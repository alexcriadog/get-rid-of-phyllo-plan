/**
 * CadencePanel — workbench panel (id: "cadence").
 *
 * Per-platform cadence editor. Lists EVERY supported (platform × product)
 * combination — including ones with no DB row yet (e.g. threads), which show
 * their effective fallback cadence so they're editable instead of invisible.
 *
 * Two knobs per row:
 *   · sync interval   (default_interval_seconds) — how often we poll the API.
 *   · refresh cadence (refresh_interval_seconds + refresh_window_days) — the
 *     engagement-refresh emit throttle + look-back window.
 *
 * Data:
 *   GET   /admin/cadences                 — full matrix + effective values
 *   PATCH /admin/cadences/:plat/:product  — { interval_seconds?,
 *                                             refresh_interval_seconds?,
 *                                             refresh_window_days? }
 * Only changed fields are sent. Global scope — cadences apply across all
 * workspaces, so no workspace filter.
 */

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLive, POLL } from '@/lib/useLive';
import { adminPatch } from '@/lib/api';
import TermInput from '@/components/term/TermInput';
import ActionChip from '@/components/term/ActionChip';
import PlatformTag from '@/components/term/PlatformTag';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type Cadence = {
  platform: string;
  product: string;
  default_interval_seconds: number;
  sync_configured: boolean;
  refresh_interval_seconds: number;
  refresh_window_days: number;
  refresh_configured: boolean;
  updated_at: string | null;
};

type CadencePatch = {
  interval_seconds?: number;
  refresh_interval_seconds?: number;
  refresh_window_days?: number;
};

type MutState = { busy: boolean; error: string | null };

// ── Constants ─────────────────────────────────────────────────────────────────

const INTERVAL_PRESETS: Array<{ label: string; s: number }> = [
  { label: '15m', s: 900 },
  { label: '30m', s: 1800 },
  { label: '1h', s: 3600 },
  { label: '6h', s: 21600 },
  { label: '24h', s: 86400 },
];

const MIN_INTERVAL = 60;
const MAX_INTERVAL = 30 * 86400;
const MIN_WINDOW_DAYS = 1;
const MAX_WINDOW_DAYS = 365;

// ── Main component ─────────────────────────────────────────────────────────────

export default function CadencePanel() {
  const cadencesLive = useLive<Cadence[]>('/admin/cadences', POLL.list);
  const cadences = cadencesLive.data ?? [];
  const apiDown = !!cadencesLive.error && !cadencesLive.data;
  const loading = cadencesLive.loading && !cadencesLive.data;

  const [mutState, setMutState] = useState<Record<string, MutState>>({});

  const saveCadence = async (
    platform: string,
    product: string,
    patch: CadencePatch,
  ) => {
    const k = `${platform}:${product}`;
    setMutState((s) => ({ ...s, [k]: { busy: true, error: null } }));
    try {
      await adminPatch(`/admin/cadences/${platform}/${product}`, patch);
      setMutState((s) => ({ ...s, [k]: { busy: false, error: null } }));
      cadencesLive.refresh();
    } catch (e) {
      setMutState((s) => ({
        ...s,
        [k]: { busy: false, error: (e as Error).message },
      }));
    }
  };

  const [filter, setFilter] = useState('');
  const [openPlatforms, setOpenPlatforms] = useState<Set<string>>(new Set());

  // Backend already sorts platform asc → product asc; group consecutively.
  const groups = useMemo(() => groupByPlatform(cadences), [cadences]);

  // Filter by platform or product name; drop platforms with no matching rows.
  const q = filter.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!q) return groups;
    return groups
      .map((g) => ({
        platform: g.platform,
        rows: g.rows.filter(
          (r) =>
            g.platform.toLowerCase().includes(q) ||
            r.product.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.rows.length > 0);
  }, [groups, q]);

  // Collapsed by default so the panel scales to many platforms. An active
  // filter force-expands every matching platform so matches are always shown.
  const isOpen = (platform: string) => q !== '' || openPlatforms.has(platform);
  const togglePlatform = (platform: string) =>
    setOpenPlatforms((s) => {
      const next = new Set(s);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });

  return (
    <div className="flex h-full flex-col gap-2 p-3 font-mono text-xs">
      <HeaderRow apiDown={apiDown} loading={loading} total={cadences.length} />

      {!apiDown && !loading && (
        <TermInput
          placeholder="filter platform / product"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter cadences"
        />
      )}

      <div className="flex-1 overflow-y-auto">
        {apiDown ? (
          <div className="py-4 text-center text-term-danger">
            <span className="animate-term-blink">▮</span> endpoint unreachable
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="py-6 text-center text-term-faint">
            {filter ? 'no matches' : '> no cadences registered'}{' '}
            <span className="animate-term-blink">▮</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredGroups.map((g) => (
              <PlatformGroup
                key={g.platform}
                platform={g.platform}
                rows={g.rows}
                expanded={isOpen(g.platform)}
                onToggle={togglePlatform}
                mutState={mutState}
                onSave={saveCadence}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer link to the pipeline deck for schedule + overrides */}
      <div className="border-t border-term-line pt-2 text-[10px] text-term-faint">
        schedule · overrides →{' '}
        <Link
          href="/admin?deck=pipeline"
          className="text-term-mint underline-offset-2 hover:underline"
        >
          pipeline deck
        </Link>
      </div>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function HeaderRow({
  apiDown,
  loading,
  total,
}: {
  apiDown: boolean;
  loading: boolean;
  total: number;
}) {
  if (apiDown) {
    return (
      <div className="flex items-center gap-2 border-b border-term-line pb-2 text-term-danger">
        <span aria-hidden="true">●</span>
        <span className="uppercase tracking-[0.12em]">API UNREACHABLE</span>
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
      <span className="uppercase tracking-[0.12em] text-term-mint">CADENCE</span>
      <span className="text-term-faint">· sync + refresh · {total} · global</span>
    </div>
  );
}

// ── Platform group ──────────────────────────────────────────────────────────────

function PlatformGroup({
  platform,
  rows,
  expanded,
  onToggle,
  mutState,
  onSave,
}: {
  platform: string;
  rows: Cadence[];
  expanded: boolean;
  onToggle: (platform: string) => void;
  mutState: Record<string, MutState>;
  onSave: (p: string, prod: string, patch: CadencePatch) => Promise<void>;
}) {
  const customCount = rows.filter(
    (r) => r.sync_configured || r.refresh_configured,
  ).length;

  return (
    <section aria-label={`${platform} cadences`}>
      {/* Collapsible header — keeps the panel compact across many platforms. */}
      <button
        type="button"
        onClick={() => onToggle(platform)}
        aria-expanded={expanded}
        aria-label={`Toggle ${platform} cadences`}
        className="flex w-full items-center gap-2 border-b border-term-line/40 py-1 text-left transition-colors hover:bg-term-line/10"
      >
        <span className="w-3 shrink-0 text-term-faint" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
        <PlatformTag platform={platform} />
        <span className="text-[10px] text-term-faint">{rows.length} products</span>
        {customCount > 0 && (
          <span className="text-[10px] text-term-mint">· {customCount} custom</span>
        )}
      </button>
      <div className={cn('pl-3', !expanded && 'hidden')}>
        {rows.map((c) => (
          <CadenceRow
            key={`${c.platform}:${c.product}`}
            cadence={c}
            mut={
              mutState[`${c.platform}:${c.product}`] ?? {
                busy: false,
                error: null,
              }
            }
            onSave={onSave}
          />
        ))}
      </div>
    </section>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────────────

/**
 * Each row tracks its own local sync interval, refresh interval and refresh
 * window so values can be typed without committing. APPLY sends only the
 * fields that differ from server state.
 */
function CadenceRow({
  cadence,
  mut,
  onSave,
}: {
  cadence: Cadence;
  mut: MutState;
  onSave: (p: string, prod: string, patch: CadencePatch) => Promise<void>;
}) {
  const [sync, setSync] = useState(cadence.default_interval_seconds);
  const [refresh, setRefresh] = useState(cadence.refresh_interval_seconds);
  const [windowDays, setWindowDays] = useState(cadence.refresh_window_days);

  const patch = useMemo<CadencePatch>(() => {
    const p: CadencePatch = {};
    if (sync !== cadence.default_interval_seconds) p.interval_seconds = sync;
    if (refresh !== cadence.refresh_interval_seconds)
      p.refresh_interval_seconds = refresh;
    if (windowDays !== cadence.refresh_window_days)
      p.refresh_window_days = windowDays;
    return p;
  }, [sync, refresh, windowDays, cadence]);

  const dirty = Object.keys(patch).length > 0;
  const configured = cadence.sync_configured || cadence.refresh_configured;

  const handleApply = () => {
    if (dirty && !mut.busy) {
      void onSave(cadence.platform, cadence.product, patch);
    }
  };

  return (
    <div className="border-b border-term-line/40 py-2 last:border-0">
      {/* Product + configured/default tag */}
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-term-text">{cadence.product}</span>
        <span
          className={cn(
            'rounded px-1 text-[9px] uppercase tracking-wide',
            configured ? 'text-term-mint' : 'text-term-faint',
          )}
        >
          {configured ? 'custom' : 'default'}
        </span>
        <ActionChip
          size="sm"
          variant={dirty ? 'action' : 'ghost'}
          disabled={!dirty || mut.busy}
          onClick={handleApply}
          aria-label={`Apply cadence for ${cadence.platform} ${cadence.product}`}
          className={cn('ml-auto', !dirty && 'opacity-50')}
        >
          {mut.busy ? '…' : 'APPLY'}
        </ActionChip>
      </div>

      {/* Sync interval */}
      <IntervalField
        label="sync"
        idPrefix={`${cadence.platform}-${cadence.product}-sync`}
        value={sync}
        onChange={setSync}
      />

      {/* Refresh interval + window */}
      <div className="mt-1.5">
        <IntervalField
          label="refresh"
          idPrefix={`${cadence.platform}-${cadence.product}-refresh`}
          value={refresh}
          onChange={setRefresh}
        />
        <div className="mt-1 flex items-center gap-2">
          <span className="w-12 shrink-0 text-[10px] text-term-faint">window</span>
          <TermInput
            type="number"
            value={windowDays}
            min={MIN_WINDOW_DAYS}
            max={MAX_WINDOW_DAYS}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            aria-label={`${cadence.platform} ${cadence.product} refresh window in days`}
            className="w-24"
          />
          <span className="text-[10px] text-term-faint">days</span>
        </div>
      </div>

      {/* Inline error */}
      {mut.error && (
        <div className="mt-1 truncate text-[10px] text-term-danger" role="alert">
          {mut.error}
        </div>
      )}
    </div>
  );
}

/** A labelled interval editor: presets + numeric seconds input + human label. */
function IntervalField({
  label,
  idPrefix,
  value,
  onChange,
}: {
  label: string;
  idPrefix: string;
  value: number;
  onChange: (s: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="w-12 shrink-0 text-[10px] text-term-faint">{label}</span>
      <div
        className="flex flex-wrap gap-1"
        role="group"
        aria-label={`${label} presets`}
      >
        {INTERVAL_PRESETS.map((p) => (
          <ActionChip
            key={p.label}
            size="sm"
            variant={value === p.s ? 'primary' : 'ghost'}
            onClick={() => onChange(p.s)}
            aria-label={`Set ${label} interval to ${p.label}`}
          >
            {p.label}
          </ActionChip>
        ))}
      </div>
      <TermInput
        type="number"
        value={value}
        min={MIN_INTERVAL}
        max={MAX_INTERVAL}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${idPrefix} interval in seconds`}
        className="w-28"
      />
      <span className="text-[10px] text-term-faint">{humanInterval(value)}</span>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupByPlatform(
  cadences: Cadence[],
): Array<{ platform: string; rows: Cadence[] }> {
  const groups: Array<{ platform: string; rows: Cadence[] }> = [];
  for (const c of cadences) {
    const last = groups[groups.length - 1];
    if (last && last.platform === c.platform) {
      last.rows.push(c);
    } else {
      groups.push({ platform: c.platform, rows: [c] });
    }
  }
  return groups;
}

function humanInterval(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = seconds / 60;
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 24) return `${parseFloat(h.toFixed(h < 4 ? 1 : 0))}h`;
  return `${Math.round(h / 24)}d`;
}
