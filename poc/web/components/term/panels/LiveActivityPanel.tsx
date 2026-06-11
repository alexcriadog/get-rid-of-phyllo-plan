/**
 * LiveActivityPanel — unified real-time activity stream (Phase 3).
 *
 * Merges four polling sources into one descending-time feed:
 *   · /admin/api-calls         → 'call' items
 *   · /admin/events            → 'event' items
 *   · /admin/webhooks/inbound  → 'webhook_in' items
 *   · /admin/webhook-deliveries → 'delivery' items
 *
 * Client-side filter: free-text (summary contains) + kind facet chip.
 * Click a row → inline JSON drawer for the raw item.
 *
 * No props — self-fetches via useLive. Follows the SystemVitalsPanel pattern.
 */

'use client';

import { useMemo, useState, useCallback } from 'react';
import { useLive, POLL } from '@/lib/useLive';
import { useWorkspaceFilter } from '@/lib/workspace-context';
import { fmtTime } from '@/lib/format';
import FeedLine from '@/components/term/FeedLine';
import TermInput from '@/components/term/TermInput';
import ActionChip from '@/components/term/ActionChip';
import { cn } from '@/lib/utils';
import {
  mergeActivity,
  type ActivityItem,
  type ActivityKind,
  type ApiCallRaw,
  type EventRaw,
  type WebhookInRaw,
  type DeliveryRaw,
  ACTIVITY_CAP,
} from './activity-merge';

// ── Constants ────────────────────────────────────────────────────────────────

const VISIBLE_CAP = 100;

type FacetKind = 'all' | ActivityKind;

const FACETS: { id: FacetKind; label: string }[] = [
  { id: 'all', label: 'ALL' },
  { id: 'call', label: 'CALLS' },
  { id: 'event', label: 'EVENTS' },
  { id: 'webhook_in', label: 'WEBHOOKS' },
  { id: 'delivery', label: 'DELIVERIES' },
];

// ── Main component ────────────────────────────────────────────────────────────

