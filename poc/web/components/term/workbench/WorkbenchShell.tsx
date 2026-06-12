import { useCallback, useEffect, useMemo, useRef, useState, type FunctionComponent } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type IDockviewReactProps,
} from 'dockview';
import 'dockview/dist/styles/dockview.css';

import WorkspaceSelect from '@/components/WorkspaceSelect';
import ThemeToggle from '@/components/ThemeToggle';
import { useLive, POLL } from '@/lib/useLive';
import { cn } from '@/lib/utils';
import {
  DECKS,
  applyDeck,
  deckFromQuery,
  panelInstanceId,
  saveDeckLayout,
  type DeckId,
} from '@/lib/term/decks';
import { PANEL_DEFS, isPanelId, type PanelId } from '@/components/term/panels/registry';
import { selectWorkspace, selectAccount } from '@/lib/term/selection';
import { extractQueryParam } from '@/pages/admin';
import PanelChrome, { withPanelRegion } from './PanelChrome';
import DeckTabs from './DeckTabs';
import StatusBar from './StatusBar';
import CmdPalette, { type PaletteActions } from './CmdPalette';
import MobileStacked from './MobileStacked';
import { TERM_DOCKVIEW_THEME } from './theme';

/** Health payload — slowest store latency feeds the status bar + header dot. */
type StoreHealth = { ok: boolean; latency_ms: number | null };
type SystemHealth = {
  mysql: StoreHealth;
  mongo: StoreHealth;
  redis: StoreHealth;
  summary: 'ok' | 'warn' | 'danger';
};

const MOBILE_QUERY = '(max-width: 1023px)';
const SAVE_DEBOUNCE_MS = 400;

/** Distinct panel count per deck (status bar value in mobile stacked mode). */
const DECK_DISTINCT_COUNT: Record<DeckId, number> = (
  Object.keys(DECKS) as DeckId[]
).reduce(
  (acc, id) => {
    acc[id] = new Set(DECKS[id].layout.map((s) => s.panel)).size;
    return acc;
  },
  {} as Record<DeckId, number>,
);

/**
 * The Ops Terminal workbench shell (spec §2). A full-viewport, mono, dark-or-
 * paper surface: top bar (brand + decks + controls), a dockview tiling board
 * whose layout *is* the deck, a status bar, and the ⌘K palette. Below 1024px it
 * swaps the board for a stacked single-panel mode.
 *
 * Rendered client-only (the page imports it via next/dynamic ssr:false) because
 * dockview touches `window` and panels poll on mount.
 */
