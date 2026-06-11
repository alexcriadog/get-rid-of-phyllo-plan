import { describe, expect, it, beforeEach } from 'vitest';
import type { SerializedDockview } from 'dockview';
import {
  DECKS,
  DECK_IDS,
  DEFAULT_DECK_ID,
  deckFromQuery,
  deckStorageKey,
  isDeckId,
  isValidSerializedLayout,
  loadDeckLayout,
  panelInstanceId,
  resetDeck,
  saveDeckLayout,
  type DeckId,
} from '../decks';
import { isPanelId } from '@/components/term/panels/registry';

const SLOT_DIRECTIONS = new Set(['left', 'right', 'above', 'below', 'within']);

describe('deck definitions', () => {
  it('ships exactly the four spec decks', () => {
    expect(DECK_IDS.slice().sort()).toEqual(
      ['incident', 'morning-check', 'pipeline', 'tenant-service'].sort(),
    );
  });

  it('every deck has a non-empty layout whose first slot seeds the board', () => {
    for (const id of DECK_IDS) {
      const layout = DECKS[id].layout;
      expect(layout.length).toBeGreaterThan(0);
      // First slot has no reference (it seeds the empty board).
      expect(layout[0].reference).toBeUndefined();
    }
  });

  it('every referenced panel id resolves in the registry', () => {
    for (const id of DECK_IDS) {
      for (const slot of DECKS[id].layout) {
        // Default-deck panels are all real registry ids in Phase 2.
        expect(isPanelId(slot.panel)).toBe(true);
      }
    }
  });

  it('non-seed slots reference an already-placed panel with a valid direction', () => {
    for (const id of DECK_IDS) {
      const placed = new Set<string>();
      DECKS[id].layout.forEach((slot, i) => {
        if (i > 0) {
          expect(slot.reference).toBeDefined();
          // The reference must have been placed by an earlier slot.
          expect(placed.has(slot.reference as string)).toBe(true);
          if (slot.direction) expect(SLOT_DIRECTIONS.has(slot.direction)).toBe(true);
        }
        placed.add(slot.panel);
      });
    }
  });
});

describe('deck id helpers', () => {
  it('isDeckId narrows known ids', () => {
    expect(isDeckId('morning-check')).toBe(true);
    expect(isDeckId('nope')).toBe(false);
    expect(isDeckId(null)).toBe(false);
    expect(isDeckId(undefined)).toBe(false);
  });

  it('deckFromQuery falls back to the default for unknown / missing values', () => {
    expect(deckFromQuery('incident')).toBe('incident');
    expect(deckFromQuery(['pipeline', 'x'])).toBe('pipeline');
    expect(deckFromQuery('garbage')).toBe(DEFAULT_DECK_ID);
    expect(deckFromQuery(undefined)).toBe(DEFAULT_DECK_ID);
  });

  it('panelInstanceId namespaces by deck so the same panel is unique per board', () => {
    expect(panelInstanceId('incident', 'vitals')).toBe('incident:vitals');
    expect(panelInstanceId('morning-check', 'vitals')).not.toBe(
      panelInstanceId('incident', 'vitals'),
    );
  });
});

// ── Layout helpers ──────────────────────────────────────────────────────────

/**
 * Minimal valid serialized layout: one leaf with one known panel view id.
 * Uses the real dockview leaf shape: data = { views: string[], activeView, id }.
 */
function validLayout(deckId: DeckId = 'morning-check', panelId = 'vitals'): SerializedDockview {
  const viewId = `${deckId}:${panelId}`;
  return {
    grid: {
      root: {
        type: 'leaf',
        data: { views: [viewId], activeView: viewId, id: '1' },
        size: 1,
      },
      height: 800,
      width: 1200,
      orientation: 'HORIZONTAL',
    },
    panels: {
      [viewId]: {
        id: viewId,
        contentComponent: panelId,
        tabComponent: 'props.defaultTabComponent',
        params: { panelId },
        title: panelId,
      },
    },
  } as unknown as SerializedDockview;
}

/**
 * Zero-panel layout: branch root with no children (no leaf nodes at all).
 */
function zeroPanelLayout(): SerializedDockview {
  return {
    grid: {
      root: { type: 'branch', data: [] },
      height: 800,
      width: 1200,
      orientation: 'HORIZONTAL',
    },
    panels: {},
  } as unknown as SerializedDockview;
}

/**
 * The exact corrupt artifact that triggered this bug:
 * a leaf with data.views = [] (empty array) and a dangling activeView.
 * This matches the real shape found in localStorage:
 * {"views":[],"activeView":"morning-check:vitals"}
 */
