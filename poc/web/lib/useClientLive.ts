import { useEffect, useRef, useState } from 'react';

interface State<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * Identical to lib/useLive but routes through /api/client/proxy/* so the
 * HttpOnly session cookie is added server-side. The client UI never sees
 * the bearer.
 */
export function useClientLive<T = unknown>(
  path: string | null,
  intervalMs = 5000,
): State<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const cancelled = useRef(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    cancelled.current = false;
    setLoading(true);

    const fetchOnce = async () => {
      if (!path) return;
      const url = `/api/client/proxy/${path.replace(/^\/+/, '')}`;
      try {
        const res = await fetch(url);
        if (res.status === 401) {
          if (typeof window !== 'undefined') {
            window.location.href = '/client/login';
            return;
          }
          throw new Error('Session expired');
        }
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const raw = await res.json();
        if (!cancelled.current) {
          setData(unwrapEnvelope(raw) as T);
          setError(null);
        }
      } catch (err) {
        if (!cancelled.current) setError((err as Error).message);
      } finally {
        if (!cancelled.current) setLoading(false);
      }
    };

    fetchOnce();
    const id = window.setInterval(fetchOnce, intervalMs);
    return () => {
      cancelled.current = true;
      window.clearInterval(id);
    };
  }, [path, intervalMs, nonce]);

  return { data, error, loading, refresh: () => setNonce((n) => n + 1) };
}

const ENVELOPE_KEYS = new Set(['items', 'buckets', 'locks', 'data']);
function unwrapEnvelope(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const keys = Object.keys(raw as Record<string, unknown>);
  if (keys.length !== 1) return raw;
  const only = keys[0];
  if (!ENVELOPE_KEYS.has(only)) return raw;
  const inner = (raw as Record<string, unknown>)[only];
  return Array.isArray(inner) ? inner : raw;
}

export async function clientFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `/api/client/proxy/${path.replace(/^\/+/, '')}`;
  const res = await fetch(url, init);
  if (res.status === 401) {
    if (typeof window !== 'undefined') window.location.href = '/client/login';
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return (await res.json()) as T;
}
