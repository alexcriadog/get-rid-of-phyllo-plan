import { useEffect, useRef, useState } from 'react';
import { CONNECTOR_API_URL } from './api';

export type LiveState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
};

/**
 * Standardized polling cadences keyed to data volatility. Use these instead
 * of ad-hoc millisecond literals so refresh pressure is consistent and
 * tunable in one place.
 *
 * - `live`    real-time streams / activity feeds
 * - `list`    list + table views that change often
 * - `config`  configuration / health that changes slowly
 * - `catalog` near-static reference data (support matrix, etc.)
 */
export const POLL = {
  live: 3000,
  list: 5000,
  config: 15000,
  catalog: 30000,
} as const;

/**
 * Polls a connector admin endpoint every `intervalMs` milliseconds.
 * Pass a relative path (e.g. `/admin/overview`) or an absolute URL.
 */
export function useLive<T = unknown>(path: string | null, intervalMs = 2000): LiveState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const isCancelled = useRef<boolean>(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    isCancelled.current = false;
    setLoading(true);

    const fetchOnce = async () => {
      if (!path) return;
      const url = path.startsWith('http') ? path : `${CONNECTOR_API_URL}${path}`;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const raw = await res.json();
        const json = unwrapEnvelope(raw) as T;
        if (!isCancelled.current) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (!isCancelled.current) {
          setError((err as Error).message || 'fetch failed');
        }
      } finally {
        if (!isCancelled.current) setLoading(false);
      }
    };

    fetchOnce();
    const id = window.setInterval(fetchOnce, intervalMs);
    return () => {
      isCancelled.current = true;
      window.clearInterval(id);
    };
  }, [path, intervalMs, nonce]);

  const refresh = () => setNonce((n) => n + 1);

  return { data, error, loading, refresh };
}

const ENVELOPE_KEYS = new Set(['items', 'buckets', 'locks', 'data']);

/**
 * Admin endpoints wrap lists in a single-key envelope (`{items:[…]}`,
 * `{buckets:[…]}`, `{locks:[…]}`) or the standard pagination envelope
 * (`{data:[…], meta:{count, has_more, next_cursor}}`). UI callers declare
 * bare-array generics, so unwrap one level when the shape matches —
 * multi-key payloads like `/overview` are left untouched.
 */
function unwrapEnvelope(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);

  // Standard pagination envelope: { data: [...], meta: {...} }. Drop meta
  // — the admin UI polls live and doesn't paginate (yet); always seeing the
  // latest page is the desired behaviour. If a page later needs the cursor
  // it can opt out of useLive and fetch the envelope directly.
  if (
    keys.length === 2 &&
    'data' in obj &&
    'meta' in obj &&
    Array.isArray(obj.data)
  ) {
    return obj.data;
  }

  // Legacy single-key envelopes.
  if (keys.length !== 1) return raw;
  const only = keys[0];
  if (!ENVELOPE_KEYS.has(only)) return raw;
  const inner = obj[only];
  return Array.isArray(inner) ? inner : raw;
}
