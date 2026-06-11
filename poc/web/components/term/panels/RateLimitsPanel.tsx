/**
 * RateLimitsPanel — Phase 4 workbench panel (id: "rate-limits").
 *
 * Merges two legacy admin pages into two in-panel tabs:
 *   · LIMITS — per-platform/scope rate-limit state from:
 *       GET /admin/rate-buckets  (local token-bucket fuses)
 *       GET /admin/rate-limits   (Meta BUC mirror — X-App-Usage headers)
 *   · LOCKS  — active throttle lock windows from:
 *       GET /admin/throttle-locks
 *
 * Both sources are global (no workspace filter) — buckets and locks live at
 * the connector-app level, not per-workspace.
 *
 * Intentionally left out vs the legacy pages:
 * – Sparkline token-history charts (too small to be readable at panel tile width)
 * – Deny-ranking HBarChart (replaced by inline sort by denies in compact rows)
 * – Reset bucket / Replay BUC buttons (mutation surface left in the full page)
 * – Release lock button (same reasoning — tile is read-focused)
 *
 * The Gauge component from @/components/term/charts accepts value 0..1 and
 * its built-in tone escalation (≥0.7 warn, ≥0.9 danger) maps perfectly to
 * both rate-bucket fill ratios and BUC % readings.
 */

'use client';

import { useMemo, useState } from 'react';
import { useLive, POLL } from '@/lib/useLive';
import { fmtRelative } from '@/lib/format';
import { Gauge, MiniBar } from '@/components/term/charts';
import ActionChip from '@/components/term/ActionChip';
import PlatformTag from '@/components/term/PlatformTag';

// ── Types ─────────────────────────────────────────────────────────────────────

type Bucket = {
  key: string;
  platform: string;
  scope?: string;
  tokens: number;
  capacity: number;
  hits?: number;
  denies?: number;
  account?: {
    id: string;
    platform: string;
    handle: string | null;
    display_name: string | null;
  } | null;
};

type MirrorBucket = {
  scopeKey: string;
  source: 'app' | 'buc';
  type: string;
  callCountPct: number;
  totalTimePct: number;
  totalCpuPct: number;
  retryAfterMs: number;
  lastSeenAt: number;
};

type MirrorSnapshot = {
  generated_at: string;
  buckets: MirrorBucket[];
};

