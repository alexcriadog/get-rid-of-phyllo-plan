type Props = {
  points: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  max?: number;
  min?: number;
};

/** Pure-SVG sparkline / polyline chart. No chart library. */
export default function Sparkline({
  points,
  width = 240,
  height = 48,
  stroke = 'var(--accent)',
  fill = 'transparent',
  max,
  min,
}: Props) {
  if (!points || points.length === 0) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="var(--border)"
          strokeDasharray="3 3"
        />
      </svg>
    );
  }

  const hi = max ?? Math.max(...points);
  const lo = min ?? Math.min(...points);
  const range = Math.max(hi - lo, 1);
  const stepX = points.length > 1 ? width / (points.length - 1) : width;

  const coords = points.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - lo) / range) * height;
    return [x, y] as const;
  });

  const path = coords
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
  const area = `${path} L${width},${height} L0,${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <line x1={0} y1={height} x2={width} y2={height} stroke="var(--border)" />
      <path d={area} fill={fill} opacity={0.15} />
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