export default function WorkbenchShell() {
  const router = useRouter();
  const apiRef = useRef<DockviewApi | null>(null);
  const saveTimer = useRef<number | null>(null);
  const deckRef = useRef<DeckId>(deckFromQuery(undefined));
  /** True while applyDeck is rebuilding the board — saves must be suppressed. */
  const isApplyingRef = useRef(false);
  /**
   * Tracks the last (api instance, deckId) pair that was applied. Used to
   * prevent the double-apply that occurs when both onReady and the URL-sync
   * effect fire for the same deck on the same board instance. Keyed on the
   * API object reference so that React Strict Mode double-mount (which creates
   * a new API instance) always gets a fresh apply.
   */
  const lastAppliedRef = useRef<{ api: DockviewApi; deckId: DeckId } | null>(null);

  const [deck, setDeck] = useState<DeckId>(() => deckFromQuery(undefined));
  const [panelCount, setPanelCount] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const health = useLive<SystemHealth>('/admin/system/health', POLL.config);
  const apiDown = !!health.error && !health.data;
  const apiLatencyMs = slowestLatency(health.data);

  // Mirror deck into a ref so dockview event closures read the current value
  // without re-subscribing.
  useEffect(() => {
    deckRef.current = deck;
  }, [deck]);

  // ── Responsive switch ──────────────────────────────────────────────────
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const sync = () => setIsMobile(mql.matches);
    sync();
    mql.addEventListener('change', sync);
    return () => mql.removeEventListener('change', sync);
  }, []);

  // ── Deck ↔ URL sync (read on mount + on back/forward) ──────────────────
  useEffect(() => {
    if (!router.isReady) return;
    const next = deckFromQuery(router.query.deck);
    setDeck(next);
    if (apiRef.current) {
      applyDeckSafe(apiRef.current, next);
      setPanelCount(apiRef.current.panels.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query.deck]);

  // ── Object permalink params (spec §2.3): ?workspace=<slug> / ?account=<id>
  // Consumed once when the router is ready. We store pending permalink actions
  // in a ref so they can be applied after the dockview board is ready. The
  // openPanel callback is defined below; we use a stable ref to avoid a
  // dependency cycle between the two useEffects.
  const permalinkApplied = useRef(false);
  const openPanelRef = useRef<((id: PanelId) => void) | null>(null);

  // ── dockview components map (one wrapped entry per registry panel) ──────
  const components = useMemo<IDockviewReactProps['components']>(() => {
    const map: Record<string, FunctionComponent<IDockviewPanelProps>> = {};
    (Object.keys(PANEL_DEFS) as PanelId[]).forEach((id) => {
      const def = PANEL_DEFS[id];
      map[id] = withPanelRegion(def.component, () => def.title);
    });
    return map;
  }, []);

  // ── Persist layout (debounced) ─────────────────────────────────────────
  const persist = useCallback(() => {
    // No-op while applyDeck is rebuilding — the board is mid-clear and any
    // snapshot taken here would capture an empty or partially-built layout.
    if (isApplyingRef.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const api = apiRef.current;
      if (!api) return;
      saveDeckLayout(deckRef.current, api.toJSON());
    }, SAVE_DEBOUNCE_MS);
  }, []);

  /**
   * Wrapper around the library's applyDeck that:
   *  - Skips if the deck is already the last-applied one (prevents double-apply
   *    that happens when both onReady and the URL-sync effect fire for the same
   *    deck on initial load).
   *  - Suspends the save handler while the board is being rebuilt.
   *  - Cancels any pending debounced save before starting.
   */
  const applyDeckSafe = useCallback(
    (api: DockviewApi, id: DeckId) => {
      // Skip only when the SAME api instance already has this deck applied.
      // Using the api object reference as the key means React Strict Mode's
      // double-mount (new api instance) always gets a fresh apply.
      if (lastAppliedRef.current?.api === api && lastAppliedRef.current?.deckId === id) return;
      // Cancel any pending debounced save from the previous deck state.
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      isApplyingRef.current = true;
      try {
        applyDeck(api, id, isPanelId);
        lastAppliedRef.current = { api, deckId: id };
      } finally {
        isApplyingRef.current = false;
      }
    },
    [],
  );

  // ── dockview ready: apply deck + wire events ───────────────────────────
  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      apiRef.current = event.api;
      applyDeckSafe(event.api, deckRef.current);
      setPanelCount(event.api.panels.length);

      const syncCount = () => setPanelCount(event.api.panels.length);
      event.api.onDidAddPanel(syncCount);
      event.api.onDidRemovePanel(syncCount);
      event.api.onDidLayoutChange(persist);
    },
    [persist, applyDeckSafe],
  );

  // ── Deck switch ────────────────────────────────────────────────────────
  const switchDeck = useCallback(
    (next: DeckId) => {
      setDeck(next);
      if (apiRef.current) {
        // An explicit user switch must always re-apply even if the same deck
        // id is active (e.g. the user hit "reset"). Clear the guard first so
        // applyDeckSafe doesn't skip this call.
        lastAppliedRef.current = null;
        applyDeckSafe(apiRef.current, next);
        setPanelCount(apiRef.current.panels.length);
      }
      // Shallow URL update — no data refetch, no scroll reset.
      void router.replace({ pathname: router.pathname, query: { deck: next } }, undefined, {
        shallow: true,
      });
    },
    [router, applyDeckSafe],
  );

  // ── Open a panel into the current deck (palette action) ────────────────
  const openPanel = useCallback((id: PanelId) => {
    const api = apiRef.current;
    if (!api) return;
    const instanceId = panelInstanceId(deckRef.current, id);
    const existing = api.getPanel(instanceId);
    if (existing) {
      existing.api.setActive();
      return;
    }
    api.addPanel({
      id: instanceId,
      component: id,
      title: PANEL_DEFS[id].title,
      params: { panelId: id },
      ...(api.activePanel
        ? { position: { referencePanel: api.activePanel.id, direction: 'within' as const } }
        : {}),
    });
  }, []);

  // Keep the openPanel ref in sync so the permalink effect can call it after it
  // has been defined (the ref pattern avoids a stale-closure / ordering issue).
  openPanelRef.current = openPanel;

  // ── Apply permalink params once the router AND board are ready ─────────
  // This effect fires on every router.isReady / router.query change (same dep
  // list as the deck sync effect) but the `permalinkApplied` guard ensures it
  // only acts once per page load. We use apiRef so we don't depend on board
  // state at hook definition time.
  useEffect(() => {
    if (!router.isReady || permalinkApplied.current) return;
    const workspaceSlug = extractQueryParam(router.query.workspace);
    const accountId = extractQueryParam(router.query.account);
    const panelParam = extractQueryParam(router.query.panel);
    const panelId = panelParam && isPanelId(panelParam) ? panelParam : null;
    if (!workspaceSlug && !accountId && !panelId) return;

    permalinkApplied.current = true;

    if (workspaceSlug) {
      selectWorkspace(workspaceSlug);
      openPanelRef.current?.('tenant-inspector');
    }
    if (accountId) {
      selectAccount(accountId);
      openPanelRef.current?.('account-inspector');
    }
    // ?panel=<id> opens/focuses an explicit panel in the current deck. The
    // deck-sync effect (same dep list) has already applied the deck onto the
    // board by the time this runs, so openPanel either focuses the existing
    // instance or adds it beside the active panel.
    if (panelId) {
      openPanelRef.current?.(panelId);
    }

    // Strip the permalink params without losing other query params.
    const { workspace: _ws, account: _ac, panel: _pn, ...rest } = router.query;
    void router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query.workspace, router.query.account, router.query.panel]);

  const paletteActions = useMemo<PaletteActions>(
    () => ({ switchDeck, openPanel }),
    [switchDeck, openPanel],
  );

  // ── ⌘1–9 → focus the nth panel in the current deck ─────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key < '1' || e.key > '9') return;
      const api = apiRef.current;
      if (!api) return;
      const panel = api.panels[Number(e.key) - 1];
      if (panel) {
        e.preventDefault();
        panel.api.setActive();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-term-bg font-mono text-term-text">
      <Head>
        <title>Ops Terminal — Camaleonic Connect</title>
      </Head>

      <TopBar
        deck={deck}
        onSelectDeck={switchDeck}
        onOpenPalette={() => setPaletteOpen(true)}
        health={health.data}
        apiDown={apiDown}
      />

      <main className="relative flex min-h-0 flex-1 flex-col">
        {isMobile ? (
          <MobileStacked deck={deck} />
        ) : (
          <DockviewReact
            className="term-workbench h-full w-full"
            theme={TERM_DOCKVIEW_THEME}
            components={components}
            defaultTabComponent={PanelChrome}
            disableFloatingGroups
            singleTabMode="default"
            onReady={onReady}
          />
        )}
      </main>

      <StatusBar
        deck={deck}
        panelCount={isMobile ? DECK_DISTINCT_COUNT[deck] : panelCount}
        apiLatencyMs={apiLatencyMs}
        apiDown={apiDown}
      />

      <CmdPalette open={paletteOpen} onOpenChange={setPaletteOpen} actions={paletteActions} />
    </div>
  );
}

