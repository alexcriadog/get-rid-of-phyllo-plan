import type { DockviewApi, SerializedDockview } from 'dockview';
import type { PanelId } from '@/components/term/panels/registry';
import { panelTitle } from '@/components/term/panels/registry';

/**
 * Decks (spec §2.2) are the "pages" of the workbench: named preset panel
 * layouts. A deck's default layout is described declaratively as an ordered
 * list of slots, each saying which panel to add and where to attach it
 * relative to an already-placed panel. The workbench replays this list as
 * sequential `dockviewApi.addPanel` calls (see applyDeckLayout) — the first
 * slot seeds the board, each subsequent slot splits off a reference panel.
 *
 * Custom arrangements (user drag/resize/close) are serialized to localStorage
 * per deck; the default layout is the fallback when there's no saved state or
 * after `resetDeck`.
 */
export type DeckId = 'morning-check' | 'pipeline' | 'incident' | 'tenant-service';

/** Direction a slot attaches relative to its reference panel. */
export type SlotDirection = 'left' | 'right' | 'above' | 'below' | 'within';

export interface DeckSlot {
  panel: PanelId;
  /**
   * The already-placed panel this slot splits from. Omitted only for the
   * first slot (which seeds an empty board).
   */
  reference?: PanelId;
  /** Where the new panel lands relative to `reference`. Default 'right'. */
  direction?: SlotDirection;
}

export interface DeckDef {
  id: DeckId;
  label: string;
  /** Default panel composition, replayed left-to-right. */
  layout: DeckSlot[];
}

/**
 * The four shipped decks. Panel lists track spec §2.2; panels not yet built
 * render as placeholders (registry fallback) so the composition is visible now.
 *
 * Layout intent:
 *  - morning-check: left rail (vitals over needs-attention), wide center
 *    (live-activity focused) flanked by a right rail (schedule over queues),
 *    plus tenant-inspector tabbed under needs-attention.
 *  - pipeline: schedule | queues | cadence across the top, rate-limits + a
 *    filtered activity below.
 *  - incident: activity (errors) front and center, queues/DLQ + rate-limits to
 *    the side, raw inspector + vitals stacked.
 *  - tenant-service: directory on the left, inspector tabs center, keys/usage
 *    on the right.
 */
export const DECKS: Record<DeckId, DeckDef> = {
  'morning-check': {
    id: 'morning-check',
    label: 'MORNING CHECK',
    layout: [
      { panel: 'live-activity' },
      { panel: 'vitals', reference: 'live-activity', direction: 'left' },
      { panel: 'needs-attention', reference: 'vitals', direction: 'below' },
      { panel: 'tenant-inspector', reference: 'needs-attention', direction: 'within' },
      { panel: 'schedule', reference: 'live-activity', direction: 'right' },
      { panel: 'queues', reference: 'schedule', direction: 'below' },
    ],
  },
  pipeline: {
    id: 'pipeline',
    label: 'PIPELINE',
    layout: [
      { panel: 'schedule' },
      { panel: 'queues', reference: 'schedule', direction: 'right' },
      { panel: 'cadence', reference: 'queues', direction: 'right' },
      { panel: 'rate-limits', reference: 'schedule', direction: 'below' },
      { panel: 'live-activity', reference: 'rate-limits', direction: 'right' },
    ],
  },
  incident: {
    id: 'incident',
    label: 'INCIDENT',
    layout: [
      { panel: 'live-activity' },
      { panel: 'queues', reference: 'live-activity', direction: 'right' },
      { panel: 'rate-limits', reference: 'queues', direction: 'below' },
      { panel: 'raw-inspector', reference: 'live-activity', direction: 'below' },
      { panel: 'vitals', reference: 'raw-inspector', direction: 'right' },
    ],
  },
  'tenant-service': {
    id: 'tenant-service',
    label: 'TENANT SERVICE',
    layout: [
      { panel: 'tenant-directory' },
      { panel: 'tenant-inspector', reference: 'tenant-directory', direction: 'right' },
      { panel: 'account-inspector', reference: 'tenant-inspector', direction: 'within' },
      { panel: 'usage', reference: 'tenant-inspector', direction: 'right' },
      { panel: 'account-directory', reference: 'tenant-directory', direction: 'below' },
    ],
  },
};

