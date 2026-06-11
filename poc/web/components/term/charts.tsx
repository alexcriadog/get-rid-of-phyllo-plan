import { cn } from '@/lib/utils';

export type ChartTone = 'mint' | 'uv' | 'warn' | 'danger';

const STROKE: Record<ChartTone, string> = {
  mint: 'rgb(var(--term-mint))',
  uv: 'rgb(var(--term-uv-tint))',
  warn: 'rgb(var(--term-warn))',
  danger: 'rgb(var(--term-danger))',
};

const FILL_CLASS: Record<ChartTone, string> = {
  mint: 'bg-term-mint',
  uv: 'bg-term-uv-tint',
  warn: 'bg-term-warn',
  danger: 'bg-term-danger',
};

export function MiniBar({
  value,
  max,
  tone = 'mint',
  className,
}: {
  value: number;
  max: number;
  tone?: ChartTone;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <span
      role="meter"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn('inline-block h-1 w-12 bg-term-raised align-middle', className)}
    >
      <span className={cn('block h-1', FILL_CLASS[tone])} style={{ width: `${pct}%` }} />
    </span>
  );
}

export function Sparkline({
  points,
  tone = 'mint',
  width = 120,
  height = 22,
  className,
}: {
  points: number[];
  tone?: ChartTone;
  width?: number;
  height?: number;
  className?: string;
}) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const d = points
    .map((p, i) => {
      const x = (i * step).toFixed(1);
      const y = (height - 2 - ((p - min) / span) * (height - 4)).toFixed(1);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
    >
      <path d={d} fill="none" stroke={STROKE[tone]} strokeWidth="1.3" />
    </svg>
  );
}

export function Gauge({
  value,
  label,
  className,
}: {
  /** 0..1 — tone escalates: ≥0.7 warn, ≥0.9 danger. */
  value: number;
  label?: string;
  className?: string;
}) {
  const pct = Math.min(1, Math.max(0, value));
  const tone: ChartTone = pct >= 0.9 ? 'danger' : pct >= 0.7 ? 'warn' : 'mint';
  return (
    <div className={cn('font-mono', className)}>
      {label && (
        <div className="mb-1 flex justify-between text-[10px] uppercase tracking-[0.1em] text-term-faint">
          <span>{label}</span>
          <span>{Math.round(pct * 100)}%</span>
        </div>
      )}
      <MiniBar value={pct} max={1} tone={tone} className="w-full" />
    </div>
  );
}
