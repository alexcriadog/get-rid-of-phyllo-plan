/**
 * StageRail — numbered, mono-uppercase stage list for the Connect Studio.
 * Reflects the 4 real stages of the operator onboarding flow:
 *   01 PLATFORM → 02 CREDENTIALS → 03 CONNECT → 04 FIRST SYNC
 *
 * Purely presentational: the studio owns the active/reachable state.
 */

import { cn } from '@/lib/utils';

export type StageId = 'platform' | 'credentials' | 'connect' | 'sync';

export interface StageDef {
  id: StageId;
  index: string; // '01'…'04'
  label: string; // 'PLATFORM'…
}

export const STAGES: StageDef[] = [
  { id: 'platform', index: '01', label: 'PLATFORM' },
  { id: 'credentials', index: '02', label: 'CREDENTIALS' },
  { id: 'connect', index: '03', label: 'CONNECT' },
  { id: 'sync', index: '04', label: 'FIRST SYNC' },
];

interface StageRailProps {
  active: StageId;
  /** Stages the operator may jump back to (already visited). */
  reachable: Set<StageId>;
  onSelect: (id: StageId) => void;
}

export default function StageRail({ active, reachable, onSelect }: StageRailProps) {
  return (
    <nav
      aria-label="Connect stages"
      className="flex shrink-0 gap-px overflow-x-auto border-b border-term-line bg-term-surface lg:h-full lg:w-56 lg:flex-col lg:gap-0 lg:overflow-visible lg:border-b-0 lg:border-r"
    >
      {STAGES.map((stage) => {
        const isActive = stage.id === active;
        const canSelect = reachable.has(stage.id);
        const isDone =
          STAGES.findIndex((s) => s.id === stage.id) <
          STAGES.findIndex((s) => s.id === active);
        return (
          <button
            key={stage.id}
            type="button"
            disabled={!canSelect}
            aria-current={isActive ? 'step' : undefined}
            onClick={() => canSelect && onSelect(stage.id)}
            className={cn(
              'group flex items-center gap-3 px-4 py-3 text-left font-mono transition-colors duration-150',
              'border-term-line lg:border-b',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-term-mint focus-visible:ring-inset',
              isActive
                ? 'bg-term-mint/10 text-term-text'
                : canSelect
                  ? 'text-term-muted hover:bg-term-line/20 hover:text-term-text'
                  : 'cursor-default text-term-faint',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'grid h-7 w-7 shrink-0 place-items-center border text-[11px] font-bold',
                isActive
                  ? 'border-term-mint bg-term-mint text-term-mint-ink'
                  : isDone
                    ? 'border-term-mint text-term-mint'
                    : 'border-term-line-2 text-term-faint',
              )}
            >
              {isDone && !isActive ? '✓' : stage.index}
            </span>
            <span className="flex flex-col leading-tight">
              <span
                className={cn(
                  'text-[11px] font-bold uppercase tracking-[0.12em]',
                  isActive && 'text-term-mint',
                )}
              >
                {stage.label}
              </span>
              <span className="text-[9px] uppercase tracking-[0.14em] text-term-faint">
                stage {stage.index}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
