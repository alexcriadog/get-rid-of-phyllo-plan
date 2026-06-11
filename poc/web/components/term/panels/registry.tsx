import type { ComponentType } from 'react';
import dynamic from 'next/dynamic';
import PlaceholderPanel from './PlaceholderPanel';

/**
 * The panel catalog (spec §4). Every capability in the workbench is a panel
 * addressed by a stable `PanelId`. Decks (lib/term/decks.ts), the command
 * palette, and dockview all reference panels through these ids.
 *
 * ── Adding a panel (Phase 3/4 authors, read this) ───────────────────────────
 * 1. Add the id to the `PanelId` union below.
 * 2. Add one entry to `PANEL_DEFS`: a human `title` (shown in the tab chrome,
 *    uppercased) and a `component`. Wrap real panels in `lazy()` (an alias for
 *    next/dynamic with ssr:false) so each panel ships in its own chunk and only
 *    polls once mounted (spec §8).
 * 3. Reference the id from a deck slot in lib/term/decks.ts to place it.
 *
 * A panel component receives NO required props — it pulls its own data via the
 * useLive polling hook (see SystemVitalsPanel for the canonical pattern) and
 * composes the Phase 1 term primitives. Its chrome (title bar, close, focus
 * accent) is supplied by PanelChrome via dockview's tab renderer; the panel
 * only renders its body, which the workbench wraps in `role="region"` +
 * aria-label automatically.
 *
 * An id that appears in a deck but is missing from `PANEL_DEFS` (or is listed
 * here with no real component) falls back to PlaceholderPanel — the board never
 * breaks because a panel is unimplemented.
 */
export type PanelId =
  | 'vitals'
  | 'needs-attention'
  | 'live-activity'
  | 'schedule'
  | 'queues'
  | 'cadence'
  | 'rate-limits'
  | 'kpi-stats'
  | 'tenant-directory'
  | 'tenant-inspector'
  | 'account-directory'
  | 'account-inspector'
  | 'capability-matrix'
  | 'usage'
  | 'runtime-settings'
  | 'raw-inspector';

export interface PanelDef {
  /** Human title rendered (uppercased) in the panel chrome and palette. */
  title: string;
  /** Panel body component. No required props — panels self-fetch. */
  component: ComponentType;
}

/**
 * next/dynamic with SSR disabled. Panels only ever render inside the
 * client-only workbench, and several touch `window` (useLive's polling).
 * Keeping ssr:false also keeps them out of the server bundle entirely.
 */
function lazy(loader: () => Promise<{ default: ComponentType }>): ComponentType {
  return dynamic(loader, {
    ssr: false,
    loading: () => (
      <div className="p-4 font-mono text-xs text-term-faint">
        ▮▮▮▯▯ loading… <span className="animate-term-blink text-term-mint">▮</span>
      </div>
    ),
  });
}

/** Binds a fixed id into a zero-prop placeholder component. */
function placeholder(id: string): ComponentType {
  const Bound = () => <PlaceholderPanel id={id} />;
  Bound.displayName = `Placeholder(${id})`;
  return Bound;
}

/**
 * The catalog. Phase 2 ships ONE real panel (vitals) to prove the data flow;
 * everything else is a titled placeholder so the four default decks render
 * their full intended composition. Phase 3/4 swap the `component` for a real
 * `lazy(() => import(...))` without touching any deck or shell code.
 */
export const PANEL_DEFS: Record<PanelId, PanelDef> = {
  vitals: {
    title: 'System Vitals',
    component: lazy(() => import('./SystemVitalsPanel')),
  },
  'needs-attention': { title: 'Needs Attention', component: lazy(() => import('./NeedsAttentionPanel')) },
  'live-activity': { title: 'Live Activity', component: lazy(() => import('./LiveActivityPanel')) },
  schedule: { title: 'Schedule', component: lazy(() => import('./SchedulePanel')) },
  queues: { title: 'Queues & DLQ', component: lazy(() => import('./QueuesPanel')) },
  cadence: { title: 'Cadence', component: placeholder('cadence') },
  'rate-limits': { title: 'Rate Limits & Locks', component: placeholder('rate-limits') },
  'kpi-stats': { title: 'KPI Stats', component: lazy(() => import('./KpiStatsPanel')) },
  'tenant-directory': { title: 'Tenant Directory', component: placeholder('tenant-directory') },
  'tenant-inspector': { title: 'Tenant Inspector', component: placeholder('tenant-inspector') },
  'account-directory': { title: 'Account Directory', component: placeholder('account-directory') },
  'account-inspector': { title: 'Account Inspector', component: placeholder('account-inspector') },
  'capability-matrix': { title: 'Capability Matrix', component: placeholder('capability-matrix') },
  usage: { title: 'Usage & Storage', component: placeholder('usage') },
  'runtime-settings': { title: 'Runtime Settings', component: placeholder('runtime-settings') },
  'raw-inspector': { title: 'Raw Inspector', component: lazy(() => import('./RawInspectorPanel')) },
};

/** True when `id` is a known panel in the catalog. */
export function isPanelId(id: string): id is PanelId {
  return Object.prototype.hasOwnProperty.call(PANEL_DEFS, id);
}

/** Resolve a panel id to its def, falling back to a placeholder for unknown ids. */
export function resolvePanel(id: string): PanelDef {
  if (isPanelId(id)) return PANEL_DEFS[id];
  return { title: id, component: placeholder(id) };
}

/** Title for a panel id (uppercased chrome label is applied by PanelChrome). */
export function panelTitle(id: string): string {
  return resolvePanel(id).title;
}

/** All known panel ids, for the palette "open panel" group. */
export const ALL_PANEL_IDS: PanelId[] = Object.keys(PANEL_DEFS) as PanelId[];
