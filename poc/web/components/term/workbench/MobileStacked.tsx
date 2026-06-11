import { useMemo, useState } from 'react';
import { DECKS, type DeckId } from '@/lib/term/decks';
import { resolvePanel, type PanelId } from '@/components/term/panels/registry';
import { PanelRegion } from './PanelChrome';
import { cn } from '@/lib/utils';

/**
 * Mobile (<1024px) fallback (spec §2.1). No tiling on small screens: the
 * active deck's panels become a vertical sequence. A sticky switcher row lets
 * the operator jump between panels; the selected panel renders full-width in a
 * PanelChrome-style frame. Each panel still self-fetches via useLive, and only
 * the visible panel is mounted (so only it polls).
 */
interface MobileStackedProps {
  deck: DeckId;
}

export default function MobileStacked({ deck }: MobileStackedProps) {
  // Distinct panel ids in this deck's default layout, in placement order.
  const panels = useMemo<PanelId[]>(() => {
    const seen = new Set<PanelId>();
    const out: PanelId[] = [];
    for (const slot of DECKS[deck].layout) {
      if (!seen.has(slot.panel)) {
        seen.add(slot.panel);
        out.push(slot.panel);
      }
    }
    return out;
  }, [deck]);

  const [activeIdx, setActiveIdx] = useState(0);
  // Clamp when the deck changes and the index would be out of range.
  const idx = activeIdx < panels.length ? activeIdx : 0;
  const activeId = panels[idx];
  const def = resolvePanel(activeId);
  const Body = def.component;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-term-bg">
      {/* Sticky panel switcher */}
      <div className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-term-line bg-term-bg px-2 py-1.5">
        {panels.map((id, i) => {
          const isActive = i === idx;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveIdx(i)}
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                'h-6 shrink-0 px-2 font-mono text-[10px] uppercase tracking-[0.1em]',
                'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-term-mint',
                isActive
                  ? 'bg-term-mint font-bold text-term-mint-ink'
                  : 'border border-term-line-2 text-term-muted',
              )}
            >
              {resolvePanel(id).title}
            </button>
          );
        })}
      </div>

      {/* Active panel frame */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-7 items-center gap-2 border-b border-term-line bg-term-bg px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-term-mint">
          <span aria-hidden="true">⫿</span>
          <span className="truncate">{def.title}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <PanelRegion label={def.title}>
            <Body />
          </PanelRegion>
        </div>
      </div>
    </div>
  );
}
