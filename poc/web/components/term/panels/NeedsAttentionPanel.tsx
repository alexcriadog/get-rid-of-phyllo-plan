import Link from 'next/link';
import { useLive, POLL } from '@/lib/useLive';
import { useWorkspaceFilter } from '@/lib/workspace-context';

/**
 * Phase 3 workbench panel: "Needs Attention"
 *
 * Ports the logic from `components/admin/needs-attention.tsx` into the Mint
 * Terminal idiom. Self-fetches the three endpoints the legacy home page
 * already polls — overview (DLQ depth) and accounts — then runs the same
 * `buildIssues` logic to produce a dense list of severity-ranked action rows.
 *
 * Data:
 *   GET /admin/overview   → { dlq_depth?: number }
 *   GET /admin/accounts   → AttentionAccount[]
 *
 * Rendering:
 *   - Each issue: severity dot (danger=●danger / warn=●warn), description,
 *     ActionChip that opens the legacy deep-link route.
 *   - Empty state: mint "0 — all clear ▮"
 *   - API-down state: danger "● API UNREACHABLE"
 *   - Loading state: blinking cursor "connecting…"
 *
 * Panel id: `needs-attention`
 */

// ── Types (matches the shapes from the legacy sources) ────────────────────

type ProductFreshness = {
  product: string;
  failure_count?: number;
};

type AttentionAccount = {
  id: string;
  platform: string;
  handle?: string | null;
  status: string;
  sync_tier: string;
  products: ProductFreshness[];
};

type Overview = {
  dlq_depth?: number;
};

type Issue = {
  key: string;
  tone: 'danger' | 'warn';
  label: string;
  detail: string;
  href: string;
};

// ── Issue builder (identical logic to legacy) ─────────────────────────────

const FAILURE_THRESHOLD = 3;

function buildIssues(accounts: AttentionAccount[], dlqDepth: number): Issue[] {
  const issues: Issue[] = [];

  if (dlqDepth > 0) {
    issues.push({
      key: 'dlq',
      tone: 'danger',
      label: `${dlqDepth} job${dlqDepth === 1 ? '' : 's'} in dead-letter queue`,
      detail: 'Failed jobs are not being retried automatically.',
      href: '/admin?deck=pipeline',
    });
  }

  for (const a of accounts) {
    const name = a.handle || `Account ${a.id}`;
    const paused = a.sync_tier === 'paused' || a.status === 'paused';

    if (a.status === 'needs_reauth') {
      issues.push({
        key: `reauth-${a.id}`,
        tone: 'danger',
        label: `${name} needs re-authentication`,
        detail: `${a.platform} · token expired or revoked`,
        href: `/admin?account=${a.id}`,
      });
      continue;
    }

    if (!paused) {
      const failing = (a.products ?? []).filter(
        (p) => (p.failure_count ?? 0) >= FAILURE_THRESHOLD,
      );
      if (failing.length > 0) {
        issues.push({
          key: `failing-${a.id}`,
          tone: 'danger',
          label: `${name} — ${failing.length} failing product${failing.length === 1 ? '' : 's'}`,
          detail: `${a.platform} · ${failing.map((p) => p.product).join(', ')}`,
          href: `/admin?account=${a.id}`,
        });
      }
    }
  }

  // Paused accounts are a softer signal — list them last.
  const pausedAccounts = accounts.filter(
    (a) => a.sync_tier === 'paused' || a.status === 'paused',
  );
  if (pausedAccounts.length > 0) {
    issues.push({
      key: 'paused',
      tone: 'warn',
      label: `${pausedAccounts.length} account${pausedAccounts.length === 1 ? '' : 's'} paused`,
      detail: 'Syncing is suspended for these accounts.',
      href: '/admin?deck=tenant-service',
    });
  }

  return issues
    .sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'danger' ? -1 : 1))
    .slice(0, 8);
}

// ── Tone helpers ──────────────────────────────────────────────────────────

const DOT_CLASS: Record<'danger' | 'warn', string> = {
  danger: 'text-term-danger',
  warn: 'text-term-warn',
};

// ── Panel ─────────────────────────────────────────────────────────────────

export default function NeedsAttentionPanel() {
  const { withQuery } = useWorkspaceFilter();

  const overviewLive = useLive<Overview>(withQuery('/admin/overview'), POLL.list);
  const accountsLive = useLive<AttentionAccount[]>(withQuery('/admin/accounts'), POLL.list);

  const apiDown =
    (!!overviewLive.error && !overviewLive.data) ||
    (!!accountsLive.error && !accountsLive.data);

  const loading = overviewLive.loading && !overviewLive.data;

  if (apiDown) {
    return (
      <div className="flex h-full flex-col gap-3 p-3 font-mono text-xs">
        <div className="flex items-center gap-2 border-b border-term-line pb-2 text-term-danger">
          <span aria-hidden="true">●</span>
          <span className="uppercase tracking-[0.12em]">API UNREACHABLE</span>
          {(overviewLive.error || accountsLive.error) && (
            <span className="truncate text-term-faint">
              {overviewLive.error ?? accountsLive.error}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-3 p-3 font-mono text-xs">
        <div className="flex items-center gap-2 border-b border-term-line pb-2 text-term-faint">
          <span className="animate-term-blink text-term-mint">▮</span>
          connecting…
        </div>
      </div>
    );
  }

  const accounts = accountsLive.data ?? [];
  const dlqDepth = overviewLive.data?.dlq_depth ?? 0;
  const issues = buildIssues(accounts, dlqDepth);

  return (
    <div className="flex h-full flex-col p-3 font-mono text-xs">
      {/* Header row */}
      <div className="mb-2 flex items-baseline gap-2 border-b border-term-line pb-2">
        <span className="uppercase tracking-[0.12em] text-term-faint">ATTENTION</span>
        {issues.length > 0 && (
          <span className="text-term-warn tabular-nums">
            {issues.length} item{issues.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* Empty state */}
      {issues.length === 0 ? (
        <div className="flex items-center gap-2 text-term-mint">
          <span aria-hidden="true">●</span>
          <span>0 — all clear</span>
          <span className="animate-term-blink" aria-hidden="true">▮</span>
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto space-y-0">
          {issues.map((issue) => (
            <li key={issue.key} className="border-b border-term-line/60 last:border-0">
              <Link
                href={issue.href}
                className="group flex items-start gap-2 py-2 pr-1 hover:bg-term-line/20 transition-colors"
              >
                {/* Severity dot */}
                <span
                  aria-hidden="true"
                  className={`mt-px shrink-0 ${DOT_CLASS[issue.tone]}`}
                >
                  ●
                </span>

                {/* Content */}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-term-text/90">{issue.label}</span>
                  <span className="block truncate text-[10px] text-term-faint">
                    {issue.detail}
                  </span>
                </span>

                {/* Action affordance */}
                <span
                  className="shrink-0 border border-term-line text-term-muted text-[10px] px-1.5 py-0.5 uppercase tracking-[0.06em] group-hover:border-term-mint group-hover:text-term-mint transition-colors"
                  aria-hidden="true"
                >
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
