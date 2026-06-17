/**
 * Pure merge logic for LiveActivityPanel.
 *
 * Takes the raw arrays from the four activity endpoints and normalises them
 * into a single descending-time ActivityItem stream. No React, no side-effects
 * — isolated here so it can be unit-tested without a DOM.
 */

import { statusClass } from '@/lib/format';

export type ActivityKind = 'call' | 'event' | 'webhook_in' | 'delivery';

export type ActivityTone = 'ok' | 'warn' | 'danger' | 'queued';

export interface ActivityStatus {
  text: string;
  tone: ActivityTone;
}

/**
 * Normalised activity item. `raw` carries the original source object so
 * the inspector drawer can display it without any extra fetch.
 */
export interface ActivityItem {
  id: string;
  /** ISO timestamp string (or epoch ms string) — used for sort and display. */
  ts: string;
  kind: ActivityKind;
  platform?: string;
  summary: string;
  status: ActivityStatus;
  /** The original source object, verbatim, for the raw JSON drawer. */
  raw: unknown;
}

// ── Source shapes (minimal — mirrors the legacy page types) ─────────────────

export interface ApiCallRaw {
  called_at?: string;
  platform?: string;
  endpoint?: string;
  status_code?: number;
  duration_ms?: number;
  account_id?: string | null;
  account_handle?: string | null;
}

export interface EventRaw {
  id: string;
  event_type: string;
  account_id?: string;
  product?: string;
  emitted_at?: string;
  payload?: Record<string, unknown>;
}

export interface WebhookInRaw {
  id: string;
  platform: string;
  topic?: string | null;
  object?: string | null;
  received_at?: string;
  account_id?: string | null;
  account_handle?: string | null;
  status?: string;
  body_excerpt?: string | null;
  payload_snippet?: string | null;
}

export interface DeliveryRaw {
  id: string;
  endpoint_url: string;
  workspace_slug: string;
  event: string;
  status: string;
  attempts: number;
  last_response_code: number | null;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
  // Resolved server-side from the payload's account_id (v1 uuid).
  platform?: string | null;
  account?: string | null;
  account_id?: string | null;
}

// ── Tone helpers ─────────────────────────────────────────────────────────────

function toneFromStatusCode(code: number | undefined | null): ActivityTone {
  const cls = statusClass(code);
  if (cls === 'ok') return 'ok';
  if (cls === 'warn') return 'warn';
  if (cls === 'danger') return 'danger';
  return 'queued';
}

function toneFromDeliveryStatus(status: string): ActivityTone {
  switch (status) {
    case 'delivered':
      return 'ok';
    case 'failed':
      return 'warn';
    case 'abandoned':
      return 'danger';
    default:
      return 'queued'; // pending, retrying, etc.
  }
}

function toneFromWebhookStatus(status: string | undefined): ActivityTone {
  switch (status) {
    case 'enqueued':
      return 'ok';
    case 'skipped':
      return 'queued';
    case 'invalid_signature':
      return 'danger';
    default:
      return 'warn'; // unresolved
  }
}

// ── Per-kind normalisation ────────────────────────────────────────────────────

function normaliseCall(c: ApiCallRaw, idx: number): ActivityItem {
  const tone = toneFromStatusCode(c.status_code);
  const codeText = c.status_code != null ? String(c.status_code) : '?';
  const durText = c.duration_ms != null ? ` ${c.duration_ms}ms` : '';
  return {
    id: `call:${c.called_at ?? idx}:${c.endpoint ?? idx}:${idx}`,
    ts: c.called_at ?? '',
    kind: 'call',
    platform: c.platform,
    summary: c.endpoint ?? '—',
    status: { text: `${codeText}${durText}`, tone },
    raw: c,
  };
}

function normaliseEvent(e: EventRaw): ActivityItem {
  const isError =
    e.event_type.includes('reauth') || e.event_type.includes('error');
  const tone: ActivityTone = isError ? 'danger' : 'ok';
  const acct = e.account_id ? `#${e.account_id}` : '';
  return {
    id: `event:${e.id}`,
    ts: e.emitted_at ?? '',
    kind: 'event',
    summary: acct ? `${e.event_type} ${acct}` : e.event_type,
    status: { text: e.event_type, tone },
    raw: e,
  };
}

function normaliseWebhookIn(w: WebhookInRaw): ActivityItem {
  const tone = toneFromWebhookStatus(w.status);
  const topic = w.topic ?? '—';
  const acct = w.account_handle ?? (w.account_id ? `#${w.account_id}` : '');
  return {
    id: `webhook_in:${w.id}`,
    ts: w.received_at ?? '',
    kind: 'webhook_in',
    platform: w.platform,
    summary: acct ? `${topic} · ${acct}` : topic,
    status: { text: w.status ?? 'unresolved', tone },
    raw: w,
  };
}

function normaliseDelivery(d: DeliveryRaw): ActivityItem {
  const tone = toneFromDeliveryStatus(d.status);
  const code = d.last_response_code != null ? ` ${d.last_response_code}` : '';
  const acct =
    d.account ?? (d.account_id ? `#${d.account_id.slice(0, 8)}` : '');
  return {
    id: `delivery:${d.id}`,
    ts: d.created_at,
    kind: 'delivery',
    platform: d.platform ?? undefined,
    summary: acct
      ? `${d.event} · ${acct} → ${d.endpoint_url}`
      : `${d.event} → ${d.endpoint_url}`,
    status: { text: `${d.status}${code}`, tone },
    raw: d,
  };
}

// ── ts extraction ─────────────────────────────────────────────────────────────

function tsMs(ts: string): number {
  if (!ts) return 0;
  const n = Date.parse(ts);
  return isNaN(n) ? 0 : n;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Maximum items kept in the merged stream. */
export const ACTIVITY_CAP = 200;

/**
 * Merge four source arrays into one descending-time ActivityItem list.
 * Capped at `ACTIVITY_CAP` items to keep the DOM manageable.
 */
export function mergeActivity(
  calls: ApiCallRaw[],
  events: EventRaw[],
  webhooksIn: WebhookInRaw[],
  deliveries: DeliveryRaw[],
): ActivityItem[] {
  const items: ActivityItem[] = [
    ...calls.map(normaliseCall),
    ...events.map(normaliseEvent),
    ...webhooksIn.map(normaliseWebhookIn),
    ...deliveries.map(normaliseDelivery),
  ];

  items.sort((a, b) => tsMs(b.ts) - tsMs(a.ts));

  return items.slice(0, ACTIVITY_CAP);
}