export const DECK_IDS: DeckId[] = Object.keys(DECKS) as DeckId[];
export const DEFAULT_DECK_ID: DeckId = 'morning-check';

export function isDeckId(id: string | null | undefined): id is DeckId {
  return !!id && Object.prototype.hasOwnProperty.call(DECKS, id);
}

// ── Persistence ─────────────────────────────────────────────────────────────

/** Versioned per-deck localStorage key. Bump the suffix to invalidate. */
export function deckStorageKey(id: DeckId): string {
  return `term.deck.${id}.v1`;
}

/**
 * Save a serialized dockview layout for a deck. Tolerates private-mode /
 * quota failures silently — a lost custom layout just falls back to default.
 */
export function saveDeckLayout(id: DeckId, layout: SerializedDockview): void {
  try {
    window.localStorage.setItem(deckStorageKey(id), JSON.stringify(layout));
  } catch {
    // ignore (private mode, quota)
  }
}

/** Load a saved layout, or null if none / corrupt. */
export function loadDeckLayout(id: DeckId): SerializedDockview | null {
  try {
    const raw = window.localStorage.getItem(deckStorageKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SerializedDockview;
    // Minimal shape guard — a corrupt blob shouldn't crash the board.
    if (!parsed || typeof parsed !== 'object' || !parsed.grid) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Clear a deck's saved layout so it returns to its default composition. */
export function resetDeck(id: DeckId): void {
  try {
    window.localStorage.removeItem(deckStorageKey(id));
  } catch {
    // ignore
  }
}

// ── Layout application ──────────────────────────────────────────────────────

/**
 * Build a deck on a dockview board. Restores a saved custom layout when one
 * exists and is valid; otherwise replays the deck's default slot list.
 * Always clears the board first so deck switches don't accumulate panels.
 */
export function applyDeck(api: DockviewApi, id: DeckId): void {
  api.clear();
  const saved = loadDeckLayout(id);
  if (saved) {
    try {
      api.fromJSON(saved);
      return;
    } catch {
      // Saved layout incompatible (e.g. references a removed panel) — fall
      // through to the default so the deck still opens.
      resetDeck(id);
      api.clear();
    }
  }
  applyDeckLayout(api, DECKS[id]);
}

/** Replay a deck's default slot list as sequential addPanel calls. */
export function applyDeckLayout(api: DockviewApi, deck: DeckDef): void {
  deck.layout.forEach((slot, i) => {
    api.addPanel({
      id: panelInstanceId(deck.id, slot.panel),
      component: slot.panel,
      title: panelTitle(slot.panel),
      params: { panelId: slot.panel },
      // First slot seeds the empty board (no position); the rest split off a
      // reference panel. `inactive` keeps the natural first-panel focus.
      ...(i === 0 || !slot.reference
        ? {}
        : {
            position: {
              referencePanel: panelInstanceId(deck.id, slot.reference),
              direction: slot.direction ?? 'right',
            },
          }),
    });
  });
  // Focus the first panel so ⌘1 and the status bar have a sensible default.
  const first = deck.layout[0];
  if (first) api.getPanel(panelInstanceId(deck.id, first.panel))?.api.setActive();
}

/**
 * dockview panel ids must be unique on a board. A panel type can appear in
 * multiple decks, so we namespace the instance id by deck. The panel type is
 * also carried in `params.panelId` for the component lookup.
 */
export function panelInstanceId(deck: DeckId, panel: PanelId): string {
  return `${deck}:${panel}`;
}

// ── URL state ───────────────────────────────────────────────────────────────

/** Read the deck id from a `?deck=` query value, falling back to the default. */
export function deckFromQuery(value: string | string[] | undefined): DeckId {
  const raw = Array.isArray(value) ? value[0] : value;
  return isDeckId(raw) ? raw : DEFAULT_DECK_ID;
}
