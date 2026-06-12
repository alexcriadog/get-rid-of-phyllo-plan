import type { ReactNode } from 'react';
import Link from 'next/link';
import Head from 'next/head';
import WorkspaceSelect from '@/components/WorkspaceSelect';
import ThemeToggle from '@/components/ThemeToggle';
import ErrorBoundary from '@/components/ErrorBoundary';

/**
 * ConfigLayout — minimal term-styled chrome for the two mutation-heavy editors
 * that survive the Phase 5b cutover (`/admin/config/workspace/[slug]` and
 * `/admin/config/sync/[id]`).
 *
 * The workbench inspectors are read-only by design, so these legacy forms are
 * the only surfaces that can still WRITE tenant + sync configuration. They keep
 * their original shadcn/ui internals (out of restyle scope); this layout only
 * supplies the surrounding chrome: a term top bar (brand glyph + CONFIG label,
 * a "← TERMINAL" link back to /admin, WorkspaceSelect + ThemeToggle) and a
 * max-width content container on `bg-term-bg`.
 */
interface ConfigLayoutProps {
  /** Surface title shown in the chrome and used to name the error boundary. */
  title: string;
  /** Optional page-specific action node, rendered at the right of the bar. */
  actions?: ReactNode;
  children: ReactNode;
}

export default function ConfigLayout({ title, actions, children }: ConfigLayoutProps) {
  return (
    <div className="min-h-screen bg-term-bg font-mono text-term-text antialiased">
      <Head>
        <title>{`${title} — Config — Camaleonic Connect`}</title>
      </Head>

      <header className="sticky top-0 z-30 flex h-11 items-center gap-4 border-b border-term-line bg-term-bg px-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid h-4 w-4 place-items-center border-[1.5px] border-term-mint"
          />
          <div className="flex flex-col leading-none">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-term-mint">
              Camaleonic Connect
            </span>
            <span className="text-[9px] uppercase tracking-[0.2em] text-term-faint">
              Config
            </span>
          </div>
        </div>

        <Link
          href="/admin"
          className="inline-flex h-7 items-center gap-1.5 border border-term-line-2 px-2 text-[11px] uppercase tracking-[0.08em] text-term-muted transition-colors duration-150 hover:border-term-faint hover:text-term-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-term-mint"
        >
          <span aria-hidden="true" className="text-term-mint">
            ←
          </span>
          <span className="hidden sm:inline">Terminal</span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          {actions}
          <WorkspaceSelect />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1100px] px-4 py-6 lg:px-8 lg:py-8">
        <div className="mb-4 flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-term-faint">
            CONFIG /
          </span>
          <h1 className="truncate text-sm font-semibold tracking-tight text-term-text">
            {title}
          </h1>
        </div>
        <ErrorBoundary surface={title}>{children}</ErrorBoundary>
      </main>
    </div>
  );
}
