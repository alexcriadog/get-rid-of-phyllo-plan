import { cn } from '@/lib/utils';
import { fmtStatNumber } from '@/lib/format';

export interface StatDelta {
  text: string;
  tone: 'up' | 'down' | 'flat';
}

interface StatBlockProps {
  label: string;
  value: number | string;
  delta?: StatDelta;
  sub?: string;
  className?: string;
}

const DELTA_ARROW: Record<StatDelta['tone'], string> = { up: '▲', down: '▼', flat: '—' };
const DELTA_CLASS: Record<StatDelta['tone'], string> = {
  up: 'text-term-mint',
  down: 'text-term-danger',
  flat: 'text-term-faint',
};

export default function StatBlock({ label, value, delta, sub, className }: StatBlockProps) {
  const display = typeof value === 'number' ? fmtStatNumber(value) : value;
  return (
    <div className={cn('font-mono', className)}>
      <div className="text-[10px] uppercase tracking-[0.12em] text-term-faint">{label}</div>
      <div className="font-display text-2xl font-bold leading-tight text-term-text">{display}</div>
      {(delta || sub) && (
        <div className="text-[11px] text-term-muted">
          {delta && (
            <span className={DELTA_CLASS[delta.tone]}>
              <span aria-hidden="true">{DELTA_ARROW[delta.tone]} </span>
              {delta.text}
            </span>
          )}
          {delta && sub ? ' · ' : ''}
          {sub}
        </div>
      )}
    </div>
  );
}