export default function LiveActivityPanel() {
  const { withQuery } = useWorkspaceFilter();

  const callsLive = useLive<ApiCallRaw[]>(
    withQuery('/admin/api-calls?limit=500'),
    POLL.live,
  );
  const eventsLive = useLive<EventRaw[]>(
    withQuery('/admin/events?limit=300'),
    POLL.list,
  );
  const webhooksLive = useLive<WebhookInRaw[]>(
    '/admin/webhooks/inbound?limit=300',
    POLL.list,
  );
  const deliveriesLive = useLive<DeliveryRaw[]>(
    '/admin/webhook-deliveries?limit=200',
    POLL.live,
  );

  const allError =
    !!callsLive.error &&
    !!eventsLive.error &&
    !!webhooksLive.error &&
    !!deliveriesLive.error;

  const loading =
    callsLive.loading &&
    eventsLive.loading &&
    webhooksLive.loading &&
    deliveriesLive.loading &&
    !callsLive.data &&
    !eventsLive.data &&
    !webhooksLive.data &&
    !deliveriesLive.data;

  const merged = useMemo(
    () =>
      mergeActivity(
        callsLive.data ?? [],
        eventsLive.data ?? [],
        webhooksLive.data ?? [],
        deliveriesLive.data ?? [],
      ),
    [callsLive.data, eventsLive.data, webhooksLive.data, deliveriesLive.data],
  );

  const [filterText, setFilterText] = useState('');
  const [facet, setFacet] = useState<FacetKind>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const lower = filterText.toLowerCase();
    return merged.filter((item) => {
      if (facet !== 'all' && item.kind !== facet) return false;
      if (lower && !item.summary.toLowerCase().includes(lower)) return false;
      return true;
    });
  }, [merged, filterText, facet]);

  const visible = filtered.slice(0, VISIBLE_CAP);
  const overflow = filtered.length - visible.length;

  const handleRowClick = useCallback(
    (id: string) => setExpandedId((prev) => (prev === id ? null : id)),
    [],
  );

  return (
    <div className="flex h-full flex-col gap-2 p-3 font-mono text-xs">
      {/* Header */}
      <HeaderRow loading={loading} apiDown={allError} />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <TermInput
          placeholder="filter summary…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          aria-label="Filter activity by summary text"
          className="flex-1"
        />
        <div className="flex items-center gap-1" role="group" aria-label="Filter by kind">
          {FACETS.map((f) => (
            <ActionChip
              key={f.id}
              size="sm"
              variant={facet === f.id ? 'primary' : 'ghost'}
              onClick={() => setFacet(f.id)}
              aria-pressed={facet === f.id}
            >
              {f.label}
            </ActionChip>
          ))}
        </div>
        <span className="text-[10px] text-term-faint" aria-live="polite" aria-atomic="true">
          {filtered.length}/{merged.length}
        </span>
      </div>

      {/* Stream */}
      <div
        className="flex-1 overflow-y-auto"
        aria-live="polite"
        aria-label="Activity stream"
      >
        {loading && (
          <div className="flex items-center gap-2 text-term-faint">
            <span className="animate-term-blink text-term-mint">▮</span>
            connecting…
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="text-term-faint">
            {filterText || facet !== 'all'
              ? '— no items match filter —'
              : '— no activity yet —'}
          </div>
        )}

        <div className="space-y-0">
          {visible.map((item) => (
            <ActivityRow
              key={item.id}
              item={item}
              expanded={expandedId === item.id}
              onClick={handleRowClick}
            />
          ))}
        </div>

        {overflow > 0 && (
          <div className="mt-1 text-[10px] text-term-faint">
            … {overflow} more — refine filter
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HeaderRow({
  loading,
  apiDown,
}: {
  loading: boolean;
  apiDown: boolean;
}) {
  if (apiDown) {
    return (
      <div className="flex items-center gap-2 border-b border-term-line pb-2 text-term-danger">
        <span aria-hidden="true">●</span>
        <span className="uppercase tracking-[0.12em]">ALL SOURCES UNREACHABLE</span>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="flex items-center gap-2 border-b border-term-line pb-2 text-term-faint">
        <span className="animate-term-blink text-term-mint">▮</span>
        connecting…
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 border-b border-term-line pb-2">
      <span aria-hidden="true" className="text-term-mint">
        ●
      </span>
      <span className="uppercase tracking-[0.12em] text-term-faint">LIVE ACTIVITY</span>
      <span className="ml-auto text-[10px] text-term-faint">cap {ACTIVITY_CAP}</span>
    </div>
  );
}

interface ActivityRowProps {
  item: ActivityItem;
  expanded: boolean;
  onClick: (id: string) => void;
}

function ActivityRow({ item, expanded, onClick }: ActivityRowProps) {
  return (
    <div className="border-b border-term-line/40 last:border-0">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => onClick(item.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick(item.id);
          }
        }}
        className={cn(
          'cursor-pointer transition-colors hover:bg-term-line/20',
          expanded && 'bg-term-line/20',
        )}
      >
        <FeedLine
          time={fmtTime(item.ts)}
          platform={item.platform}
          status={item.status}
        >
          <KindTag kind={item.kind} />
          <span className="ml-1 truncate">{item.summary}</span>
        </FeedLine>
      </div>

      {expanded && <RawDrawer raw={item.raw} />}
    </div>
  );
}

function KindTag({ kind }: { kind: ActivityKind }) {
  const labels: Record<ActivityKind, string> = {
    call: 'CALL',
    event: 'EVT',
    webhook_in: 'WHK',
    delivery: 'DLV',
  };
  const toneClass: Record<ActivityKind, string> = {
    call: 'text-term-uv-tint',
    event: 'text-term-mint',
    webhook_in: 'text-term-warn',
    delivery: 'text-term-faint',
  };
  return (
    <span
      className={cn(
        'shrink-0 text-[10px] uppercase tracking-[0.1em]',
        toneClass[kind],
      )}
    >
      [{labels[kind]}]
    </span>
  );
}

function RawDrawer({ raw }: { raw: unknown }) {
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return String(raw);
    }
  }, [raw]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(pretty).catch(() => {});
  }, [pretty]);

  return (
    <div className="border-t border-term-line/50 bg-term-bg/60 px-3 py-2">
      <div className="mb-1 flex items-center justify-end">
        <ActionChip size="sm" variant="ghost" onClick={handleCopy}>
          COPY
        </ActionChip>
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-term-line bg-term-bg p-2 font-mono text-[10.5px] leading-relaxed text-term-text/90">
        {pretty}
      </pre>
    </div>
  );
}
