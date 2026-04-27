import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart as RLineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { compactNumber, seriesColor } from './palette';

export type LinePoint = { x: number | Date; y: number };
export type LineSeries = {
  label: string;
  color?: string;
  points: LinePoint[];
};

export type LineChartProps = {
  series: LineSeries[];
  height?: number;
  /** Render under the line as a soft area fill. */
  area?: boolean;
  /** Stack series so each segment is added on top of the previous. */
  stacked?: boolean;
  /** Number formatter for values shown in tooltip and Y axis labels. */
  formatY?: (v: number) => string;
  /** Custom labels under the X axis (left, mid, right). Falls back to the
   *  earliest, midpoint, and latest x value. */
  xLabels?: { left?: string; mid?: string; right?: string };
  /** Show a horizontal grid. Default true. */
  grid?: boolean;
  emptyMessage?: string;
};

/**
 * Recharts-backed LineChart wrapper. Keeps our column-of-series prop shape
 * (`series: [{ label, color?, points: [{x, y}] }]`) and converts internally
 * into a row-of-bins shape Recharts needs.
 */
export function LineChart({
  series,
  height = 220,
  area = true,
  stacked = false,
  formatY = compactNumber,
  xLabels,
  grid = true,
  emptyMessage = 'No data yet.',
}: LineChartProps) {
  const { rows, seriesKeys, colors, xs } = useMemo(() => {
    return reshape(series);
  }, [series]);

  if (rows.length === 0) {
    return <EmptyChart height={height} message={emptyMessage} />;
  }

  const minX = xs[0];
  const midX = xs[Math.floor(xs.length / 2)];
  const maxX = xs[xs.length - 1];
  const xAxisLabels = xLabels ?? {
    left: formatXLabel(minX),
    mid: formatXLabel(midX),
    right: formatXLabel(maxX),
  };

  const ChartImpl = area ? AreaChart : RLineChart;

  return (
    <div style={{ width: '100%' }}>
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ChartImpl data={rows} margin={{ top: 10, right: 12, bottom: 4, left: 0 }}>
            {grid && (
              <CartesianGrid
                stroke="var(--border)"
                strokeOpacity={0.4}
                strokeDasharray="2 4"
                vertical={false}
              />
            )}
            <XAxis dataKey="x" hide />
            <YAxis
              tick={{ fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'var(--mono)' }}
              tickFormatter={(v: number) => formatY(v)}
              width={48}
              axisLine={false}
              tickLine={false}
            />
            <RTooltip
              content={(props) => (
                <RechartsTooltip
                  payload={props.payload as unknown as TooltipEntry[] | undefined}
                  label={props.label as number | undefined}
                  formatY={formatY}
                  showTotal={stacked && series.length > 1}
                />
              )}
              cursor={{ stroke: 'var(--text-muted)', strokeOpacity: 0.5, strokeDasharray: '3 3' }}
              isAnimationActive={false}
              allowEscapeViewBox={{ x: true, y: true }}
              wrapperStyle={{ zIndex: 100, outline: 'none', pointerEvents: 'none' }}
              offset={16}
            />
            {area
              ? seriesKeys.map((key, idx) => {
                  const color = colors[idx];
                  const stackId = stacked ? 'stack' : undefined;
                  return (
                    <Area
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={series[idx].label}
                      stroke={stacked ? 'none' : color}
                      strokeWidth={stacked ? 0 : 1.6}
                      fill={color}
                      fillOpacity={stacked ? 0.55 : 0.2}
                      stackId={stackId}
                      isAnimationActive={false}
                      dot={false}
                      activeDot={
                        stacked
                          ? false
                          : { r: 3, stroke: color, fill: 'var(--bg)', strokeWidth: 2 }
                      }
                    />
                  );
                })
              : seriesKeys.map((key, idx) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={series[idx].label}
                    stroke={colors[idx]}
                    strokeWidth={1.6}
                    dot={false}
                    activeDot={{ r: 3, stroke: colors[idx], fill: 'var(--bg)', strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                ))}
          </ChartImpl>
        </ResponsiveContainer>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontFamily: 'var(--mono)',
          fontSize: 10,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--text-faint)',
          marginTop: 6,
          paddingLeft: 48,
          paddingRight: 12,
        }}
      >
        <span>{xAxisLabels.left}</span>
        <span>{xAxisLabels.mid}</span>
        <span>{xAxisLabels.right}</span>
      </div>
    </div>
  );
}

