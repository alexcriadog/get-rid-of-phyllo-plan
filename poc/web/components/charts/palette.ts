/**
 * Shared chart palette + small numeric helpers. Charts read from CSS custom
 * properties (--c1 … --c8, --ok, --warn, --danger) so the visual identity
 * stays in one place (globals.css).
 */

export const SERIES_TOKENS = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8'] as const;

export const SERIES_FALLBACKS = [
  '#7aa2ff',
  '#5dd4ad',
  '#ff6bcb',
  '#fbbf24',
  '#a78bfa',
  '#38bdf8',
  '#f87171',
  '#f472b6',
];

export const STATUS_COLORS = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  muted: 'var(--text-faint)',
} as const;

export type StatusTone = keyof typeof STATUS_COLORS;

export function seriesColor(index: number): string {
  const i = ((index % SERIES_TOKENS.length) + SERIES_TOKENS.length) % SERIES_TOKENS.length;
  return `var(${SERIES_TOKENS[i]}, ${SERIES_FALLBACKS[i]})`;
}

export function pickStatusTone(statusCode: number | undefined | null): StatusTone {
  if (statusCode == null || statusCode === 0) return 'danger';
  if (statusCode >= 200 && statusCode < 300) return 'ok';
  if (statusCode >= 300 && statusCode < 400) return 'info';
  if (statusCode >= 400 && statusCode < 500) return 'warn';
  return 'danger';
}

export function compactNumber(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toLocaleString();
}

export function pct(part: number, total: number, digits = 1): string {
  if (!total || isNaN(total)) return '0%';
  return `${((part / total) * 100).toFixed(digits)}%`;
}
