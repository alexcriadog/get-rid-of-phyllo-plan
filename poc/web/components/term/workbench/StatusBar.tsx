import { useEffect, useState } from 'react';
import type { DeckId } from '@/lib/term/decks';
import { useWorkspaceFilter } from '@/lib/workspace-context';
import { cn } from '@/lib/utils';

/**
 * The workbench status bar (spec §3.4, §7). A single dense mono strip:
 *   ▮ deck:<id>   N panels   ws:<slug>   api <latency>ms
 *                              ⌘K palette · ⌘1–9 focus panel   HH:MM:SS UTC
 *
 * When the API is unreachable the whole left cluster collapses to the red
 * `▮ API UNREACHABLE — retrying` state (replaces the old full-width banner).
 * The clock ticks once a second; reduced-motion is unaffected (it's a value
 * change, not an animation).
 */
interface StatusBarProps {
  deck: DeckId;
  panelCount: number;
  /** Slowest store latency from the health poll, or null while connecting. */
  apiLatencyMs: number | null;
  apiDown: boolean;
}

export default function StatusBar({ deck, panelCount, apiLatencyMs, apiDown }: StatusBarProps) {
  const { slug } = useWorkspaceFilter();
  const clock = useUtcClock();

  return (
    <footer
      role="status"
      aria-live="polite"
      className={cn(
        'flex h-7 shrink-0 items-center gap-4 border-t border-term-line bg-term-bg px-3',
        'font-mono text-[11px] text-term-muted',
      )}
    >
      {apiDown ? (
        <span className="flex items-center gap-1.5 text-term-danger">
          <span aria-hidden="true">▮</span>
          API UNREACHABLE — retrying
        </span>
      ) : (
        <>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="text-term-mint">
              ▮
            </span>
            <span className="text-term-faint">deck:</span>
            <span className="text-term-mint">{deck}</span>
          </span>
          <Sep />
          <span>
            <span className="text-term-text">{panelCount}</span> panel
            {panelCount === 1 ? '' : 's'}
          </span>
          <Sep />
          <span>
            <span className="text-term-faint">ws:</span>{' '}
            <span className="text-term-text">{slug ?? 'all'}</span>
          </span>
          <Sep />
          <span>
            <span className="text-term-faint">api</span>{' '}
            {apiLatencyMs == null ? (
              <span className="text-term-faint">…</span>
            ) : (
              <span className={apiLatencyMs >= 120 ? 'text-term-warn' : 'text-term-mint'}>
                {apiLatencyMs}ms
              </span>
            )}
          </span>
        </>
      )}

      <div className="ml-auto flex items-center gap-4">
        <span className="hidden text-term-faint sm:inline">
          <kbd className="text-term-muted">⌘K</kbd> palette ·{' '}
          <kbd className="text-term-muted">⌘1–9</kbd> focus panel
        </span>
        <span className="tabular-nums text-term-text">
          {clock} <span className="text-term-faint">UTC</span>
        </span>
      </div>
    </footer>
  );
}

function Sep() {
  return (
    <span aria-hidden="true" className="text-term-line-2">
      ·
    </span>
  );
}

/** HH:MM:SS in UTC, ticking once a second. */
function useUtcClock(): string {
  const [now, setNow] = useState<string>(() => formatUtc(new Date()));
  useEffect(() => {
    const id = window.setInterval(() => setNow(formatUtc(new Date())), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function formatUtc(d: Date): string {
  return d.toISOString().slice(11, 19);
}
