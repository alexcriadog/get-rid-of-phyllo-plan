export function toDate(v: string | number | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export function fmtRelative(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '—';
  const diffMs = Date.now() - d.getTime();
  const abs = Math.abs(diffMs);
  const s = Math.round(abs / 1000);
  if (s < 60) return diffMs < 0 ? `in ${s}s` : `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return diffMs < 0 ? `in ${m}m` : `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return diffMs < 0 ? `in ${h}h` : `${h}h ago`;
  const days = Math.round(h / 24);
  return diffMs < 0 ? `in ${days}d` : `${days}d ago`;
}

// All wall-clock dates in the UI are projected to Europe/Madrid so the
// product reads consistently whether you open it in Spain, on a server in
// US-East, or with the browser locale set to en-US. The Date object stays
// the same instant — only the formatting locks to Madrid.
const UI_TIMEZONE = 'Europe/Madrid';
const UI_LOCALE = 'es-ES';

export function fmtTime(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '—';
  return d.toLocaleTimeString(UI_LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: UI_TIMEZONE,
  });
}

export function fmtDateTime(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '—';
  return `${d.toLocaleDateString(UI_LOCALE, {
    timeZone: UI_TIMEZONE,
  })} ${d.toLocaleTimeString(UI_LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: UI_TIMEZONE,
  })}`;
}

export function fmtDate(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '—';
  return d.toLocaleDateString(UI_LOCALE, { timeZone: UI_TIMEZONE });
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function fmtNumber(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || isNaN(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function truncate(s: string | null | undefined, n = 64): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function statusClass(code: number | null | undefined): 'ok' | 'warn' | 'danger' | '' {
  if (code == null) return '';
  if (code >= 200 && code < 300) return 'ok';
  if (code >= 400 && code < 500) return 'warn';
  if (code >= 500) return 'danger';
  return '';
}

/**
 * Stat-block numeral: integer grouped with U+202F narrow no-break space
 * ("48 204") — the Mint Terminal signature numeral format. Decimals are
 * truncated; stats are counts.
 */
export function fmtStatNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const digits = Math.trunc(Math.abs(n)).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
}

export type ProductKind = 'identity' | 'audience' | 'engagement_new' | 'stories';

const KNOWN_PRODUCTS: ReadonlySet<ProductKind> = new Set([
  'identity',
  'audience',
  'engagement_new',
  'stories',
]);

/**
 * Resolve which product an API call belongs to.
 *
 * Source of truth: the `product` field tagged by the worker via
 * AsyncLocalStorage and persisted to `api_call_log.product`. If the row
 * predates that plumbing (or the API didn't return it), fall back to a
 * URL heuristic. Order matters: the *specific* patterns
 * (posts/videos/media/video_insights, stories) must be checked BEFORE the
 * generic `/insights` pattern, because post-level insights endpoints
 * (`/{post_id}/insights`) and audience-level ones (`/{account_id}/insights`)
 * are indistinguishable by path alone.
 */
export function productFromCall(call: {
  endpoint?: string | null;
  product?: string | null;
}): ProductKind {
  if (call.product && KNOWN_PRODUCTS.has(call.product as ProductKind)) {
    return call.product as ProductKind;
  }
  const ep = call.endpoint ?? '';
  // Meta post insights ride on `/{accountId}_{postId}/insights` — the `_`
  // separator is the only stable signal that distinguishes post-level from
  // account-level insights when only the URL is available (legacy rows).
  if (/\/\d+_\d+\/insights/.test(ep)) return 'engagement_new';
  if (/\/(posts|videos|video_insights|media)(\b|\/|\?|$)/.test(ep)) {
    return 'engagement_new';
  }
  if (/\/stories(\b|\/|\?|$)/.test(ep)) return 'stories';
  if (/\/insights(\b|\/|\?|$)/.test(ep)) return 'audience';
  return 'identity';
}