// ── Top bar ────────────────────────────────────────────────────────────────

function TopBar({
  deck,
  onSelectDeck,
  onOpenPalette,
  health,
  apiDown,
}: {
  deck: DeckId;
  onSelectDeck: (id: DeckId) => void;
  onOpenPalette: () => void;
  health: SystemHealth | null;
  apiDown: boolean;
}) {
  return (
    <header className="relative flex h-11 shrink-0 items-center gap-4 border-b border-term-line bg-term-bg px-3">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="grid h-4 w-4 place-items-center border-[1.5px] border-term-mint"
        />
        <div className="flex flex-col leading-none">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-term-mint">
            Camaleonic Connect
          </span>
          <span className="text-[9px] uppercase tracking-[0.2em] text-term-faint">
            Ops Terminal
          </span>
        </div>
      </div>

      <div className="ml-2 hidden lg:block">
        <DeckTabs active={deck} onSelect={onSelectDeck} />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <WorkspaceSelect />
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="Open command palette"
          className={cn(
            'inline-flex h-7 items-center gap-1.5 border border-term-line-2 px-2',
            'font-mono text-[11px] uppercase tracking-[0.08em] text-term-muted',
            'transition-colors duration-150 hover:border-term-faint hover:text-term-text',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-term-mint',
          )}
        >
          <kbd className="text-term-mint">⌘K</kbd>
          <span className="hidden sm:inline">palette</span>
        </button>
        <ThemeToggle />
        <HealthDot health={health} apiDown={apiDown} />
      </div>

      {/* Decks move under the brand on narrow desktop widths. */}
      <div className="absolute inset-x-0 top-11 z-10 border-b border-term-line bg-term-bg px-3 py-1.5 lg:hidden">
        <DeckTabs active={deck} onSelect={onSelectDeck} />
      </div>
    </header>
  );
}

function HealthDot({ health, apiDown }: { health: SystemHealth | null; apiDown: boolean }) {
  const { tone, label } = healthState(health, apiDown);
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-term-muted">
      <span aria-hidden="true" className={tone}>
        ●
      </span>
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

function healthState(
  health: SystemHealth | null,
  apiDown: boolean,
): { tone: string; label: string } {
  if (apiDown) return { tone: 'text-term-danger', label: 'API DOWN' };
  if (!health) return { tone: 'text-term-faint', label: 'CONNECTING' };
  if (health.summary === 'ok') return { tone: 'text-term-mint', label: 'HEALTHY' };
  if (health.summary === 'warn') return { tone: 'text-term-warn', label: 'WARN' };
  return { tone: 'text-term-danger', label: 'DEGRADED' };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function slowestLatency(health: SystemHealth | null): number | null {
  if (!health) return null;
  const lat = [health.mysql, health.mongo, health.redis]
    .map((s) => (s?.ok ? s.latency_ms : null))
    .filter((n): n is number => n != null);
  return lat.length ? Math.max(...lat) : null;
}
