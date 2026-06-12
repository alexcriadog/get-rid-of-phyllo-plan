import dynamic from 'next/dynamic';

/**
 * Ops Terminal workbench — now the canonical `/admin` route (Phase 5b cutover).
 *
 * Rendered client-only: the dockview engine touches `window`, and panels poll
 * on mount, so SSR would both crash and waste a render. No AdminLayout — the
 * workbench is its own full-viewport shell. The legacy `/admin/*` pages have
 * been deleted and now 30x-redirect into this workbench (see next.config.js);
 * the two mutation-heavy editors survive under `/admin/config/*`.
 *
 * Object permalinks (spec §2.3 + Phase 5b ?panel):
 *   ?workspace=<slug>  → selectWorkspace + open tenant-inspector
 *   ?account=<id>      → selectAccount + open account-inspector
 *   ?panel=<PanelId>   → open/focus that panel in the current deck
 * Params are consumed on mount (shallow-routed, no data fetch here).
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

export default function AdminWorkbenchPage() {
  return <WorkbenchShell />;
}

// ── Permalink param helpers (spec §2.3) ──────────────────────────────────────

/**
 * Extract the first string value of a query param from a Next.js query object.
 * Returns null when the param is absent, empty, or array-shaped with no first
 * element.
 */
export function extractQueryParam(
  value: string | string[] | undefined,
): string | null {
  if (!value) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.length > 0 ? raw : null;
}
