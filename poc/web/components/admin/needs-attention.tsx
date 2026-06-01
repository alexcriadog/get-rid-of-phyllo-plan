import Link from 'next/link';
import { AlertTriangle, KeyRound, Inbox, PauseCircle, ChevronRight, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Operator "Needs attention" panel for the Home screen. Distills the live
 * fleet state into the handful of things an operator should act on right
 * now, each deep-linking to the exact diagnose view. Computed purely from
 * data the Home page already polls — no new endpoint.
 *
 * Severity ordering: danger (reauth, failing, DLQ) before warn (paused).
 * When nothing is wrong it collapses to a single reassuring line so the
 * panel is still a trustworthy "all clear" signal rather than empty space.
 */
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

interface NeedsAttentionProps {
  accounts: AttentionAccount[];
  dlqDepth: number;
}

type Issue = {
  key: string;
  tone: 'danger' | 'warn';
  icon: typeof AlertTriangle;
  label: string;
  detail: string;
  href: string;
};

const FAILURE_THRESHOLD = 3;

function buildIssues(accounts: AttentionAccount[], dlqDepth: number): Issue[] {
  const issues: Issue[] = [];

  if (dlqDepth > 0) {
    issues.push({
      key: 'dlq',
      tone: 'danger',
      icon: Inbox,
      label: `${dlqDepth} job${dlqDepth === 1 ? '' : 's'} in the dead-letter queue`,
      detail: 'Failed jobs are not being retried automatically.',
      href: '/admin/queues',
    });
  }

  for (const a of accounts) {
    const name = a.handle || `Account ${a.id}`;
    const paused = a.sync_tier === 'paused' || a.status === 'paused';

    if (a.status === 'needs_reauth') {
      issues.push({
        key: `reauth-${a.id}`,
        tone: 'danger',
        icon: KeyRound,
        label: `${name} needs re-authentication`,
        detail: `${a.platform} · token expired or revoked`,
        href: `/admin/accounts/${a.id}`,
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
          icon: AlertTriangle,
          label: `${name} — ${failing.length} failing product${failing.length === 1 ? '' : 's'}`,
          detail: `${a.platform} · ${failing.map((p) => p.product).join(', ')}`,
          href: `/admin/accounts/${a.id}`,
        });
      }
    }
  }

  // Paused accounts are a softer signal — list them after the hard failures.
  const pausedAccounts = accounts.filter(
    (a) => a.sync_tier === 'paused' || a.status === 'paused',
  );
  if (pausedAccounts.length > 0) {
    issues.push({
      key: 'paused',
      tone: 'warn',
      icon: PauseCircle,
      label: `${pausedAccounts.length} account${pausedAccounts.length === 1 ? '' : 's'} paused`,
      detail: 'Syncing is suspended for these accounts.',
      href: '/admin/accounts',
    });
  }

  // Hard failures first, then warnings; cap so the panel never dominates.
  return issues
    .sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'danger' ? -1 : 1))
    .slice(0, 8);
}

export function NeedsAttention({ accounts, dlqDepth }: NeedsAttentionProps) {
  const issues = buildIssues(accounts, dlqDepth);

  if (issues.length === 0) {
    return (
      <div className="mb-6 flex items-center gap-2.5 rounded-lg border border-ok/30 bg-ok/5 px-4 py-3 text-sm">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" />
        <span className="font-medium text-foreground">All clear.</span>
        <span className="text-muted-foreground">
          No accounts need re-auth, no failing products, dead-letter queue empty.
        </span>
      </div>
    );
  }

  return (
    <section
      aria-label="Needs attention"
      className="mb-6 overflow-hidden rounded-lg border border-border bg-card"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <AlertTriangle className="h-4 w-4 text-warn" />
        <h2 className="text-sm font-semibold">Needs attention</h2>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {issues.length} item{issues.length === 1 ? '' : 's'}
        </span>
      </header>
      <ul className="divide-y divide-border">
        {issues.map((issue) => {
          const Icon = issue.icon;
          return (
            <li key={issue.key}>
              <Link
                href={issue.href}
                className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-secondary/50"
              >
                <span
                  className={cn(
                    'grid h-7 w-7 shrink-0 place-items-center rounded-md',
                    issue.tone === 'danger'
                      ? 'bg-danger/10 text-danger'
                      : 'bg-warn/10 text-warn',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {issue.label}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {issue.detail}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
