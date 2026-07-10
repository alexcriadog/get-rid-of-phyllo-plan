// Token timeline — merges the two persisted traces of a token's life into
// one chronological feed for the admin console:
//   - oauth_token_history rows: the FACTS (every connect + successful refresh,
//     with the new expiry) — written even for test-mode accounts.
//   - webhook_deliveries rows: the SIGNALS (refresh failed / expired /
//     reauth recommended / recovered / disconnected). `account.refreshed` is
//     deliberately excluded — the history row already covers it.

export const TIMELINE_DELIVERY_EVENTS: ReadonlyArray<string> = [
  'account.disconnected',
  'token.refresh_failed',
  'token.expired',
  'token.reauth_required',
  'token.recovered',
];

export interface TimelineHistoryRow {
  accountId: bigint;
  platform: string | null;
  source: string; // 'connect' | 'refresh'
  capturedAt: Date;
  expiresAt: Date | null;
}

export interface TimelineDeliveryRow {
  event: string;
  payload: unknown;
  createdAt: Date;
}

export interface TimelineAccountInfo {
  platform: string;
  handle: string | null;
}

export interface TimelineEvent {
  at: string;
  kind: string; // 'connect' | 'refresh' | delivery event name
  account_id: string;
  platform: string | null;
  handle: string | null;
  expires_at: string | null;
  detail: string | null;
}

function payloadAccountId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.account_id === 'string') return p.account_id;
  const data = p.data;
  if (data && typeof data === 'object') {
    const nested = (data as Record<string, unknown>).account_id;
    if (typeof nested === 'string') return nested;
  }
  return null;
}

function payloadReason(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const reason = (payload as Record<string, unknown>).reason;
  return typeof reason === 'string' ? reason : null;
}

/** Distinct account ids appearing in either source — for handle decoration. */
export function collectTimelineAccountIds(
  history: TimelineHistoryRow[],
  deliveries: TimelineDeliveryRow[],
): string[] {
  const ids = new Set<string>();
  for (const h of history) ids.add(h.accountId.toString());
  for (const d of deliveries) {
    const id = payloadAccountId(d.payload);
    if (id) ids.add(id);
  }
  return [...ids];
}

const DEFAULT_LIMIT = 200;

export function buildTokenTimeline(
  history: TimelineHistoryRow[],
  deliveries: TimelineDeliveryRow[],
  accounts: Map<string, TimelineAccountInfo>,
  opts: { accountId?: string; limit?: number } = {},
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const row of history) {
    const accountId = row.accountId.toString();
    const info = accounts.get(accountId);
    events.push({
      at: row.capturedAt.toISOString(),
      kind: row.source,
      account_id: accountId,
      platform: row.platform ?? info?.platform ?? null,
      handle: info?.handle ?? null,
      expires_at: row.expiresAt?.toISOString() ?? null,
      detail: null,
    });
  }

  // The same logical event fans out as one delivery row PER subscribed
  // endpoint — collapse them so the timeline shows the event once.
  const seen = new Set<string>();
  for (const row of deliveries) {
    const accountId = payloadAccountId(row.payload);
    if (!accountId) continue;
    const key = `${row.event}|${accountId}|${row.createdAt.toISOString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const info = accounts.get(accountId);
    events.push({
      at: row.createdAt.toISOString(),
      kind: row.event,
      account_id: accountId,
      platform: info?.platform ?? null,
      handle: info?.handle ?? null,
      expires_at: null,
      detail: payloadReason(row.payload),
    });
  }

  const filtered = opts.accountId
    ? events.filter((e) => e.account_id === opts.accountId)
    : events;

  filtered.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return filtered.slice(0, opts.limit ?? DEFAULT_LIMIT);
}
