/**
 * RawInspectorPanel — compact raw-response browser (Phase 3).
 *
 * Ports pages/admin/raw.tsx into the Mint Terminal idiom:
 *   · Left column: scrollable list of recent raw responses (polled)
 *   · Right column: JSON body viewer for the selected row
 *
 * Data: GET /admin/raw-responses?limit=200  (polled at POLL.list)
 *       GET /admin/raw-responses/:id        (on-demand, via fetch)
 *
 * No props — self-fetches via useLive. Follows the SystemVitalsPanel pattern.
 */

'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useLive, POLL } from '@/lib/useLive';
import { useWorkspaceFilter } from '@/lib/workspace-context';
import { fmtTime } from '@/lib/format';
import TermInput from '@/components/term/TermInput';
import ActionChip from '@/components/term/ActionChip';
import PlatformTag from '@/components/term/PlatformTag';
import { cn } from '@/lib/utils';
import { CONNECTOR_API_URL } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RawResponse {
  id: string;
  accountId?: string;
  platform?: string;
  endpoint?: string;
  contentHash?: string;
  sizeBytes?: number;
  fetchedAt?: string;
}

interface RawDetail extends RawResponse {
  body?: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RawInspectorPanel() {
  const { withQuery } = useWorkspaceFilter();
  const { data, error } = useLive<RawResponse[]>(
    withQuery('/admin/raw-responses?limit=200'),
    POLL.list,
  );

  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = data ?? [];
  const apiDown = !!error && !data;

  const filtered = useMemo(() => {
    const lower = search.toLowerCase();
    return lower
      ? rows.filter((r) => (r.endpoint ?? '').toLowerCase().includes(lower))
      : rows;
  }, [rows, search]);

  // When the list refreshes and the selected row vanishes, deselect.
  useEffect(() => {
    if (selectedId && rows.length > 0 && !rows.find((r) => r.id === selectedId)) {
      setSelectedId(null);
    }
  }, [rows, selectedId]);

  return (
    <div className="flex h-full flex-col gap-2 p-3 font-mono text-xs">
      {/* Header */}
      <HeaderRow apiDown={apiDown} />

      {/* Search */}
      <TermInput
        placeholder="filter endpoint…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Filter raw responses by endpoint"
      />

      {/* Body */}
      <div className="flex min-h-0 flex-1 gap-2">
        {/* List */}
        <div className="flex w-1/2 flex-col overflow-hidden rounded border border-term-line">
          <div className="grid grid-cols-[52px_52px_1fr_40px] gap-1 border-b border-term-line bg-term-bg px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-term-faint">
            <span>Time</span>
            <span>Plat</span>
            <span>Endpoint</span>
            <span className="text-right">Size</span>
          </div>
          <div className="flex-1 overflow-y-auto" aria-label="Raw response list">
            {!data && !error && (
              <div className="p-2 text-term-faint">
                <span className="animate-term-blink text-term-mint">▮</span>{' '}
                loading…
              </div>
            )}
            {filtered.length === 0 && data && (
              <div className="p-2 text-term-faint">— no responses captured —</div>
            )}
            {filtered.map((r) => {
              const active = selectedId === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className={cn(
                    'grid w-full grid-cols-[52px_52px_1fr_40px] items-center gap-1 border-b border-term-line/40 px-2 py-1 text-left text-[11px] transition-colors last:border-0',
                    active
                      ? 'bg-term-mint/10 text-term-text'
                      : 'text-term-text/80 hover:bg-term-line/20',
                  )}
                  aria-pressed={active}
                >
                  <span className="text-term-faint">{fmtTime(r.fetchedAt)}</span>
                  {r.platform ? (
                    <PlatformTag platform={r.platform} />
                  ) : (
                    <span className="text-term-faint">—</span>
                  )}
                  <span className="truncate" title={r.endpoint}>
                    {r.endpoint ?? '—'}
                  </span>
                  <span className="text-right text-[10px] text-term-faint">
                    {fmtBytes(r.sizeBytes ?? 0)}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="border-t border-term-line px-2 py-1 text-[10px] text-term-faint">
            {filtered.length} / {rows.length}
          </div>
        </div>

        {/* Inspector */}
        <div className="flex w-1/2 flex-col overflow-hidden rounded border border-term-line">
          <div className="border-b border-term-line px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-term-faint">
            BODY INSPECTOR
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {!selectedId ? (
              <span className="text-term-faint">← select a row</span>
            ) : (
              <BodyViewer id={selectedId} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HeaderRow({ apiDown }: { apiDown: boolean }) {
  if (apiDown) {
    return (
      <div className="flex items-center gap-2 border-b border-term-line pb-2 text-term-danger">
        <span aria-hidden="true">●</span>
        <span className="uppercase tracking-[0.12em]">API UNREACHABLE</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 border-b border-term-line pb-2">
      <span aria-hidden="true" className="text-term-mint">
        ●
      </span>
      <span className="uppercase tracking-[0.12em] text-term-faint">RAW INSPECTOR</span>
    </div>
  );
}

function BodyViewer({ id }: { id: string }) {
  const [detail, setDetail] = useState<RawDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);

    fetch(`${CONNECTOR_API_URL}/admin/raw-responses/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<RawDetail>;
      })
      .then((j) => {
        if (!cancelled) setDetail(j);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error).message ?? 'fetch failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="text-term-faint">
        <span className="animate-term-blink text-term-mint">▮</span> loading…
      </div>
    );
  }

  if (error) {
    return <div className="text-term-danger">{error}</div>;
  }

  if (!detail) return null;

  return <DetailBody detail={detail} />;
}

function DetailBody({ detail }: { detail: RawDetail }) {
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(detail.body ?? detail, null, 2);
    } catch {
      return String(detail.body ?? detail);
    }
  }, [detail]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(pretty).catch(() => {});
  }, [pretty]);

  return (
    <div className="flex flex-col gap-2">
      {/* Meta */}
      <div className="flex flex-wrap items-center gap-1 text-[10px]">
        {detail.platform && <PlatformTag platform={detail.platform} showLabel />}
        <span className="text-term-faint">#{detail.accountId ?? '—'}</span>
        <span className="text-term-faint">{fmtTime(detail.fetchedAt)}</span>
        {detail.sizeBytes != null && (
          <span className="text-term-faint">{fmtBytes(detail.sizeBytes)}</span>
        )}
      </div>

      {detail.endpoint && (
        <div className="break-all text-[10.5px] text-term-faint">{detail.endpoint}</div>
      )}

      {detail.contentHash && (
        <div className="break-all text-[10px] text-term-faint/70">
          sha256: {detail.contentHash}
        </div>
      )}

      <div className="flex items-center justify-end">
        <ActionChip size="sm" variant="ghost" onClick={handleCopy}>
          COPY
        </ActionChip>
      </div>

      <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-all rounded border border-term-line bg-term-bg p-2 font-mono text-[10.5px] leading-relaxed text-term-text/90">
        {pretty}
      </pre>
    </div>
  );
}
