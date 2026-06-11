import { describe, expect, it, beforeEach } from 'vitest';
import type { SerializedDockview } from 'dockview';
import {
  DECKS,
  DECK_IDS,
  DEFAULT_DECK_ID,
  deckFromQuery,
  deckStorageKey,
  isDeckId,
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

function fakeLayout(): SerializedDockview {
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

describe('deck layout persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips a saved layout through localStorage', () => {
    const id: DeckId = 'pipeline';
    const layout = fakeLayout();
    expect(loadDeckLayout(id)).toBeNull();
    saveDeckLayout(id, layout);
    expect(window.localStorage.getItem(deckStorageKey(id))).toBeTruthy();
    const loaded = loadDeckLayout(id);
    expect(loaded).toEqual(layout);
  });

  it('resetDeck clears the saved layout', () => {
    const id: DeckId = 'incident';
    saveDeckLayout(id, fakeLayout());
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
