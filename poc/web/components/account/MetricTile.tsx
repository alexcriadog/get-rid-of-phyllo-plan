/**
 * MetricTile — single metric card with hover tooltip carrying provenance
 * metadata (period window, scope, availability). Phase F of the IG total-
 * coverage rollout.
 *
 * Drop-in replacement for the inline `AccountKpi` component that lived in
 * pages/account/[id].tsx. The visual shell is intentionally identical
 * (same dark surface, same `v-display`/`v-meta` classes) so the dashboard
 * doesn't visually shift when the refactor lands. The new behaviour is the
 * Radix tooltip that surfaces on hover/focus.
 *
 * If `metricKey` isn't in the catalog the component falls back to a
 * label-only render with no tooltip — old call sites keep working.
 */

import * as React from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { fmtNumber } from '@/lib/format';
import {
  type MetricDescriptor,
  lookupMetric,
} from '@/lib/metric-catalog';

interface MetricTileProps {
  /**
   * Platform that owns this metric (instagram | facebook | youtube |
   * tiktok | threads). Required so the catalog lookup picks the right
   * descriptor — the same `metricKey` ('reach', 'views', …) means
   * different things across platforms.
   */
  platform?: string;
  /** Catalog key (matches metrics.<key> in Mongo). */
  metricKey: string;
  /**
   * Override for the displayed value. When undefined / non-numeric,
   * the tile is hidden — matches the existing
   * `tiles.filter(t => typeof t.value === 'number')` pattern in
   * pages/account/[id].tsx so empty metrics never render.
   */
  value: number | null | undefined;
  /** Visual variant. `subtle` is the older outlined style. */
  subtle?: boolean;
  /** Optional label override when the catalog descriptor is wrong/missing. */
  labelOverride?: string;
}

export function MetricTile({
  platform,
  metricKey,
  value,
  subtle,
  labelOverride,
}: MetricTileProps) {
  if (typeof value !== 'number') return null;

  const meta = lookupMetric(platform, metricKey);
  // Catalog label wins when present — that's the curated copy. Only fall
  // back to the caller's override (typically a `prettyLabel` of the raw
  // Mongo key) when the catalog has nothing.
  const label = meta?.label ?? labelOverride ?? metricKey;

  const tile = (
    <div
      style={{
        background: subtle ? 'transparent' : '#2d2d2d',
        border: subtle ? '1px solid rgba(255,255,255,0.15)' : 'none',
        borderRadius: 20,
        padding: 14,
        cursor: meta ? 'help' : 'default',
      }}
    >
      <div className="v-meta" style={{ fontSize: 10, marginBottom: 4 }}>
        {label}
      </div>
      <div
        className="v-display"
        style={{
          fontSize: subtle ? 22 : 28,
          lineHeight: 1,
          color: '#fff',
        }}
      >
        {fmtNumber(value)}
      </div>
    </div>
  );

  if (!meta) return tile;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{tile}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px] text-left">
        <MetricTooltipBody meta={meta} />
      </TooltipContent>
    </Tooltip>
  );
}

function MetricTooltipBody({ meta }: { meta: MetricDescriptor }) {
  return (
    <div className="space-y-1">
      <div className="font-semibold">{meta.label}</div>
      <div className="opacity-90">{meta.description}</div>
      <div className="opacity-60">
        Ventana: {meta.windowSummary} · Scope: <code>{meta.scope}</code>
      </div>
      {meta.availableSince && (
        <div className="opacity-60">Disponible desde: {meta.availableSince}</div>
      )}
    </div>
  );
}
