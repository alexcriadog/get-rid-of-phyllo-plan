/**
 * CadencePanel — Phase 4 workbench panel (id: "cadence").
 *
 * Ports `pages/admin/cadence.tsx` into the Mint Terminal idiom.
 *
 * Data sources:
 *   GET /admin/cadences              — default interval per (platform × product)
 *   PATCH /admin/cadences/:p/:prod   — update default interval
 *
 * The legacy page has three tabs (Defaults, Upcoming Schedule, Active Overrides).
 * The schedule tab renders a Heatmap that is not a Phase 1 term primitive and
 * is too wide/complex for a panel tile; it is omitted here.
 * The overrides tab requires /admin/accounts (heavy payload). Both heavy tabs
 * are left out and a footer link routes to the full legacy page.
 *
 * Edit affordance: the legacy page edits via a simple PATCH endpoint, so
 * inline editing is fully supported here with TermInput + APPLY ActionChip per
 * row. Errors surface inline. Presets (30m / 1h / 2h / 6h / 24h) are rendered
 * as small ghost chips.
 *
 * Global scope — cadences apply across all workspaces; no workspace filter.
 */

'use client';

import { useState } from 'react';
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
};

// ── Constants ─────────────────────────────────────────────────────────────────

const PRESETS: Array<{ label: string; s: number }> = [
  { label: '30m', s: 1800 },
  { label: '1h', s: 3600 },
  { label: '2h', s: 7200 },
  { label: '6h', s: 21600 },
  { label: '24h', s: 86400 },
];

// ── Main component ─────────────────────────────────────────────────────────────

export default function CadencePanel() {
  const cadencesLive = useLive<Cadence[]>('/admin/cadences', POLL.list);
  const cadences = cadencesLive.data ?? [];
  const apiDown = !!cadencesLive.error && !cadencesLive.data;
  const loading = cadencesLive.loading && !cadencesLive.data;

  const [mutState, setMutState] = useState<
    Record<string, { busy: boolean; error: string | null }>
  >({});

  const updateInterval = async (
    platform: string,
    product: string,
    intervalSeconds: number,
  ) => {
    const k = `${platform}:${product}`;
    setMutState((s) => ({ ...s, [k]: { busy: true, error: null } }));
    try {
      await adminPatch(`/admin/cadences/${platform}/${product}`, {
        interval_seconds: intervalSeconds,
      });
      setMutState((s) => ({ ...s, [k]: { busy: false, error: null } }));
      cadencesLive.refresh();
    } catch (e) {
      setMutState((s) => ({
        ...s,
        [k]: { busy: false, error: (e as Error).message },
      }));
    }
  };

  return (
    <div className="flex h-full flex-col gap-2 p-3 font-mono text-xs">
      {/* Header */}
      <HeaderRow apiDown={apiDown} loading={loading} />

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {apiDown ? (
          <div className="py-4 text-center text-term-danger">
            <span className="animate-term-blink">▮</span> endpoint unreachable
          </div>
        ) : (
          <CadenceTable
            cadences={cadences}
            mutState={mutState}
            onSave={updateInterval}
          />
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

function HeaderRow({ apiDown, loading }: { apiDown: boolean; loading: boolean }) {
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
      <span aria-hidden="true" className="text-term-mint">●</span>
      <span className="uppercase tracking-[0.12em] text-term-mint">CADENCE</span>
      <span className="text-term-faint">· default intervals · global</span>
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────

/**
 * Each row tracks its own local interval value so the user can type a new
 * value without committing immediately. The APPLY chip becomes active only
 * when the value is dirty (different from server state).
 */
function CadenceTable({
  cadences,
  mutState,
  onSave,
}: {
  cadences: Cadence[];
  mutState: Record<string, { busy: boolean; error: string | null }>;
  onSave: (platform: string, product: string, s: number) => Promise<void>;
}) {
  if (cadences.length === 0) {
    return (
      <div className="py-6 text-center text-term-faint">
        &gt; no cadences registered <span className="animate-term-blink">▮</span>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {cadences.map((c) => (
        <CadenceRow
          key={`${c.platform}:${c.product}`}
          cadence={c}
          mut={mutState[`${c.platform}:${c.product}`] ?? { busy: false, error: null }}
          onSave={onSave}
        />
      ))}
    </div>
  );
}

function CadenceRow({
  cadence,
  mut,
  onSave,
}: {
  cadence: Cadence;
  mut: { busy: boolean; error: string | null };
  onSave: (platform: string, product: string, s: number) => Promise<void>;
}) {
  const [value, setValue] = useState(cadence.default_interval_seconds);
  const dirty = value !== cadence.default_interval_seconds;

  const handleApply = () => {
    if (dirty && !mut.busy) {
      void onSave(cadence.platform, cadence.product, value);
    }
  };

  return (
    <div className="border-b border-term-line/60 py-2 last:border-0">
      {/* Row header: platform + product + human label */}
      <div className="mb-1.5 flex items-center gap-2">
        <PlatformTag platform={cadence.platform} />
        <span className="text-term-text">{cadence.product}</span>
        <span className="ml-auto text-[10px] text-term-faint">
          {humanInterval(value)}
        </span>
      </div>

      {/* Preset chips */}
      <div className="mb-1.5 flex flex-wrap gap-1" role="group" aria-label={`Presets for ${cadence.platform} ${cadence.product}`}>
        {PRESETS.map((p) => (
          <ActionChip
            key={p.label}
            size="sm"
            variant={value === p.s ? 'primary' : 'ghost'}
            onClick={() => setValue(p.s)}
            aria-label={`Set interval to ${p.label}`}
          >
            {p.label}
          </ActionChip>
        ))}
      </div>

      {/* Custom input + apply */}
      <div className="flex items-center gap-2">
        <TermInput
          type="number"
          value={value}
          min={60}
          max={30 * 86400}
          onChange={(e) => setValue(Number(e.target.value))}
          aria-label={`${cadence.platform} ${cadence.product} interval in seconds`}
          className="flex-1"
        />
        <ActionChip
          size="sm"
          variant={dirty ? 'action' : 'ghost'}
          disabled={!dirty || mut.busy}
          onClick={handleApply}
          aria-label={`Apply cadence for ${cadence.platform} ${cadence.product}`}
          className={cn(!dirty && 'opacity-50')}
        >
          {mut.busy ? '…' : 'APPLY'}
        </ActionChip>
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function humanInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = seconds / 60;
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 24) return `${parseFloat(h.toFixed(h < 4 ? 1 : 0))}h`;
  return `${Math.round(h / 24)}d`;
}
