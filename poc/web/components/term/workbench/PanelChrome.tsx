import { useEffect, useState, type ComponentType, type FunctionComponent, type ReactNode } from 'react';
import type { IDockviewPanelHeaderProps, IDockviewPanelProps } from 'dockview';
import { cn } from '@/lib/utils';

/**
 * Custom dockview tab renderer (Mint Terminal chrome). dockview calls this for
 * every panel's tab; we read live active state off the panel `api` so the
 * focused panel gets the mint accent and the rest stay hairline-quiet.
 *
 * Layout: `⫿ TITLE` (uppercase, 10px, tracked) + a close button. The whole tab
 * is clickable to focus the panel (dockview wires the click), and the close
 * button stops propagation so closing doesn't first re-focus.
 */
export default function PanelChrome(props: IDockviewPanelHeaderProps) {
  const { api } = props;
  const [active, setActive] = useState(api.isActive);
  const [title, setTitle] = useState(api.title ?? api.id);

  useEffect(() => {
    const a = api.onDidActiveChange((e) => setActive(e.isActive));
    const t = api.onDidTitleChange((e) => setTitle(e.title));
    setActive(api.isActive);
    setTitle(api.title ?? api.id);
    return () => {
      a.dispose();
      t.dispose();
    };
  }, [api]);

  return (
    <div
      className={cn(
        'group flex h-full select-none items-center gap-2 border-r border-term-line px-3',
        'font-mono text-[10px] uppercase tracking-[0.12em] transition-colors duration-150',
        active
          ? 'bg-term-surface text-term-mint shadow-[inset_0_-1.5px_0_rgb(var(--term-mint))]'
          : 'bg-term-bg text-term-muted hover:text-term-text',
      )}
    >
      <span aria-hidden="true" className={active ? 'text-term-mint' : 'text-term-faint'}>
        ⫿
      </span>
      <span className="truncate">{title}</span>
      <button
        type="button"
        aria-label={`Close ${title} panel`}
        onClick={(e) => {
          e.stopPropagation();
          api.close();
        }}
        className={cn(
          'ml-1 grid h-4 w-4 place-items-center text-term-faint opacity-0 transition-opacity',
          'hover:text-term-danger focus-visible:opacity-100 focus-visible:outline-none',
          'focus-visible:ring-1 focus-visible:ring-term-mint group-hover:opacity-100',
          active && 'opacity-60',
        )}
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}

/**
 * Wraps a panel body in an accessible landmark (spec §9: panels are
 * `role="region"` + aria-label). The workbench composes every registry panel
 * through this so individual panel authors never repeat the boilerplate. The
 * aria-label comes from the panel's title param.
 */
export function PanelRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      role="region"
      aria-label={label}
      className="h-full w-full overflow-auto bg-term-surface text-term-text"
    >
      {children}
    </section>
  );
}

/**
 * Build the dockview `components` map value for a panel: render the panel body
 * inside a PanelRegion landmark, deriving the aria-label from the panel title.
 * Used by WorkbenchShell to wrap every registry component uniformly.
 */
export function withPanelRegion(
  Body: ComponentType,
  resolveLabel: (props: IDockviewPanelProps) => string,
): FunctionComponent<IDockviewPanelProps> {
  const Wrapped: FunctionComponent<IDockviewPanelProps> = (props) => (
    <PanelRegion label={resolveLabel(props)}>
      <Body />
    </PanelRegion>
  );
  Wrapped.displayName = `PanelRegion(${Body.displayName || Body.name || 'Panel'})`;
  return Wrapped;
}
