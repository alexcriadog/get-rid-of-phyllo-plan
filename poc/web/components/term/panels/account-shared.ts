/**
 * Shared types and helpers for AccountDirectoryPanel and AccountInspectorPanel.
 * Extracted to avoid circular imports between the two panel files.
 */

// ── Data types (mirrored from legacy pages/admin/accounts*.tsx) ─────────────

export type ProductHealth = {
  product?: string;
  last_success_at?: string | null;
  next_run_at?: string | null;
  failure_count?: number;
  freshness?: 'green' | 'yellow' | 'red';
  status?: string;
  last_error?: string | null;
  override_active?: boolean;
};

export type AdminAccount = {
  id: number | string;
  platform: string;
  handle?: string | null;
  display_name?: string | null;
  sync_tier?: string | null;
  status?: string | null;
  token_expires_at?: string | null;
  token_refreshable?: boolean;
  workspace_slug?: string | null;
  workspace_name?: string | null;
  canonical_user_id?: string | null;
  connected_at?: string | null;
  products?: ProductHealth[] | Record<string, ProductHealth>;
  sync_jobs?: SyncJob[];
  webhook?: {
    subscribed?: boolean;
    via_page?: string;
    fields?: string[];
    subscribed_at?: string;
    error?: string;
  };
};

export type SyncJob = {
  id?: string;
  product: string;
  status: string;
  next_run_at?: string | null;
  last_success_at?: string | null;
  last_attempt_at?: string | null;
  failure_count?: number;
  last_error?: string | null;
};

export type ApiCallRow = {
  called_at?: string;
  platform?: string;
  endpoint?: string;
  status_code?: number;
  duration_ms?: number;
  account_id?: string | null;
};

// ── Token helpers ─────────────────────────────────────────────────────────────

/** Returns 'live' | 'expiring' | 'expired' | 'unknown' */
export function tokenStatus(
  expiresAt: string | null | undefined,
): 'live' | 'expiring' | 'expired' | 'unknown' {
  if (!expiresAt) return 'unknown';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms < 0) return 'expired';
  if (ms < 7 * 86_400_000) return 'expiring';
  return 'live';
}

export function tokenStatusClass(
  status: ReturnType<typeof tokenStatus>,
): string {
  switch (status) {
    case 'live':
      return 'text-term-mint';
    case 'expiring':
      return 'text-term-warn';
    case 'expired':
      return 'text-term-danger';
    default:
      return 'text-term-faint';
  }
}

export function tokenDaysLabel(
  expiresAt: string | null | undefined,
): string {
  if (!expiresAt) return '—';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms < 0) return 'expired';
  const days = Math.floor(ms / 86_400_000);
  return `${days}d`;
}

// ── Product normalizer ────────────────────────────────────────────────────────

export function normalizeProducts(
  raw: AdminAccount['products'],
): Map<string, ProductHealth> {
  const m = new Map<string, ProductHealth>();
  if (!raw) return m;
  if (Array.isArray(raw)) {
    for (const p of raw) {
      if (p.product) m.set(p.product, p);
    }
  } else {
    for (const [k, v] of Object.entries(raw)) {
      m.set(k, v);
    }
  }
  return m;
}

// ── Health tone ───────────────────────────────────────────────────────────────

export function productHealthTone(
  h: ProductHealth | undefined,
  paused: boolean,
): 'ok' | 'warn' | 'danger' | 'faint' {
  if (paused || !h) return 'faint';
  if ((h.failure_count ?? 0) >= 3) return 'danger';
  if (h.freshness === 'green') return 'ok';
  return 'warn';
}

export function healthToneClass(
  tone: 'ok' | 'warn' | 'danger' | 'faint',
): string {
  switch (tone) {
    case 'ok':
      return 'text-term-mint';
    case 'warn':
      return 'text-term-warn';
    case 'danger':
      return 'text-term-danger';
    default:
      return 'text-term-faint';
  }
}
