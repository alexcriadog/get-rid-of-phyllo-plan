import { useMemo, useState } from 'react';
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
} from 'recharts';
import { compactNumber, seriesColor } from './palette';

export type DonutSlice = {
  label: string;
  value: number;
  color?: string;
};

export type DonutProps = {
  slices: DonutSlice[];
  size?: number;
  /** Title rendered in the donut hole when nothing is hovered. */
  centerLabel?: string;
  /** Optional override for the center value (defaults to total). */
  centerValue?: number;
  formatValue?: (n: number) => string;
  emptyMessage?: string;
};

export function Donut({
  slices,
  size = 180,
  centerLabel = 'Total',
  centerValue,
  formatValue = compactNumber,
  emptyMessage = 'No data.',
}: DonutProps) {
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);

  const enriched = useMemo(
    () =>
      slices
        .map((s, i) => ({
          ...s,
          color: s.color ?? seriesColor(i),
        }))
        .filter((s) => typeof s.value === 'number' && s.value > 0),
    [slices],
  );

  const total = enriched.reduce((a, s) => a + s.value, 0);

  if (!enriched.length || total <= 0) {
    return (
      <div
        style={{
          height: size,
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
        {emptyMessage}
      </div>
    );
  }

  const hovered = hoverLabel ? enriched.find((s) => s.label === hoverLabel) : null;
  const centerNum = centerValue ?? (hovered ? hovered.value : total);
  const centerSub = hovered
    ? `${hovered.label} · ${((hovered.value / total) * 100).toFixed(1)}%`
    : centerLabel;
  const centerColor = hovered ? hovered.color : 'var(--text)';
  const centerStr = formatValue(centerNum);
  const fontSize =
    centerStr.length <= 3 ? size * 0.22 : centerStr.length <= 5 ? size * 0.18 : size * 0.14;

  // Donut geometry
  const outerRadius = (size / 2) - 6;
  const innerRadius = outerRadius * 0.62;

  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-5)',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ width: size, height: size, position: 'relative', flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={enriched}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              paddingAngle={1}
              startAngle={90}
              endAngle={-270}
              isAnimationActive={false}
              onMouseEnter={(_, idx) => setHoverLabel(enriched[idx]?.label ?? null)}
              onMouseLeave={() => setHoverLabel(null)}
              stroke="none"
            >
              {enriched.map((s) => {
                const isHover = hoverLabel === s.label;
                const isFaded = hoverLabel !== null && !isHover;
                return (
                  <Cell
                    key={s.label}
                    fill={s.color}
                    fillOpacity={isFaded ? 0.28 : 1}
                  />
                );
              })}
            </Pie>
            <RTooltip
              content={(props) => (
                <DonutTooltip
                  payload={
                    props.payload as unknown as
                      | Array<{ name?: string; value?: number; payload?: DonutSlice & { color: string } }>
                      | undefined
                  }
                  total={total}
                  formatValue={formatValue}
                />
              )}
              isAnimationActive={false}
              allowEscapeViewBox={{ x: true, y: true }}
              wrapperStyle={{ zIndex: 100, outline: 'none', pointerEvents: 'none' }}
              offset={16}
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Center label overlay (HTML so it scales independently of the pie) */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              color: centerColor,
              fontSize,
              fontWeight: 600,
              lineHeight: 1,
              transition: 'color 150ms',
            }}
          >
            {centerStr}
          </div>
          <div
            style={{
              color: 'var(--text-faint)',
              fontFamily: 'var(--mono)',
              fontSize: Math.max(9, size * 0.06),
              textTransform: 'uppercase',
              letterSpacing: '0.16em',
              marginTop: 4,
            }}
          >
            {centerSub}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
        {enriched.map((s) => {
          const fraction = s.value / total;
          const isHover = hoverLabel === s.label;
          const isFaded = hoverLabel !== null && !isHover;
          return (
            <button
              key={s.label}
              onMouseEnter={() => setHoverLabel(s.label)}
              onMouseLeave={() => setHoverLabel(null)}
              style={{
                all: 'unset',
                display: 'grid',
                gridTemplateColumns: '12px 1fr auto auto',
                alignItems: 'center',
                gap: 10,
                padding: '5px 8px',
                borderRadius: 'var(--radius-sm)',
                background: isHover ? 'rgba(255,255,255,0.04)' : 'transparent',
                borderLeft: `3px solid ${isHover ? s.color : 'transparent'}`,
                opacity: isFaded ? 0.5 : 1,
                cursor: 'pointer',
                transition: 'opacity 150ms, background 150ms, border-color 150ms',
                fontFamily: 'var(--mono)',
                fontSize: 12,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: s.color,
                  boxShadow: isHover ? `0 0 8px ${s.color}` : 'none',
                }}
              />
              <span style={{ color: 'var(--text)' }}>{s.label}</span>
              <span style={{ color: 'var(--text)', textAlign: 'right' }}>
                {formatValue(s.value)}
              </span>
              <span
                style={{
                  color: isHover ? s.color : 'var(--text-faint)',
                  textAlign: 'right',
                  minWidth: 50,
                }}
              >
                {(fraction * 100).toFixed(1)}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DonutTooltip({
  payload,
  total,
  formatValue,
}: {
  payload?: Array<{ name?: string; value?: number; payload?: DonutSlice & { color: string } }>;
  total: number;
  formatValue: (n: number) => string;
}) {
  const item = payload?.[0];
  if (!item) return null;
  const value = typeof item.value === 'number' ? item.value : 0;
  const color = item.payload?.color ?? 'var(--text)';
  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
  return (
    <div
      style={{
        background: 'var(--bg-panel-elev)',
        border: '1px solid var(--border-hi)',
        borderRadius: 'var(--radius)',
        padding: '8px 10px',
        boxShadow: 'var(--shadow-md)',
        fontFamily: 'var(--mono)',
        fontSize: 11,
        color: 'var(--text)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 4,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 2,
            background: color,
            display: 'inline-block',
          }}
        />
        <span>{item.name ?? '—'}</span>
      </div>
      <div style={{ color, fontWeight: 600 }}>
        {formatValue(value)} <span style={{ color: 'var(--text-faint)' }}>· {pct}%</span>
      </div>
    </div>
  );
}
