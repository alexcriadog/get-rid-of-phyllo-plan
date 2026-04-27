import {
  ReactNode,
  useRef,
  useState,
  useCallback,
  useEffect,
} from 'react';
import { createPortal } from 'react-dom';

export type TooltipLine = {
  label: string;
  value: string | number;
  color?: string;
};

export type TooltipPayload = {
  title?: string;
  lines: TooltipLine[];
};

export type TooltipState = {
  /** Raw cursor X in viewport coordinates. */
  clientX: number;
  /** Raw cursor Y in viewport coordinates. */
  clientY: number;
  data: TooltipPayload;
} | null;

// Estimated dimensions used purely for placement decisions. The real
// tooltip can be slightly bigger; the constants give us a safe margin
// to avoid overflow without ever needing to measure the rendered DOM.
const ESTIMATED_TOOLTIP_W = 240;
const ESTIMATED_TOOLTIP_H = 110;
const CURSOR_OFFSET = 16;

/**
 * Hook that owns the tooltip state. Stores raw viewport coordinates so the
 * <Tooltip> component can render via portal at fixed position — no
 * dependency on container layout, no DOM measurement, no re-render loops.
 *
 * Returns:
 *  - `containerRef` — kept for API compatibility but no longer required
 *  - `tip` — current tooltip state (null when hidden)
 *  - `show(clientX, clientY, data)` — call from chart hover handlers
 *  - `hide()` — call from mouse-leave
 */
export function useTooltip() {
  const [tip, setTip] = useState<TooltipState>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const show = useCallback(
    (clientX: number, clientY: number, data: TooltipPayload) => {
      setTip({ clientX, clientY, data });
    },
    [],
  );
  const hide = useCallback(() => setTip(null), []);

  useEffect(() => {
    const onScroll = () => setTip(null);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return { containerRef, tip, show, hide };
}

export function Tooltip({ tip }: { tip: TooltipState }): ReactNode {
  // SSR guard — portal needs document.
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (!tip) return null;

  // Decide placement from viewport bounds. Pure function of cursor coords +
  // window size; no DOM measurement → no setState → no loop.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const flipLeft = tip.clientX + CURSOR_OFFSET + ESTIMATED_TOOLTIP_W > vw - 8;
  const flipUp = tip.clientY + CURSOR_OFFSET + ESTIMATED_TOOLTIP_H > vh - 8;

  const transformParts: string[] = [];
  let leftPx = tip.clientX + CURSOR_OFFSET;
  if (flipLeft) {
    leftPx = tip.clientX - CURSOR_OFFSET;
    transformParts.push('translateX(-100%)');
  }
  let topPx = tip.clientY + CURSOR_OFFSET;
  if (flipUp) {
    topPx = tip.clientY - CURSOR_OFFSET;
    transformParts.push('translateY(-100%)');
  }

  const node = (
    <div
      role="tooltip"
      style={{
        position: 'fixed',
        left: leftPx,
        top: topPx,
        transform: transformParts.length ? transformParts.join(' ') : undefined,
        pointerEvents: 'none',
        background: 'var(--bg-panel-elev)',
        border: '1px solid var(--border-hi)',
        borderRadius: 'var(--radius)',
        padding: '8px 10px',
        minWidth: 130,
        maxWidth: 280,
        boxShadow: 'var(--shadow-md)',
        fontFamily: 'var(--mono)',
        fontSize: 11,
        letterSpacing: '0.02em',
        color: 'var(--text)',
        zIndex: 9999,
      }}
    >
      {tip.data.title && (
        <div
          style={{
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            fontSize: 9,
            marginBottom: 6,
          }}
        >
          {tip.data.title}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {tip.data.lines.map((l, i) => (
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
              {l.color && (
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: l.color,
                  }}
                />
              )}
              {l.label}
            </span>
            <span style={{ color: l.color ?? 'var(--text)' }}>{l.value}</span>
          </div>
        ))}
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