type Lock = {
  key: string;
  account_id?: number | string;
  product?: string;
  ttl_remaining_ms?: number;
  ttl_total_ms?: number;
  acquired_at?: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_TTL_TOTAL_MS = 600_000; // 10-min cooldown

type Tab = 'limits' | 'locks';

const TABS: { id: Tab; label: string }[] = [
  { id: 'limits', label: 'LIMITS' },
  { id: 'locks', label: 'LOCKS' },
];

// ── Main component ─────────────────────────────────────────────────────────────

export default function RateLimitsPanel() {
  const [tab, setTab] = useState<Tab>('limits');

  const bucketsLive = useLive<Bucket[]>('/admin/rate-buckets', POLL.live);
  const mirrorLive = useLive<MirrorSnapshot>('/admin/rate-limits', POLL.list);
  const locksLive = useLive<Lock[]>('/admin/throttle-locks', POLL.live);

  const limitsApiDown =
    !!bucketsLive.error && !bucketsLive.data &&
    !!mirrorLive.error && !mirrorLive.data;
  const locksApiDown = !!locksLive.error && !locksLive.data;
  const apiDown = tab === 'limits' ? limitsApiDown : locksApiDown;

  const loading =
    tab === 'limits'
      ? bucketsLive.loading && !bucketsLive.data && mirrorLive.loading && !mirrorLive.data
      : locksLive.loading && !locksLive.data;

  return (
    <div className="flex h-full flex-col gap-2 p-3 font-mono text-xs">
      {/* Header */}
      <HeaderRow apiDown={apiDown} loading={loading} />

      {/* Tab bar */}
      <div className="flex items-center gap-1" role="tablist" aria-label="Rate limits sections">
        {TABS.map((t) => (
          <ActionChip
            key={t.id}
            size="sm"
            variant={tab === t.id ? 'primary' : 'ghost'}
            onClick={() => setTab(t.id)}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`rl-tab-${t.id}`}
          >
            {t.label}
            {t.id === 'locks' && (locksLive.data?.length ?? 0) > 0 && (
              <span className="ml-1 text-term-warn">{locksLive.data?.length}</span>
            )}
          </ActionChip>
        ))}
      </div>

      {/* Tab panels */}
      <div
        id={`rl-tab-${tab}`}
        role="tabpanel"
        aria-label={tab === 'limits' ? 'Rate limits' : 'Throttle locks'}
        className="flex-1 overflow-y-auto"
      >
        {tab === 'limits' && (
          <LimitsTab
            buckets={bucketsLive.data ?? []}
            mirror={mirrorLive.data ?? null}
            apiDown={limitsApiDown}
          />
        )}
        {tab === 'locks' && (
          <LocksTab
            locks={locksLive.data ?? []}
            apiDown={locksApiDown}
          />
        )}
      </div>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function HeaderRow({ apiDown, loading }: { apiDown: boolean; loading: boolean }) {
  if (apiDown) {
    return (
      <div className="flex items-center gap-2 border-b border-term-line pb-2 text-term-danger">
        <span aria-hidden="true">●</span>
        <span className="uppercase tracking-[0.12em]">API UNREACHABLE</span>
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
      <span aria-hidden="true" className="text-term-mint">●</span>
      <span className="uppercase tracking-[0.12em] text-term-mint">RATE LIMITS</span>
      <span className="text-term-faint">· buckets · BUC · locks</span>
    </div>
  );
}

// ── LIMITS tab ────────────────────────────────────────────────────────────────

function LimitsTab({
  buckets,
  mirror,
  apiDown,
}: {
  buckets: Bucket[];
  mirror: MirrorSnapshot | null;
  apiDown: boolean;
}) {
  // Sort local buckets: highest consumed fraction first so the most-stressed
  // buckets bubble to the top without a separate deny-ranking chart.
  const sortedBuckets = useMemo(
    () =>
      [...buckets].sort((a, b) => {
        const ratioA = a.capacity > 0 ? 1 - a.tokens / a.capacity : 0;
        const ratioB = b.capacity > 0 ? 1 - b.tokens / b.capacity : 0;
        return ratioB - ratioA;
      }),
    [buckets],
  );

  const mirrorBuckets = mirror?.buckets ?? [];

  if (apiDown) {
    return (
      <div className="py-4 text-center text-term-danger">
        <span className="animate-term-blink">▮</span> endpoint unreachable
      </div>
    );
  }

  if (buckets.length === 0 && mirrorBuckets.length === 0) {
    return (
      <div className="py-6 text-center text-term-faint">
        &gt; no rate buckets yet <span className="animate-term-blink">▮</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Local token buckets */}
      {sortedBuckets.length > 0 && (
        <section aria-label="Local rate buckets">
          <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-term-faint">
            LOCAL BUCKETS
          </div>
          <div className="space-y-2">
            {sortedBuckets.map((b) => (
              <BucketRow key={b.key} bucket={b} />
            ))}
          </div>
        </section>
      )}

      {/* Meta BUC mirror */}
      {mirrorBuckets.length > 0 && (
        <section aria-label="Meta BUC mirror">
          <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-term-faint">
            META BUC MIRROR
            {mirror?.generated_at && (
              <span className="ml-2 normal-case tracking-normal text-term-faint/60">
                · {fmtRelative(mirror.generated_at)}
              </span>
            )}
          </div>
          <div className="space-y-2">
            {mirrorBuckets.map((b) => (
              <MirrorRow key={b.scopeKey} bucket={b} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function BucketRow({ bucket }: { bucket: Bucket }) {
  const tokens = Math.round(bucket.tokens);
  const capacity = bucket.capacity || 0;
  const hasCapacity = capacity > 0;

  // consumed fraction: 0 = full (healthy), 1 = empty (throttled)
  const consumed = hasCapacity ? 1 - tokens / capacity : 0;
  const gaugeValue = hasCapacity ? consumed : 0;
  const label = `${bucketLabel(bucket)} ${scopeLabel(bucket)} consumed`;

  return (
    <div className="grid grid-cols-[4rem_1fr_auto] items-center gap-2">
      <PlatformTag platform={bucket.platform} />
      <div className="min-w-0">
        <Gauge
          value={gaugeValue}
          label={label}
          className="w-full"
        />
      </div>
      <div className="text-right tabular-nums">
        {hasCapacity ? (
          <span className={gaugeText(gaugeValue)}>
            {tokens}/{capacity}
          </span>
        ) : (
          <span className="text-term-faint">{tokens} tkn</span>
        )}
      </div>
    </div>
  );
}

function MirrorRow({ bucket }: { bucket: MirrorBucket }) {
  const pct = Math.round(bucket.callCountPct);
  // Normalise 0-100 to 0-1 for Gauge. Built-in tone: ≥0.9 danger, ≥0.7 warn.
  // This maps to ≥90% and ≥70% — slightly stricter than the legacy page's 75%
  // deny threshold, but the retryAfterMs guard surfaces the real throttle state.
  const gaugeValue = pct / 100;

  return (
    <div className="grid grid-cols-[4rem_1fr_auto] items-center gap-2">
      <span className="truncate text-[10px] uppercase tracking-[0.1em] text-term-uv-tint">
        {bucket.type}
      </span>
      <div className="min-w-0">
        <Gauge
          value={gaugeValue}
          label={`${bucket.scopeKey} call count`}
          className="w-full"
        />
      </div>
      <div className="text-right tabular-nums">
        {bucket.retryAfterMs > 0 ? (
          <span className="text-term-danger">
            wait {Math.round(bucket.retryAfterMs / 1000)}s
          </span>
        ) : (
          <span className={gaugeText(gaugeValue)}>{pct}%</span>
        )}
      </div>
    </div>
  );
}

// ── LOCKS tab ─────────────────────────────────────────────────────────────────

function LocksTab({ locks, apiDown }: { locks: Lock[]; apiDown: boolean }) {
  if (apiDown) {
    return (
      <div className="py-4 text-center text-term-danger">
        <span className="animate-term-blink">▮</span> endpoint unreachable
      </div>
    );
  }

  if (locks.length === 0) {
    return (
      <div className="py-6 text-center text-term-mint">
        &gt; no active locks <span className="animate-term-blink">▮</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {locks.map((lock) => (
        <LockRow key={lock.key} lock={lock} />
      ))}
    </div>
  );
}

function LockRow({ lock }: { lock: Lock }) {
  const ttlMs = lock.ttl_remaining_ms ?? 0;
  const totalMs = lock.ttl_total_ms ?? DEFAULT_TTL_TOTAL_MS;
  // fraction of time remaining: 1 = full (just acquired), 0 = expired
  const remainingFraction = totalMs > 0 ? ttlMs / totalMs : 0;
  const ttlSeconds = Math.max(0, Math.round(ttlMs / 1000));

  const platform = extractPlatformFromKey(lock.key);

  return (
    <div className="space-y-1 border-b border-term-line/60 pb-2 last:border-0 last:pb-0">
      <div className="flex items-center gap-2">
        {platform ? (
          <PlatformTag platform={platform} />
        ) : (
          <span className="text-[10px] text-term-faint">—</span>
        )}
        <span className="truncate text-term-text">
          {lock.product ?? '—'}
        </span>
        {lock.account_id != null && (
          <span className="ml-auto text-[10px] tabular-nums text-term-faint">
            #{lock.account_id}
          </span>
        )}
      </div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-2">
        <MiniBar
          value={remainingFraction}
          max={1}
          tone={ttlSeconds > 60 ? 'warn' : 'mint'}
          label={`${lock.key} TTL remaining`}
          className="w-full"
        />
        <span className="tabular-nums text-term-faint">
          {ttlSeconds}s
        </span>
      </div>
      <div className="flex items-center justify-between text-[10px] text-term-faint">
        <span title={lock.key} className="truncate">
          {lock.key.split(':').slice(-3).join(':')}
        </span>
        <span>acquired {fmtRelative(lock.acquired_at)}</span>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scopeLabel(b: Bucket): string {
  if (b.scope) return b.scope.replace(/_/g, ' ');
  const parts = b.key.split(':');
  const rateIdx = parts.indexOf('rate');
  return rateIdx >= 0 && parts[rateIdx + 2] ? parts[rateIdx + 2].replace(/_/g, ' ') : 'bucket';
}

function bucketLabel(b: Bucket): string {
  if (b.account?.handle) return b.account.handle;
  if (b.account?.display_name) return b.account.display_name;
  return b.platform;
}

function gaugeText(value: number): string {
  if (value >= 0.9) return 'text-term-danger';
  if (value >= 0.7) return 'text-term-warn';
  return 'text-term-mint';
}

function extractPlatformFromKey(key: string): string | null {
  // keys look like: connector-poc:throttle:instagram:…  or  ns:throttle:fb:…
  const parts = key.split(':');
  const throttleIdx = parts.indexOf('throttle');
  if (throttleIdx >= 0 && parts[throttleIdx + 1]) {
    return parts[throttleIdx + 1];
  }
  return parts[2] ?? null;
}
