import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/router';
import { Command } from 'cmdk';
import * as Dialog from '@radix-ui/react-dialog';
import { DECKS, DECK_IDS, type DeckId } from '@/lib/term/decks';
import { ALL_PANEL_IDS, panelTitle, type PanelId } from '@/components/term/panels/registry';
import { useTheme } from '@/lib/theme';
import { CONNECTOR_API_URL, adminPost } from '@/lib/api';

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

/** A queue name + failed count that has items to retry. */
interface FailedQueue {
  name: string;
  failed: number;
}

type QueueStats = Record<string, { failed?: number }>;

export default function CmdPalette({ open, onOpenChange, actions }: CmdPaletteProps) {
  const router = useRouter();
  const { toggle } = useTheme();

  // DLQ state: queues with failed > 0, fetched once when the palette opens.
  const [failedQueues, setFailedQueues] = useState<FailedQueue[]>([]);
  const [dlqStatus, setDlqStatus] = useState<string | null>(null);

  // Fetch /admin/queues once when the palette opens; populate failedQueues.
  useEffect(() => {
    if (!open) return;
    setDlqStatus(null);

    fetch(`${CONNECTOR_API_URL}/admin/queues`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<QueueStats>;
      })
      .then((data) => {
        const failing = Object.entries(data)
          .filter(([, counts]) => (counts.failed ?? 0) > 0)
          .map(([name, counts]) => ({ name, failed: counts.failed ?? 0 }));
        setFailedQueues(failing);
      })
      .catch(() => {
        // API unreachable — silently hide the DLQ group.
        setFailedQueues([]);
      });
  }, [open]);

  // Fire retry for a queue; show a transient status message then close.
  const retryDlq = async (queue: FailedQueue) => {
    setDlqStatus(`retrying ${queue.failed} failed jobs in ${queue.name}…`);
    try {
      await adminPost(`/admin/queues/${queue.name}/retry-failed`, {});
      setDlqStatus(`↺ ${queue.name}: retry queued`);
      setTimeout(() => onOpenChange(false), 800);
    } catch (e) {
      setDlqStatus(`✗ ${(e as Error).message}`);
    }
  };

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

        {/* DLQ RETRY — only rendered when at least one queue has failed jobs */}
        {failedQueues.length > 0 && (
          <Command.Group heading="DLQ RETRY" className="term-cmdk-group">
            {failedQueues.map((q) => (
              <PaletteItem
                key={`dlq:${q.name}`}
                value={`retry dlq ${q.name} failed jobs dead letter queue`}
                onSelect={() => { void retryDlq(q); }}
              >
                <span className="text-term-danger">↺</span>{' '}
                retry DLQ: {q.name}{' '}
                <span className="ml-auto text-[10px] text-term-danger tabular-nums">
                  {q.failed}f
                </span>
              </PaletteItem>
            ))}
          </Command.Group>
        )}

        {/* Status line shown while a retry is in-flight or just completed */}
        {dlqStatus && (
          <div className="px-3 py-1 text-[10px] text-term-faint border-t border-term-line">
            {dlqStatus}
          </div>
        )}

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