function corruptEmptyViewsArtifact(): SerializedDockview {
  return {
    grid: {
      root: {
        type: 'leaf',
        data: { views: [], activeView: 'morning-check:vitals', id: '1' },
        size: 1,
      },
      height: 800,
      width: 1200,
      orientation: 'HORIZONTAL',
    },
    panels: {},
    activeGroup: '1',
  } as unknown as SerializedDockview;
}

// ── isValidSerializedLayout tests ───────────────────────────────────────────

describe('isValidSerializedLayout', () => {
  it('accepts a minimal known-good layout', () => {
    expect(isValidSerializedLayout(validLayout(), isPanelId)).toBe(true);
  });

  it('accepts a layout with multiple known panels in nested branches', () => {
    const layout: SerializedDockview = {
      grid: {
        root: {
          type: 'branch',
          data: [
            { type: 'leaf', data: { views: ['morning-check:vitals'], activeView: 'morning-check:vitals', id: '1' }, size: 1 },
            { type: 'leaf', data: { views: ['morning-check:queues'], activeView: 'morning-check:queues', id: '2' }, size: 1 },
          ],
        },
        height: 800,
        width: 1200,
        orientation: 'HORIZONTAL',
      },
      panels: {},
    } as unknown as SerializedDockview;
    expect(isValidSerializedLayout(layout, isPanelId)).toBe(true);
  });

  it('rejects the exact corrupt artifact — leaf with empty views array', () => {
    expect(isValidSerializedLayout(corruptEmptyViewsArtifact(), isPanelId)).toBe(false);
  });

  it('rejects a zero-panel layout (branch root with no leaves)', () => {
    expect(isValidSerializedLayout(zeroPanelLayout(), isPanelId)).toBe(false);
  });

  it('rejects a layout containing an unknown panel id', () => {
    const layout: SerializedDockview = {
      grid: {
        root: {
          type: 'leaf',
          data: { views: ['morning-check:ghost-panel-does-not-exist'], activeView: 'morning-check:ghost-panel-does-not-exist', id: '1' },
          size: 1,
        },
        height: 800,
        width: 1200,
        orientation: 'HORIZONTAL',
      },
      panels: {},
    } as unknown as SerializedDockview;
    expect(isValidSerializedLayout(layout, isPanelId)).toBe(false);
  });

  it('rejects when grid is absent', () => {
    expect(isValidSerializedLayout({} as SerializedDockview, isPanelId)).toBe(false);
  });
});

// ── saveDeckLayout empty-guard tests ────────────────────────────────────────

describe('saveDeckLayout empty-panel guard', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('does NOT persist a zero-panel layout', () => {
    const id: DeckId = 'morning-check';
    saveDeckLayout(id, zeroPanelLayout());
    expect(window.localStorage.getItem(deckStorageKey(id))).toBeNull();
  });

  it('does NOT persist the corrupt empty-views artifact', () => {
    const id: DeckId = 'morning-check';
    saveDeckLayout(id, corruptEmptyViewsArtifact());
    expect(window.localStorage.getItem(deckStorageKey(id))).toBeNull();
  });

  it('persists a layout that has at least one panel', () => {
    const id: DeckId = 'morning-check';
    saveDeckLayout(id, validLayout(id, 'vitals'));
    expect(window.localStorage.getItem(deckStorageKey(id))).not.toBeNull();
  });
});

// ── deck layout persistence ──────────────────────────────────────────────────

describe('deck layout persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips a saved layout through localStorage', () => {
    const id: DeckId = 'pipeline';
    const layout = validLayout(id, 'schedule');
    expect(loadDeckLayout(id)).toBeNull();
    saveDeckLayout(id, layout);
    expect(window.localStorage.getItem(deckStorageKey(id))).toBeTruthy();
    const loaded = loadDeckLayout(id);
    expect(loaded).toEqual(layout);
  });

  it('resetDeck clears the saved layout', () => {
    const id: DeckId = 'incident';
    saveDeckLayout(id, validLayout(id, 'vitals'));
    expect(loadDeckLayout(id)).not.toBeNull();
    resetDeck(id);
    expect(loadDeckLayout(id)).toBeNull();
  });

  it('returns null for a corrupt blob instead of throwing', () => {
    const id: DeckId = 'tenant-service';
    window.localStorage.setItem(deckStorageKey(id), '{not valid json');
    expect(loadDeckLayout(id)).toBeNull();
  });

  it('returns null when the blob is missing the grid shape', () => {
    const id: DeckId = 'morning-check';
    window.localStorage.setItem(deckStorageKey(id), JSON.stringify({ panels: {} }));
    expect(loadDeckLayout(id)).toBeNull();
  });
});
