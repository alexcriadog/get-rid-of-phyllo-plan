import dynamic from 'next/dynamic';

/**
 * Ops Terminal workbench route (spec §11 phase 2). Rendered client-only: the
 * dockview engine touches `window`, and panels poll on mount, so SSR would both
 * crash and waste a render. No AdminLayout — the workbench is its own
 * full-viewport shell. Legacy `/admin/*` pages are untouched and keep working
 * until the Phase 5 cutover.
 */
const WorkbenchShell = dynamic(
  () => import('@/components/term/workbench/WorkbenchShell'),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-screen w-screen place-items-center bg-term-bg font-mono text-xs text-term-faint">
        ▮▮▮▯▯ booting ops terminal…
      </div>
    ),
  },
);

export default function TerminalPage() {
  return <WorkbenchShell />;
}
