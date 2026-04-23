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

export function fmtTime(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '—';
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function fmtDateTime(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '—';
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })}`;
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
