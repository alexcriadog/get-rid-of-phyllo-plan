import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/router';
import { Command } from 'cmdk';
import * as Dialog from '@radix-ui/react-dialog';
import { DECKS, DECK_IDS, type DeckId } from '@/lib/term/decks';
import { ALL_PANEL_IDS, panelTitle, type PanelId } from '@/components/term/panels/registry';
import { useTheme } from '@/lib/theme';

/**
 * The ⌘K command palette (spec §2.4), Phase 2 scope: jump + open only.
 * Groups: DECKS (switch the 4 decks) · PANELS (open any registry panel into the
 * current deck) · ACTIONS (toggle theme, jump to legacy admin / specimen).
 * Real mutations (DLQ retry, queue pause, …) land in Phase 3.
 *
 * Built on cmdk's `Command.Dialog`, which wraps a Radix Dialog — proper dialog
 * semantics, focus trap, and Esc-to-close are handled for us (spec §9). The
 * parent owns open state and the action callbacks so the palette stays a thin,
 * stateless surface.
 */
export interface PaletteActions {
  switchDeck: (id: DeckId) => void;
  openPanel: (id: PanelId) => void;
}

interface CmdPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: PaletteActions;
}

export default function CmdPalette({ open, onOpenChange, actions }: CmdPaletteProps) {
  const router = useRouter();
  const { toggle } = useTheme();

  // ⌘K / Ctrl+K toggles the palette globally. Esc-to-close is handled by the
  // Radix Dialog inside cmdk.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const run = (fn: () => void) => {
    fn();
    onOpenChange(false);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      className="term-cmdk fixed inset-0 z-[100] flex items-start justify-center"
      overlayClassName="fixed inset-0 z-[99] bg-black/60"
      contentClassName="relative z-[100] mt-[12vh] w-[min(620px,92vw)] border border-term-mint bg-term-surface font-mono text-term-text shadow-[0_0_0_1px_rgb(var(--term-mint)/0.2)]"
    >
      {/* Accessible dialog name (visually hidden). cmdk's Dialog renders an
          aria-label on the command root but not a Radix DialogTitle; this
          satisfies the Dialog title requirement (spec §9). */}
      <Dialog.Title className="sr-only">Command palette</Dialog.Title>
      <Dialog.Description className="sr-only">
        Jump to a deck, open a panel, or run an action.
      </Dialog.Description>

      <div className="flex items-center gap-2 border-b border-term-line px-3 py-2">
        <span aria-hidden="true" className="select-none text-term-mint">
          &gt;
        </span>
        <Command.Input
          autoFocus
          placeholder="jump to deck, open a panel, run an action…"
          className="h-7 w-full bg-transparent text-xs text-term-text outline-none placeholder:text-term-faint"
        />
      </div>

      <Command.List className="max-h-[52vh] overflow-y-auto p-1.5">
        <Command.Empty className="px-3 py-6 text-center text-xs text-term-faint">
          &gt; no matches <span className="animate-term-blink text-term-mint">▮</span>
        </Command.Empty>

        <Command.Group heading="DECKS" className="term-cmdk-group">
          {DECK_IDS.map((id) => (
            <PaletteItem
              key={`deck:${id}`}
              value={`deck ${DECKS[id].label} ${id}`}
              onSelect={() => run(() => actions.switchDeck(id))}
            >
              <span className="text-term-mint">⊞</span> deck: {DECKS[id].label}
            </PaletteItem>
          ))}
        </Command.Group>

        <Command.Group heading="PANELS" className="term-cmdk-group">
          {ALL_PANEL_IDS.map((id) => (
            <PaletteItem
              key={`panel:${id}`}
              value={`open panel ${panelTitle(id)} ${id}`}
              onSelect={() => run(() => actions.openPanel(id))}
            >
              <span className="text-term-uv-tint">⫿</span> open: {panelTitle(id)}
            </PaletteItem>
          ))}
        </Command.Group>

        <Command.Group heading="ACTIONS" className="term-cmdk-group">
          <PaletteItem value="toggle theme light dark" onSelect={() => run(toggle)}>
            <span className="text-term-warn">◐</span> toggle theme
          </PaletteItem>
          <PaletteItem
            value="jump legacy admin console"
            onSelect={() => run(() => router.push('/admin'))}
          >
            <span className="text-term-faint">↗</span> jump to legacy admin
          </PaletteItem>
          <PaletteItem
            value="jump term specimen styleguide"
            onSelect={() => run(() => router.push('/admin/term-specimen'))}
          >
            <span className="text-term-faint">↗</span> jump to term specimen
          </PaletteItem>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}

function PaletteItem({
  value,
  onSelect,
  children,
}: {
  value: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-term-muted data-[selected=true]:bg-term-mint data-[selected=true]:text-term-mint-ink"
    >
      {children}
    </Command.Item>
  );
}
