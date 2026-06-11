import { describe, expect, it } from 'vitest';
import {
  ALL_PANEL_IDS,
  PANEL_DEFS,
  isPanelId,
  panelTitle,
  resolvePanel,
} from '../registry';

describe('panel registry', () => {
  it('every known panel id resolves to a def with a title + renderable component', () => {
    for (const id of ALL_PANEL_IDS) {
      const def = resolvePanel(id);
      expect(def.title.length).toBeGreaterThan(0);
      // A renderable component is either a function (placeholder) or an object
      // (next/dynamic's LoadableComponent for the real lazy panels).
      expect(def.component).toBeTruthy();
      expect(['function', 'object']).toContain(typeof def.component);
    }
  });

  it('isPanelId narrows known ids and rejects unknown ones', () => {
    expect(isPanelId('vitals')).toBe(true);
    expect(isPanelId('queues')).toBe(true);
    expect(isPanelId('not-a-panel')).toBe(false);
    expect(isPanelId('')).toBe(false);
  });

  it('resolvePanel falls back to a placeholder for an unknown id', () => {
    const def = resolvePanel('totally-made-up');
    // Unknown ids still resolve (placeholder) so the board never breaks.
    expect(typeof def.component).toBe('function');
    expect(def.title).toBe('totally-made-up');
  });

  it('panelTitle returns the catalog title for a known id', () => {
    expect(panelTitle('vitals')).toBe('System Vitals');
    expect(panelTitle('queues')).toBe('Queues & DLQ');
  });

  it('ALL_PANEL_IDS matches the PANEL_DEFS keys', () => {
    expect(ALL_PANEL_IDS.slice().sort()).toEqual(Object.keys(PANEL_DEFS).sort());
  });
});
