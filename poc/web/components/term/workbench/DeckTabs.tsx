import { DECKS, DECK_IDS, type DeckId } from '@/lib/term/decks';
import { cn } from '@/lib/utils';

/**
 * The deck switcher (spec §2.2). Decks are the "pages" of the workbench;
 * switching swaps the dockview layout. Active deck reads as the ActionChip
 * primary state (mint bg, black text); inactive decks are hairline-bordered.
 * `+ DECK` is a disabled Phase-2 stub (custom decks land later).
 */
interface DeckTabsProps {
  active: DeckId;
  onSelect: (id: DeckId) => void;
}

export default function DeckTabs({ active, onSelect }: DeckTabsProps) {
  return (
    <div role="tablist" aria-label="Decks" className="flex items-center gap-1">
      {DECK_IDS.map((id) => {
        const isActive = id === active;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(id)}
            className={cn(
              'h-7 whitespace-nowrap px-3 font-mono text-[11px] font-medium uppercase tracking-[0.08em]',
              'transition-[background-color,border-color,color] duration-150',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-term-mint focus-visible:ring-offset-1 focus-visible:ring-offset-term-bg',
              isActive
                ? 'bg-term-mint font-bold text-term-mint-ink'
                : 'border border-term-line-2 text-term-muted hover:border-term-faint hover:text-term-text',
            )}
          >
            {DECKS[id].label}
          </button>
        );
      })}
      <button
        type="button"
        disabled
        title="Custom decks — coming in a later phase"
        className={cn(
          'h-7 whitespace-nowrap border border-dashed border-term-line-2 px-3',
          'font-mono text-[11px] uppercase tracking-[0.08em] text-term-faint',
          'cursor-not-allowed opacity-50',
        )}
      >
        + DECK
      </button>
    </div>
  );
}
