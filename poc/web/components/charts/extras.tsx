/**
 * Consolidated set of small chart primitives used across the admin panel.
 * Kept in one file to limit harness friction. Each component is independent
 * and uses the shared palette + Tooltip from sibling files.
 */

import { useMemo, useRef, useState, useEffect, Fragment } from 'react';
import { Tooltip, useTooltip } from './Tooltip';
import {
  compactNumber,
  pct as fmtPct,
  seriesColor,
  STATUS_COLORS,
  StatusTone,
} from './palette';

// ─────────────────────────────────────────────────────────────────────────────
// Heatmap — rows × cols of colored cells. Use case: account × hour activity.
// ─────────────────────────────────────────────────────────────────────────────

export type HeatmapCell = {
  row: string;
  col: string;
  value: number;
  /** Optional override; falls back to a value-keyed shade. */
  color?: string;
};

export type HeatmapProps = {
  rows: string[];
  cols: string[];
  cells: HeatmapCell[];
  cellSize?: number;
  formatValue?: (v: number) => string;
  /** Used in the tooltip header e.g. "12 calls". */
  unitLabel?: string;
  /** Color ramp endpoints — left = empty, right = max. */
  rampFrom?: string;
  rampTo?: string;
  emptyMessage?: string;
};

export function Heatmap({
  rows,
  cols,
  cells,
  cellSize = 22,
  formatValue = compactNumber,
  unitLabel = '',
  rampFrom = 'rgba(122, 162, 255, 0.06)',
  rampTo = 'var(--accent)',
  emptyMessage = 'No data.',
}: HeatmapProps) {
  const { containerRef, tip, show, hide } = useTooltip();
  const lookup = useMemo(() => {
    const m = new Map<string, HeatmapCell>();
    for (const c of cells) m.set(`${c.row}::${c.col}`, c);
    return m;
  }, [cells]);
  const max = useMemo(
    () => cells.reduce((a, c) => (c.value > a ? c.value : a), 0),
    [cells],
  );
  const labelGutter = 96;

  if (!rows.length || !cols.length) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: 'center',
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

  return (
    <div ref={containerRef} style={{ position: 'relative', overflowX: 'auto' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `${labelGutter}px repeat(${cols.length}, ${cellSize}px)`,
          gap: 2,
          alignItems: 'center',
        }}
      >
        <div />
        {cols.map((c) => (
          <div
            key={`col-${c}`}
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 9,
              color: 'var(--text-faint)',
              textAlign: 'center',
              letterSpacing: '0.06em',
            }}
          >
            {c}
          </div>
        ))}
        {rows.map((r) => (
          <Fragment key={`row-${r}`}>
            <div
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 11,
                color: 'var(--text-muted)',
                paddingRight: 8,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={r}
            >
              {r}
            </div>
            {cols.map((c) => {
              const cell = lookup.get(`${r}::${c}`);
              const v = cell?.value ?? 0;
              const intensity = max > 0 ? Math.min(1, v / max) : 0;
              const bg =
                cell?.color ??
                (v === 0
                  ? 'var(--bg-panel-hi)'
                  : `color-mix(in oklab, ${rampTo} ${(intensity * 100).toFixed(0)}%, ${rampFrom})`);
              return (
                <div
                  key={`${r}::${c}`}
                  onMouseEnter={(e) =>
                    show(e.clientX, e.clientY, {
                      title: r,
                      lines: [
                        { label: c, value: `${formatValue(v)} ${unitLabel}`.trim() },
                      ],
                    })
                  }
                  onMouseLeave={hide}
                  style={{
                    width: cellSize,
                    height: cellSize,
                    borderRadius: 4,
                    background: bg,
                    border: v === 0 ? '1px solid var(--border)' : '1px solid transparent',
                    cursor: 'default',
                    transition: 'transform 100ms',
                  }}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HBarChart — horizontal ranked bars (top endpoints, top errors).
// ─────────────────────────────────────────────────────────────────────────────

export type HBarItem = {
  label: string;
  value: number;
  color?: string;
  /** Optional secondary metric to render under the value (e.g. "p95 230 ms"). */
  caption?: string;
};

export type HBarChartProps = {
  items: HBarItem[];
  /** Show value as percentage of the supplied total (otherwise uses sum). */
  total?: number;
  formatValue?: (v: number) => string;
  showPct?: boolean;
  emptyMessage?: string;
  /** Truncate labels longer than this many chars (visual only — title still full). */
  maxLabelChars?: number;
};

export function HBarChart({
  items,
  total,
  formatValue = compactNumber,
  showPct = true,
  emptyMessage = 'No items.',
  maxLabelChars = 38,
}: HBarChartProps) {
  const [hover, setHover] = useState<string | null>(null);
  if (!items.length) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: 'center',
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
  const max = Math.max(...items.map((i) => i.value), 1);
  const grandTotal = total ?? items.reduce((a, i) => a + i.value, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((item, idx) => {
        const color = item.color ?? seriesColor(idx);
        const isHover = hover === item.label;
        const isFaded = hover !== null && !isHover;
        const labelDisplay =
          item.label.length > maxLabelChars
            ? item.label.slice(0, maxLabelChars - 1) + '…'
            : item.label;
        return (
          <div
            key={item.label + idx}
            onMouseEnter={() => setHover(item.label)}
            onMouseLeave={() => setHover(null)}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: 'var(--space-3)',
              alignItems: 'center',
              padding: '6px 8px',
              borderRadius: 'var(--radius-sm)',
              background: isHover ? 'rgba(255,255,255,0.04)' : 'transparent',
              opacity: isFaded ? 0.5 : 1,
              transition: 'opacity 120ms, background 120ms',
            }}
            title={item.label}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 11.5,
                  color: 'var(--text)',
                  marginBottom: 4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {labelDisplay}
              </div>
              <div
                style={{
                  position: 'relative',
                  height: 8,
                  background: 'var(--bg-panel-hi)',
                  borderRadius: 4,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${(item.value / max) * 100}%`,
                    height: '100%',
                    background: color,
                    boxShadow: isHover ? `0 0 8px ${color}` : 'none',
                    filter: isHover ? 'brightness(1.2)' : 'none',
                    transition: 'width 320ms ease, filter 120ms, box-shadow 120ms',
                  }}
                />
              </div>
              {item.caption && (
                <div
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 10,
                    color: 'var(--text-faint)',
                    marginTop: 4,
                  }}
                >
                  {item.caption}
                </div>
              )}
            </div>
            <div
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 12,
                color: isHover ? color : 'var(--text)',
                textAlign: 'right',
                minWidth: 96,
                transition: 'color 120ms',
              }}
            >
              {formatValue(item.value)}
              {showPct && grandTotal > 0 && (
                <span
                  style={{ color: 'var(--text-faint)', marginLeft: 6, fontSize: 11 }}
                >
                  {fmtPct(item.value, grandTotal)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sparkline — inline mini timeseries with hover dot.
// ─────────────────────────────────────────────────────────────────────────────

export type SparkPoint = { x: number | Date; y: number };

export type SparklineProps = {
  points: SparkPoint[];
  color?: string;
  height?: number;
  /** Render area fill under the line. */
  area?: boolean;
  formatValue?: (v: number) => string;
  /** Render last value as inline label on the right. */
  showLastValue?: boolean;
};

export function Sparkline({
  points,
  color = 'var(--accent)',
  height = 36,
  area = true,
  formatValue = compactNumber,
  showLastValue = false,
}: SparklineProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const { containerRef, tip, show, hide } = useTooltip();
  const sorted = useMemo(
    () =>
      points
        .map((p) => ({ x: toNum(p.x), y: typeof p.y === 'number' ? p.y : 0 }))
        .sort((a, b) => a.x - b.x),
    [points],
  );
  if (!sorted.length) {
    return (
      <div style={{ height, color: 'var(--text-faint)', fontSize: 10 }}>—</div>
    );
  }
  const width = 220;
  const padX = 2;
  const padY = 4;
  const min = Math.min(...sorted.map((p) => p.y));
  const max = Math.max(...sorted.map((p) => p.y));
  const range = Math.max(max - min, 1);
  const xRange = Math.max(sorted[sorted.length - 1].x - sorted[0].x, 1);
  const xToPx = (x: number) =>
    padX + ((x - sorted[0].x) / xRange) * (width - padX * 2);
  const yToPx = (y: number) =>
    padY + (height - padY * 2) - ((y - min) / range) * (height - padY * 2);

  const path =
    'M' + sorted.map((p) => `${xToPx(p.x).toFixed(1)},${yToPx(p.y).toFixed(1)}`).join(' L');
  const areaPath =
    path +
    ` L${xToPx(sorted[sorted.length - 1].x).toFixed(1)},${(height - padY).toFixed(1)}` +
    ` L${xToPx(sorted[0].x).toFixed(1)},${(height - padY).toFixed(1)} Z`;

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const xInView = ratio * width;
    let nearest = 0;
    let dist = Infinity;
    for (let i = 0; i < sorted.length; i++) {
      const px = xToPx(sorted[i].x);
      const d = Math.abs(px - xInView);
      if (d < dist) {
        dist = d;
        nearest = i;
      }
    }
    const p = sorted[nearest];
    show(e.clientX, e.clientY, {
      lines: [{ label: 'value', value: formatValue(p.y), color }],
    });
  };

  const last = sorted[sorted.length - 1];
  const gradId = `sp-${idHash(color)}`;

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
      <svg
        ref={svgRef}
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        onMouseMove={handleMove}
        onMouseLeave={hide}
        style={{ display: 'block', cursor: 'crosshair', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.32} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {area && <path d={areaPath} fill={`url(#${gradId})`} />}
        <path d={path} fill="none" stroke={color} strokeWidth={1.4} />
      </svg>
      {showLastValue && (
        <span
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 11,
            color,
            whiteSpace: 'nowrap',
          }}
        >
          {formatValue(last.y)}
        </span>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gauge — radial fill gauge with optional center value + caption.
// ─────────────────────────────────────────────────────────────────────────────

export type GaugeProps = {
  value: number;
  max: number;
  size?: number;
  label?: string;
  formatValue?: (v: number) => string;
  /** Force tone (otherwise auto-pick from fill ratio). */
  tone?: StatusTone;
};

export function Gauge({
  value,
  max,
  size = 140,
  label,
  formatValue = compactNumber,
  tone,
}: GaugeProps) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const autoTone: StatusTone =
    ratio > 0.5 ? 'ok' : ratio > 0.2 ? 'warn' : 'danger';
  const color = STATUS_COLORS[tone ?? autoTone];

  const stroke = Math.max(10, Math.round(size * 0.1));
  const radius = (size - stroke) / 2 - 4;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const arc = circumference * 0.75;
  const fill = arc * ratio;

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ overflow: 'visible' }}
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--bg-panel-hi)"
          strokeWidth={stroke}
          strokeDasharray={`${arc} ${circumference - arc}`}
          strokeDashoffset={-circumference * 0.125}
          transform={`rotate(90 ${center} ${center})`}
          strokeLinecap="round"
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={`${fill} ${circumference - fill}`}
          strokeDashoffset={-circumference * 0.125}
          transform={`rotate(90 ${center} ${center})`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 320ms ease' }}
        />
        <text
          x={center}
          y={center - 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill={color}
          fontSize={size * 0.22}
          style={{ fontWeight: 600 }}
        >
          {formatValue(value)}
        </text>
        <text
          x={center}
          y={center + size * 0.16}
          textAnchor="middle"
          fill="var(--text-faint)"
          fontFamily="var(--mono)"
          fontSize={size * 0.07}
          style={{ textTransform: 'uppercase', letterSpacing: '0.16em' }}
        >
          {`/ ${formatValue(max)}`}
        </text>
      </svg>
      {label && (
        <div
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 11,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline — gantt-style horizontal bars on a time axis.
// ─────────────────────────────────────────────────────────────────────────────

export type TimelineRow = {
  id: string;
  label: string;
};

export type TimelineEvent = {
  rowId: string;
  startMs: number;
  endMs: number;
  /** Tone for the bar color (uses STATUS_COLORS). */
  tone?: StatusTone;
  /** Custom color overrides tone. */
  color?: string;
  /** Optional tooltip title (defaults to row.label). */
  title?: string;
  /** Optional extra tooltip lines. */
  meta?: Array<{ label: string; value: string }>;
};

export type TimelineProps = {
  rows: TimelineRow[];
  events: TimelineEvent[];
  /** Window start (ms epoch). */
  startMs: number;
  /** Window end (ms epoch). */
  endMs: number;
  rowHeight?: number;
  /** Vertical lines every N hours. */
  hourTickEvery?: number;
};

export function Timeline({
  rows,
  events,
  startMs,
  endMs,
  rowHeight = 26,
  hourTickEvery = 1,
}: TimelineProps) {
  const { containerRef, tip, show, hide } = useTooltip();
  const range = Math.max(endMs - startMs, 1);
  const hours: number[] = [];
  if (hourTickEvery > 0) {
    const startHour = new Date(startMs);
    startHour.setMinutes(0, 0, 0);
    for (let t = startHour.getTime(); t <= endMs; t += hourTickEvery * 3_600_000) {
      if (t >= startMs) hours.push(t);
    }
  }
  // Responsive: shrink the label gutter on narrow screens; size the
  // time-area minimum per TICK (not per hour) so different horizons
  // (6h, 24h, 72h) all stay readable with ~70px between hour labels.
  const labelGutter = 'clamp(96px, 18vw, 160px)';
  const tickCount = Math.max(2, hours.length);
  const minTimeAreaPx = Math.min(1600, tickCount * 70);

  return (
    <div ref={containerRef} style={{ position: 'relative', overflowX: 'auto', width: '100%' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `${labelGutter} minmax(${minTimeAreaPx}px, 1fr)`,
          alignItems: 'stretch',
          gap: 0,
        }}
      >
        <div />
        <div
          style={{
            position: 'relative',
            height: 24,
            borderBottom: '1px solid var(--border)',
          }}
        >
          {hours.map((h, idx) => {
            const left = ((h - startMs) / range) * 100;
            const d = new Date(h);
            const isLast = idx === hours.length - 1;
            return (
              <div
                key={h}
                style={{
                  position: 'absolute',
                  left: `${left}%`,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: 'var(--border)',
                  fontFamily: 'var(--mono)',
                  fontSize: 9,
                  color: 'var(--text-faint)',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    bottom: 2,
                    // Anchor the rightmost tick label to the LEFT of its line
                    // so it doesn't overflow the panel edge.
                    left: isLast ? 'auto' : 4,
                    right: isLast ? 4 : 'auto',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {`${pad2(d.getHours())}:00`}
                </span>
              </div>
            );
          })}
        </div>

        {rows.map((r) => (
          <Fragment key={`tlrow-${r.id}`}>
            <div
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 11,
                color: 'var(--text-muted)',
                paddingRight: 12,
                paddingTop: 4,
                paddingBottom: 4,
                borderTop: '1px solid var(--border)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={r.label}
            >
              {r.label}
            </div>
            <div
              style={{
                position: 'relative',
                height: rowHeight,
                borderTop: '1px solid var(--border)',
                background:
                  'repeating-linear-gradient(to right, transparent 0, transparent 60px, rgba(255,255,255,0.015) 60px, rgba(255,255,255,0.015) 61px)',
              }}
            >
              {events
                .filter((e) => e.rowId === r.id)
                .map((e, ei) => {
                  const left = ((Math.max(e.startMs, startMs) - startMs) / range) * 100;
                  const widthPct =
                    ((Math.min(e.endMs, endMs) - Math.max(e.startMs, startMs)) / range) *
                    100;
                  const color = e.color ?? STATUS_COLORS[e.tone ?? 'info'];
                  return (
                    <div
                      key={`${r.id}-${ei}`}
                      onMouseEnter={(ev) =>
                        show(ev.clientX, ev.clientY, {
                          title: e.title ?? r.label,
                          lines: [
                            ...(e.meta ?? []),
                            {
                              label: 'when',
                              value: `${formatTime(e.startMs)} – ${formatTime(e.endMs)}`,
                            },
                          ],
                        })
                      }
                      onMouseLeave={hide}
                      style={{
                        position: 'absolute',
                        left: `${left}%`,
                        width: `max(2px, ${widthPct}%)`,
                        top: 4,
                        bottom: 4,
                        borderRadius: 4,
                        background: color,
                        opacity: 0.85,
                        cursor: 'default',
                        transition: 'opacity 100ms',
                      }}
                    />
                  );
                })}
            </div>
          </Fragment>
        ))}
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TtlBar — countdown bar that drains in real time (throttle locks).
// ─────────────────────────────────────────────────────────────────────────────

export type TtlBarProps = {
  /** Seconds remaining, snapshot value. */
  ttlSeconds: number;
  /** Original total TTL in seconds (for the bar fill ratio). */
  totalSeconds: number;
  label?: string;
  tone?: StatusTone;
  /** Tick rate (ms) for the countdown animation. */
  refreshMs?: number;
};

export function TtlBar({
  ttlSeconds,
  totalSeconds,
  label,
  tone,
  refreshMs = 1000,
}: TtlBarProps) {
  const [remaining, setRemaining] = useState(ttlSeconds);
  useEffect(() => {
    setRemaining(ttlSeconds);
  }, [ttlSeconds]);
  useEffect(() => {
    const start = Date.now();
    const initial = ttlSeconds;
    const id = window.setInterval(() => {
      const next = Math.max(0, initial - (Date.now() - start) / 1000);
      setRemaining(next);
    }, refreshMs);
    return () => window.clearInterval(id);
  }, [ttlSeconds, refreshMs]);

  const ratio = totalSeconds > 0 ? Math.max(0, Math.min(1, remaining / totalSeconds)) : 0;
  const autoTone: StatusTone = ratio > 0.5 ? 'ok' : ratio > 0.2 ? 'warn' : 'danger';
  const color = STATUS_COLORS[tone ?? autoTone];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: 'var(--mono)',
            fontSize: 11,
            color: 'var(--text-muted)',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
          </span>
          <span style={{ color }}>{formatDuration(remaining)}</span>
        </div>
      )}
      <div
        style={{
          height: 6,
          background: 'var(--bg-panel-hi)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${ratio * 100}%`,
            height: '100%',
            background: color,
            transition: `width ${refreshMs}ms linear`,
          }}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tabs — keyboard-accessible tab strip with state persisted in URL hash.
// ─────────────────────────────────────────────────────────────────────────────

export type TabItem = {
  id: string;
  label: string;
  /** Optional small badge (count, status). */
  badge?: number | string;
};

export type TabsProps = {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
};

export function Tabs({ items, activeId, onChange }: TabsProps) {
  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        gap: 2,
        flexWrap: 'wrap',
        background: 'var(--bg-panel-hi)',
        padding: 4,
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        marginBottom: 'var(--space-4)',
      }}
    >
      {items.map((t) => {
        const active = t.id === activeId;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              padding: '8px 14px',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--mono)',
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: active ? 'var(--bg)' : 'var(--text-muted)',
              background: active ? 'var(--text)' : 'transparent',
              transition: 'background 120ms, color 120ms',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontWeight: active ? 600 : 500,
            }}
            onMouseEnter={(e) => {
              if (!active) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                e.currentTarget.style.color = 'var(--text)';
              }
            }}
            onMouseLeave={(e) => {
              if (!active) {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-muted)';
              }
            }}
          >
            {t.label}
            {t.badge != null && (
              <span
                style={{
                  display: 'inline-block',
                  padding: '1px 6px',
                  borderRadius: 999,
                  background: active ? 'rgba(0,0,0,0.18)' : 'var(--bg-panel-elev)',
                  color: active ? 'var(--bg)' : 'var(--text-muted)',
                  fontSize: 10,
                }}
              >
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

function toNum(x: number | Date): number {
  return x instanceof Date ? x.getTime() : x;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

let _idCounter = 0;
const _idCache = new Map<string, number>();
function idHash(s: string): number {
  if (_idCache.has(s)) return _idCache.get(s) as number;
  _idCounter += 1;
  _idCache.set(s, _idCounter);
  return _idCounter;
}
