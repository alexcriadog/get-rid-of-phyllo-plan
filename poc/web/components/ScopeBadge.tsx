import { Globe, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Scope is a first-class axis in this console: every screen is either GLOBAL
 * (infrastructure, all tenants) or TENANT-scoped. This badge makes that
 * explicit and is intended to appear on every admin surface.
 */
type ScopeBadgeProps =
  | { scope: 'global'; reason?: string; tenant?: never; className?: string }
  | { scope: 'tenant'; tenant: string; reason?: never; className?: string };

export default function ScopeBadge(props: ScopeBadgeProps) {
  const isGlobal = props.scope === 'global';
  return (
    <div
      role="note"
      className={cn(
        'mb-4 flex items-center gap-2 rounded-md border px-3 py-1.5 text-[12px]',
        isGlobal
          ? 'border-border bg-card/60 text-muted-foreground'
          : 'border-primary/30 bg-primary/5 text-foreground',
        props.className,
      )}
    >
      {isGlobal ? (
        <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <Building2 className="h-3.5 w-3.5 shrink-0 text-primary" />
      )}
      {isGlobal ? (
        <span>
          <span className="font-medium text-foreground/80">Global view.</span>{' '}
          {props.reason ?? 'Spans all tenants; the workspace filter is not applied.'}
        </span>
      ) : (
        <span>
          <span className="font-medium uppercase tracking-wide text-primary">Tenant</span>{' '}
          <span className="font-mono">{props.tenant}</span>
        </span>
      )}
    </div>
  );
}
