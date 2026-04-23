import { useEffect, useRef, useState } from 'react';
import { CONNECTOR_API_URL } from './api';

export type LiveState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
};

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
        const json = (await res.json()) as T;
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
