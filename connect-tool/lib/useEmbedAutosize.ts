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
        origin && origin.length > 0 ? origin : '*',
      );
    post();
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [enabled, origin]);
}
