import { cn } from '@/lib/utils';

/**
 * Terminal-styled stand-in for a panel that has a registry id + deck slot but
 * no real implementation yet (Phase 3/4 fill these in). Rendered both by the
 * registry fallback (unknown id) and by every "not built yet" entry, so a deck
 * is always fully laid out — operators see the intended composition before the
 * panels exist.
 */
export default function PlaceholderPanel({ id }: { id: string }) {
  return (
    <div
      className={cn(
        'flex h-full w-full flex-col items-start justify-center gap-1 p-5',
        'font-mono text-xs text-term-faint',
      )}
    >
      <div className="text-term-muted">
        ⫿ <span className="uppercase tracking-[0.12em]">{id}</span>
      </div>
      <div>
        panel not built yet <span className="animate-term-blink text-term-mint">▮</span>
      </div>
      <div className="text-[10px] text-term-faint/70">
        &gt; queued for a later phase
      </div>
    </div>
  );
}
