type Props = {
  value: number;
  max: number;
  label?: string;
  size?: number;
};

/** Circular SVG gauge showing value/max. */
export default function Gauge({ value, max, label, size = 96 }: Props) {
  const clampedMax = Math.max(max, 1);
  const clampedValue = Math.max(0, Math.min(value, clampedMax));
  const pct = clampedValue / clampedMax;
  const stroke = size * 0.12;
  const r = size / 2 - stroke / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ * (1 - pct);

  let colour = 'var(--ok)';
  if (pct < 0.5) colour = 'var(--warn)';
  if (pct < 0.2) colour = 'var(--danger)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--bg-panel-hi)"
          strokeWidth={stroke}
        />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={colour}
          strokeWidth={stroke}
          strokeDasharray={circ}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dashoffset 300ms ease' }}
        />
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="var(--mono)"
          fontSize={size * 0.22}
          fontWeight={600}
          fill="var(--text)"
        >
          {Math.round(clampedValue)}
        </text>
        <text
          x={cx}
          y={cy + size * 0.18}
          textAnchor="middle"
          fontFamily="var(--mono)"
          fontSize={size * 0.12}
          fill="var(--text-muted)"
        >
          / {clampedMax}
        </text>
      </svg>
      {label && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
          {label}
        </div>
      )}
    </div>
  );
}
