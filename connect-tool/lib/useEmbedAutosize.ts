'use client';

import { useEffect } from 'react';

/**
 * When rendered inside the SDK's iframe modal (embed mode), notify the host
 * SDK of the content height so it can size the modal to fit. No-op when not
 * embedded or not inside a frame. Posts `camaleonic.connect.resize`.
 */
export function useEmbedAutosize(enabled: boolean, origin: string): void {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined' || window.parent === window) return;
    const post = () =>
      window.parent.postMessage(
        { type: 'camaleonic.connect.resize', height: document.body.scrollHeight + 24 },
        // Sec-4: never '*'. Falls back to the iframe's own origin when no
        // validated opener origin is known — a cross-origin mismatch is
        // dropped by the browser rather than broadcast.
        origin && origin.length > 0 ? origin : window.location.origin,
      );
    post();
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [enabled, origin]);
}
