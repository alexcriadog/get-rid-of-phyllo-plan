import { Info } from 'lucide-react';

/**
 * Banner shown at the top of admin pages whose data is global by design
 * (rate buckets, cadence defaults, support matrix). Tells the operator
 * that the topbar workspace filter is intentionally not applied.
 */
export default function GlobalScopeBadge({ reason }: { reason: string }) {
  return (
    <div
      role="note"
      className="mb-4 flex items-start gap-2 rounded-md border border-border bg-card/60 px-3 py-2 text-[12px] text-muted-foreground"
    >
      <Info className="mt-[1px] h-3.5 w-3.5 shrink-0 text-primary/70" />
      <span>
        <span className="font-medium text-foreground/80">Global view.</span>{' '}
        {reason}
      </span>
    </div>
  );
}