function EmptyChart({ height, message }: { height: number; message: string }) {
  return (
    <div
      style={{
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-faint)',
        fontFamily: 'var(--mono)',
        fontSize: 11,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        border: '1px dashed var(--border)',
        borderRadius: 'var(--radius)',
      }}
    >
      {message}
    </div>
  );
}

// ── Shape conversion ─────────────────────────────────────────────────────

type Row = Record<string, number> & { x: number };

function reshape(series: LineSeries[]): {
  rows: Row[];
  seriesKeys: string[];
  colors: string[];
  xs: number[];
} {
  if (series.length === 0) return { rows: [], seriesKeys: [], colors: [], xs: [] };

  const seriesKeys = series.map((s, i) => `s${i}`);
  const colors = series.map((s, i) => s.color ?? seriesColor(i));

  // Union of all x values across all series, sorted ascending.
  const xSet = new Set<number>();
  for (const s of series) {
    for (const p of s.points) {
      const x = toNum(p.x);
      if (!isNaN(x)) xSet.add(x);
    }
  }
  const xs = Array.from(xSet).sort((a, b) => a - b);

  // Index each series's points by x for quick lookup.
  const indexes = series.map((s) => {
    const m = new Map<number, number>();
    for (const p of s.points) {
      const x = toNum(p.x);
      const y = typeof p.y === 'number' && !isNaN(p.y) ? p.y : 0;
      m.set(x, y);
    }
    return m;
  });

  const rows: Row[] = xs.map((x) => {
    const row: Row = { x };
    for (let i = 0; i < series.length; i++) {
      row[seriesKeys[i]] = indexes[i].get(x) ?? 0;
    }
    return row;
  });

  return { rows, seriesKeys, colors, xs };
}

function toNum(x: number | Date): number {
  return x instanceof Date ? x.getTime() : x;
}

function formatXLabel(x: number): string {
  if (x > 1_000_000_000_000) {
    const d = new Date(x);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  return Math.round(x).toString();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// ── Custom tooltip ───────────────────────────────────────────────────────

type TooltipEntry = {
  dataKey?: string;
  name?: string;
  value?: number;
  color?: string;
  payload?: Row;
};

function RechartsTooltip({
  payload,
  label,
  formatY,
  showTotal,
}: {
  payload?: TooltipEntry[];
  label?: number;
  formatY: (v: number) => string;
  showTotal: boolean;
}) {
  if (!payload || payload.length === 0) return null;
  // Title from label (x value)
  const title = typeof label === 'number' ? formatXLabel(label) : '';
  let total = 0;
  return (
    <div
      role="tooltip"
      style={{
        background: 'var(--bg-panel-elev)',
        border: '1px solid var(--border-hi)',
        borderRadius: 'var(--radius)',
        padding: '8px 10px',
        minWidth: 130,
        boxShadow: 'var(--shadow-md)',
        fontFamily: 'var(--mono)',
        fontSize: 11,
        color: 'var(--text)',
      }}
    >
      {title && (
        <div
          style={{
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            fontSize: 9,
            marginBottom: 6,
          }}
        >
          {title}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {payload.map((p, i) => {
          const value = typeof p.value === 'number' ? p.value : 0;
          total += value;
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 14,
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: 'var(--text-muted)',
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: p.color ?? 'var(--text)',
                  }}
                />
                {p.name ?? p.dataKey ?? '—'}
              </span>
              <span style={{ color: p.color ?? 'var(--text)' }}>{formatY(value)}</span>
            </div>
          );
        })}
        {showTotal && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 14,
              alignItems: 'center',
              paddingTop: 4,
              borderTop: '1px solid var(--border)',
              marginTop: 2,
            }}
          >
            <span style={{ color: 'var(--text-muted)' }}>total</span>
            <span style={{ color: 'var(--text)' }}>{formatY(total)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
